// Automation Center, recipes, plain-language rules and AI-extracted tasks — through the real API and pipeline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { client, fakeAnthropic, triage } from './helpers.js';

let nextReply = null;
const ai = await fakeAnthropic(() => nextReply);
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_LIMIT = '500';
process.env.ANTHROPIC_BASE_URL = ai.url;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
const { createApp } = await import('../src/server.js');
const { run, one, all } = await import('../src/db.js');
const { storeMessage, processMessage } = await import('../src/services/processor.js');
const { seal } = await import('../src/vault.js');

let server; let base;
before(() => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); ai.close(); });

async function setup(email) {
  const c = client(base);
  await c.signup(email, { company: `Co ${email}` });
  const me = (await c.call('GET', '/api/auth/me')).body;
  const ws = me.workspace.id;
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly', reply_delay_min=0, reply_delay_max=0 WHERE id = ?`, ws);
  const id = Number(run(`INSERT INTO mailboxes (workspace_id, email, imap_host, smtp_host, username, password_enc, mode) VALUES (?, ?, 'i', 's', ?, ?, 'draft')`,
    ws, `box@${ws}.test`, `box@${ws}.test`, seal(ws, 'mailboxes.password', 'pw')).lastInsertRowid);
  return { c, ws, me, mb: one('SELECT * FROM mailboxes WHERE id = ?', id) };
}
let uid = 100;
const deliver = async (mb, over = {}) => {
  const id = storeMessage(mb, { uid: ++uid, message_id: `<${uid}@x>`, from_name: 'Ann', from_email: 'ann@annco.com', subject: 'Bulk order',
    text_body: 'Please send a quote for 50 pairs by Friday.', received_at: new Date().toISOString(), headers: {}, ...over });
  await processMessage(id);
  return id;
};

test('AI action items become tasks; rules count their runs; Automation Center reports the pipeline', async () => {
  const { c, mb } = await setup('flow@auto.test');
  // Recipe install (no params) → rule that fires on sales inquiries
  const recipes = (await c.call('GET', '/api/recipes')).body;
  assert.ok(recipes.length >= 8 && recipes.every((r) => r.title && r.description && !r.build), 'public recipe list hides builders');
  const inst = await c.call('POST', '/api/recipes/lead_fast_lane/install');
  assert.equal(inst.status, 200);
  assert.equal((await c.call('POST', '/api/recipes/lead_fast_lane/install')).status, 409, 'no duplicates');
  assert.equal((await c.call('GET', '/api/recipes')).body.find((r) => r.key === 'lead_fast_lane').installed, true);

  nextReply = triage({ action_items: [{ title: 'Send quote for 50 pairs', due: 'Friday' }, { title: '  ', due: '' }] });
  const msgId = await deliver(mb);
  const tasks = (await c.call('GET', '/api/tasks')).body;
  assert.equal(tasks.length, 1, 'blank action items are dropped');
  assert.equal(tasks[0].title, 'Send quote for 50 pairs'); assert.equal(tasks[0].due_text, 'Friday'); assert.equal(tasks[0].source, 'ai');
  assert.equal(tasks[0].message_id, msgId); assert.equal(tasks[0].subject, 'Bulk order');
  assert.equal((await c.call('GET', `/api/messages/${msgId}`)).body.tasks.length, 1, 'tasks shown on the email');

  const rule = one('SELECT * FROM rules WHERE id = ?', inst.body.id);
  assert.equal(rule.hits, 1); assert.ok(rule.last_hit_at);
  // The AI request asked for action items via the structured schema
  const schema = ai.requests.at(-1).body.output_config.format.schema;
  assert.ok(schema.required.includes('action_items'));

  const ov = (await c.call('GET', '/api/automation/overview?range=24h')).body;
  assert.equal(ov.range, '24h');
  assert.equal(ov.stages.received, 1); assert.equal(ov.stages.ai_read, 1); assert.equal(ov.stages.rules_fired, 1);
  assert.equal(ov.stages.drafted, 1); assert.equal(ov.stages.tasks, 1);
  assert.ok(ov.feed.some((f) => f.type === 'tasks_extracted') && ov.feed.some((f) => f.type === 'rule_fired'));
  assert.equal(ov.rules[0].hits, 1);
  assert.ok(ov.readiness.score > 0 && ov.readiness.checks.length === 7);
  // Polling only returns newer activity
  assert.equal((await c.call('GET', `/api/automation/overview?after=${ov.feed[0].id}`)).body.feed.length, 0);

  // Phishing never creates tasks
  nextReply = triage({ is_phishing: true, action_items: [{ title: 'Verify password', due: '' }] });
  await deliver(mb, { subject: 'password', from_email: 'it@evil.example' });
  assert.equal((await c.call('GET', '/api/tasks')).body.length, 1);
});

test('tasks: manual create, complete, assign to teammates only, delete; isolated per workspace', async () => {
  const a = await setup('tasks-a@auto.test');
  const b = await setup('tasks-b@auto.test');
  assert.equal((await a.c.call('POST', '/api/tasks', { title: '' })).status, 400);
  const t = (await a.c.call('POST', '/api/tasks', { title: 'Call the supplier', due_text: 'Tomorrow' })).body;
  assert.equal((await a.c.call('GET', '/api/tasks?mine=1')).body.length, 1, 'manual tasks are assigned to their creator');
  // Another workspace can neither see nor change it
  assert.equal((await b.c.call('GET', '/api/tasks')).body.length, 0);
  assert.equal((await b.c.call('PATCH', `/api/tasks/${t.id}`, { done: true })).status, 404);
  await b.c.call('DELETE', `/api/tasks/${t.id}`);
  assert.ok(one('SELECT id FROM tasks WHERE id = ?', t.id));
  // Cannot link a task to someone else's email or assign to a stranger
  const foreignMsg = await deliver(b.mb);
  assert.equal((await a.c.call('POST', '/api/tasks', { title: 'x', message_id: foreignMsg })).status, 404);
  assert.equal((await a.c.call('PATCH', `/api/tasks/${t.id}`, { assigned_to: b.me.user.id })).status, 400);
  // Complete → counts move
  assert.equal((await a.c.call('PATCH', `/api/tasks/${t.id}`, { done: true })).status, 200);
  const counts = (await a.c.call('GET', '/api/tasks/counts')).body;
  assert.equal(counts.open, 0); assert.equal(counts.done, 1);
  assert.ok(one('SELECT done_at FROM tasks WHERE id = ?', t.id).done_at);
  assert.equal((await a.c.call('GET', '/api/tasks?status=done')).body[0].title, 'Call the supplier');
  await a.c.call('DELETE', `/api/tasks/${t.id}`);
  assert.equal(one('SELECT id FROM tasks WHERE id = ?', t.id), undefined);
});

test('recipes with parameters are validated; members cannot install', async () => {
  const { c, ws } = await setup('params@auto.test');
  assert.equal((await c.call('POST', '/api/recipes/billing_to_finance/install', { params: { to: 'not-an-email' } })).status, 400);
  assert.equal((await c.call('POST', '/api/recipes/urgent_alert/install', { params: { url: 'http://insecure.example' } })).status, 400);
  assert.equal((await c.call('POST', '/api/recipes/nope/install')).status, 404);
  const ok = await c.call('POST', '/api/recipes/billing_to_finance/install', { params: { to: 'books@acct.example' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(one('SELECT actions_json FROM rules WHERE id = ?', ok.body.id).actions_json), [{ type: 'forward', to: 'books@acct.example' }]);
  // angry_customer assigns to the installer
  const ang = await c.call('POST', '/api/recipes/angry_customer/install');
  const me = (await c.call('GET', '/api/auth/me')).body.user.id;
  assert.equal(JSON.parse(one('SELECT actions_json FROM rules WHERE id = ?', ang.body.id).actions_json)[0].user_id, me);
  // A member (not owner/admin) cannot install automations
  const inv = await c.call('POST', '/api/team/invite', { email: 'member@auto.test', role: 'member' });
  const m = client(base); await m.signup('member@auto.test', { invite: inv.body.token });
  assert.equal((await m.call('GET', '/api/auth/me')).body.workspace.id, ws);
  assert.equal((await m.call('POST', '/api/recipes/meeting_booker/install')).status, 403);
  assert.equal((await m.call('POST', '/api/rules/from-text', { text: 'archive all newsletters please' })).status, 403);
});

test('describe-it rules: AI output is validated and ids are never trusted', async () => {
  const { c, ws, me } = await setup('nl@auto.test');
  const act = (o) => ({ type: 'ai_reply', mode: '', instructions: '', to: '', url: '', template_id: 0, user_id: 0, hours: 0, ...o });
  nextReply = { understood: true, question: '', name: 'Angry → me', match: 'any', stop_processing: true,
    conditions: [{ field: 'sentiment', op: 'equals', value: 'negative' }],
    actions: [act({ type: 'assign', user_id: 999999 }), act({ mode: 'draft', instructions: 'Apologise' })] };
  const r = await c.call('POST', '/api/rules/from-text', { text: 'When a customer is angry assign to me and draft an apology' });
  assert.equal(r.status, 200);
  assert.equal(r.body.understood, true); assert.equal(r.body.error, null);
  assert.equal(r.body.rule.actions[0].user_id, me.user.id, 'unknown teammate id replaced by the requester');
  assert.deepEqual(r.body.rule.actions[1], { type: 'ai_reply', mode: 'draft', instructions: 'Apologise' }, 'empty fields are stripped');
  assert.equal(one('SELECT COUNT(*) AS n FROM rules WHERE workspace_id = ?', ws).n, 0, 'preview is not saved');
  const sys = ai.requests.at(-1).body.system[0].text;
  assert.match(sys, /untrusted/); assert.equal(ai.requests.at(-1).body.output_config.format.type, 'json_schema');

  // A template id from another workspace is refused
  nextReply = { ...nextReply, actions: [act({ type: 'template_reply', template_id: 12345 })] };
  const t = await c.call('POST', '/api/rules/from-text', { text: 'Reply to job applicants with our template' });
  assert.equal(t.body.understood, false); assert.match(t.body.question, /template/i);
  // Invalid output (forward without a valid email) surfaces a validation error instead of a broken rule
  nextReply = { ...nextReply, actions: [act({ type: 'forward', to: 'nobody' })] };
  assert.match((await c.call('POST', '/api/rules/from-text', { text: 'Forward invoices to my accountant' })).body.error, /forward/);
  assert.equal((await c.call('POST', '/api/rules/from-text', { text: 'hi' })).status, 400, 'too short');
});

test('scheduled autopilot replies can be stopped from the Automation Center', async () => {
  const { c, ws, mb } = await setup('sched@auto.test');
  run(`UPDATE workspaces SET reply_delay_min = 5, reply_delay_max = 5 WHERE id = ?`, ws);
  run(`UPDATE mailboxes SET mode = 'auto' WHERE id = ?`, mb.id);
  nextReply = triage({ category: 'support', reply_body: 'Hi! Shipping usually takes a few days. Thanks for asking.' });
  await deliver(one('SELECT * FROM mailboxes WHERE id = ?', mb.id), { subject: 'Shipping time?', text_body: 'How long is shipping?' });
  const ov = (await c.call('GET', '/api/automation/overview')).body;
  assert.equal(ov.upcoming.length, 1, 'an auto-reply is waiting out its human-like delay');
  const other = await setup('sched-other@auto.test');
  assert.equal((await other.c.call('POST', `/api/automation/scheduled/${ov.upcoming[0].id}/cancel`)).status, 404, 'other workspaces cannot touch it');
  assert.equal((await c.call('POST', `/api/automation/scheduled/${ov.upcoming[0].id}/cancel`)).status, 200);
  const rep = one('SELECT status, scheduled_at FROM replies WHERE id = ?', ov.upcoming[0].id);
  assert.equal(rep.status, 'pending'); assert.equal(rep.scheduled_at, null);
  assert.equal((await c.call('GET', '/api/automation/overview')).body.upcoming.length, 0);
  assert.equal(all(`SELECT * FROM activity WHERE workspace_id = ? AND type = 'auto_send_cancelled'`, ws).length, 1);
});
