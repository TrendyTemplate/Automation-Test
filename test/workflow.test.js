// Team & workspace workflows, organization features and lifecycle emails.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { client, PW } from './helpers.js';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_LIMIT = '500';
delete process.env.ANTHROPIC_API_KEY;
const { createApp } = await import('../src/server.js');
const { run, one, all } = await import('../src/db.js');
const { storeMessage, processMessage } = await import('../src/services/processor.js');
const { seal } = await import('../src/vault.js');
const { setSetting } = await import('../src/settings.js');
const { checkLifecycle } = await import('../src/services/lifecycle.js');

let server; let base;
before(() => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const wsOf = async (c) => (await c.call('GET', '/api/auth/me')).body.workspace.id;
const pro = (wsId) => run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly' WHERE id = ?`, wsId);

test('invitations: new user joins via sign-up link; existing user accepts after sign-in; wrong email refused; seats enforced', async () => {
  const owner = client(base);
  await owner.signup('boss@wf.test', { company: 'WF Inc' });
  const wsId = await wsOf(owner);
  assert.equal((await owner.call('POST', '/api/team/invite', { email: 'new@wf.test' })).status, 402, 'trial has one seat');
  pro(wsId);
  const inv = await owner.call('POST', '/api/team/invite', { email: 'new@wf.test', role: 'admin' });
  assert.equal(inv.status, 200);
  assert.equal((await owner.call('POST', '/api/team/invite', { email: 'new@wf.test' })).status, 409, 'no duplicate pending invites');
  const info = await client(base).call('GET', `/api/auth/invite-info?token=${inv.body.token}`);
  assert.equal(info.body.workspace, 'WF Inc'); assert.equal(info.body.exists, false);
  // New user signs up through the invite → lands in the team workspace with the invited role, email pre-verified
  const newbie = client(base);
  await newbie.signup('new@wf.test', { invite: inv.body.token });
  const me = (await newbie.call('GET', '/api/auth/me')).body;
  assert.equal(me.workspace.id, wsId); assert.equal(me.role, 'admin'); assert.equal(me.user.email_verified, 1);
  assert.equal(me.workspaces.length, 2, 'also keeps a personal workspace');
  assert.equal((await client(base).call('GET', `/api/auth/invite-info?token=${inv.body.token}`)).status, 404, 'single use');

  // Existing user: accept after sign-in; someone else cannot use their invite
  const existing = client(base); await existing.signup('old@wf.test');
  const inv2 = (await owner.call('POST', '/api/team/invite', { email: 'old@wf.test' })).body.token;
  const thief = client(base); await thief.signup('thief@wf.test');
  assert.equal((await thief.call('POST', '/api/auth/invites/accept', { token: inv2 })).status, 400);
  assert.equal((await existing.call('POST', '/api/auth/invites/accept', { token: inv2 })).status, 200);
  assert.equal((await existing.call('GET', '/api/auth/me')).body.workspace.id, wsId);

  // Pending invites count toward seats; resend and revoke
  const t = (await owner.call('GET', '/api/team')).body;
  assert.equal(t.members.length, 3);
  const inv3 = await owner.call('POST', '/api/team/invite', { email: 'later@wf.test' });
  assert.equal(inv3.status, 200);
  const pending = (await owner.call('GET', '/api/team')).body.invites;
  assert.equal(pending.length, 1);
  assert.equal((await owner.call('POST', `/api/team/invites/${pending[0].id}/resend`)).status, 200);
  const again = (await owner.call('GET', '/api/team')).body.invites;
  assert.equal((await owner.call('DELETE', `/api/team/invites/${again[0].id}`)).status, 200);
  assert.equal((await owner.call('GET', '/api/team')).body.invites.length, 0);
  // Members can't invite or see invites
  const asMember = existing;
  assert.equal((await asMember.call('POST', '/api/team/invite', { email: 'x@wf.test' })).status, 403);
  assert.equal((await asMember.call('GET', '/api/team')).body.invites.length, 0);
});

test('roles, ownership transfer, leave and delete workspace', async () => {
  const owner = client(base); await owner.signup('o@roles.test');
  const wsId = await wsOf(owner); pro(wsId);
  const m = client(base); await m.signup('m@roles.test');
  const mId = one(`SELECT id FROM users WHERE email='m@roles.test'`).id;
  const ownerId = one(`SELECT id FROM users WHERE email='o@roles.test'`).id;
  await m.call('POST', '/api/auth/invites/accept', { token: (await owner.call('POST', '/api/team/invite', { email: 'm@roles.test' })).body.token });
  assert.equal((await m.call('PATCH', `/api/team/${ownerId}`, { role: 'member' })).status, 403, 'members cannot change roles');
  assert.equal((await owner.call('PATCH', `/api/team/${ownerId}`, { role: 'member' })).status, 400, "owner's role is protected");
  assert.equal((await owner.call('PATCH', `/api/team/${mId}`, { role: 'superuser' })).status, 400);
  assert.equal((await owner.call('PATCH', `/api/team/${mId}`, { role: 'admin' })).status, 200);
  assert.equal((await m.call('POST', '/api/team/transfer', { user_id: mId })).status, 403, 'only the owner can transfer');
  assert.equal((await owner.call('POST', '/api/team/transfer', { user_id: mId })).status, 200);
  assert.equal(one('SELECT owner_id FROM workspaces WHERE id = ?', wsId).owner_id, mId);
  assert.equal((await owner.call('GET', '/api/auth/me')).body.role, 'admin');
  assert.equal((await m.call('POST', '/api/team/leave')).status, 400, 'owner must transfer before leaving');
  assert.equal((await owner.call('POST', '/api/team/leave')).status, 200);
  assert.notEqual((await owner.call('GET', '/api/auth/me')).body.workspace.id, wsId);
  // Delete workspace: needs exact name, refuses the user's only workspace
  const solo = client(base); await solo.signup('solo@roles.test', { company: 'Solo Co' });
  assert.equal((await solo.call('DELETE', '/api/workspace', { confirm: 'Solo Co' })).status, 400);
  await solo.call('POST', '/api/auth/workspaces', { name: 'Client Z' });
  assert.equal((await solo.call('DELETE', '/api/workspace', { confirm: 'wrong' })).status, 400);
  const zId = await wsOf(solo);
  assert.equal((await solo.call('DELETE', '/api/workspace', { confirm: 'Client Z' })).status, 200);
  assert.equal(one('SELECT COUNT(*) AS n FROM workspaces WHERE id = ?', zId).n, 0);
  assert.equal((await solo.call('GET', '/api/auth/me')).body.workspace.name, 'Solo Co');
});

test('rules: edit with multiple conditions/actions, toggle, reorder', async () => {
  const c = client(base); await c.signup('rules@wf.test');
  const a = (await c.call('POST', '/api/rules', { name: 'A', conditions: { match: 'any', items: [{ field: 'subject', op: 'contains', value: 'x' }, { field: 'from_domain', op: 'equals', value: 'y.com' }] }, actions: [{ type: 'mark_read' }, { type: 'snooze', hours: 4 }] })).body.id;
  const b = (await c.call('POST', '/api/rules', { name: 'B', conditions: { items: [] }, actions: [{ type: 'ignore' }] })).body.id;
  assert.equal((await c.call('PUT', `/api/rules/${a}`, { name: 'A2', enabled: true, stop_processing: false, conditions: { match: 'all', items: [{ field: 'category', op: 'equals', value: 'support' }] }, actions: [{ type: 'ai_reply', mode: 'draft', instructions: 'Be brief' }] })).status, 200);
  assert.equal((await c.call('PATCH', `/api/rules/${b}`, { enabled: false })).status, 200);
  assert.equal((await c.call('POST', '/api/rules/reorder', { ids: [b, a] })).status, 200);
  const list = (await c.call('GET', '/api/rules')).body;
  assert.deepEqual(list.map((r) => r.name), ['B', 'A2']);
  assert.equal(list[0].enabled, 0);
  assert.equal(list[1].stop_processing, 0);
  assert.equal(list[1].actions[0].instructions, 'Be brief');
});

test('inbox: bulk actions are tenant-scoped; AI corrections and "not phishing"; contacts add/delete; notifications', async () => {
  const c = client(base); await c.signup('inbox@wf.test');
  const wsId = await wsOf(c);
  const mbId = Number(run(`INSERT INTO mailboxes (workspace_id, email, imap_host, smtp_host, username, password_enc) VALUES (?, 'in@wf.test', 'i', 's', 'u', ?)`, wsId, seal(wsId, 'mailboxes.password', 'p')).lastInsertRowid);
  const mb = one('SELECT * FROM mailboxes WHERE id = ?', mbId);
  const ids = [1, 2, 3].map((i) => storeMessage(mb, { uid: i, message_id: `<b${i}@x>`, from_email: `c${i}@cust.test`, subject: `Hello ${i}`, text_body: 'hi', received_at: new Date().toISOString(), headers: {} }));
  for (const id of ids) await processMessage(id);
  const other = client(base); await other.signup('intruder@wf.test');
  const r0 = await other.call('POST', '/api/messages/bulk', { ids, action: 'done' });
  assert.equal(r0.status, 200);
  assert.equal(one(`SELECT COUNT(*) AS n FROM messages WHERE id IN (${ids.join(',')}) AND done = 1`).n, 0, 'another tenant cannot bulk-edit these emails');
  assert.equal((await c.call('POST', '/api/messages/bulk', { ids, action: 'done' })).body.count, 3);
  assert.equal(one(`SELECT COUNT(*) AS n FROM messages WHERE id IN (${ids.join(',')}) AND done = 1`).n, 3);
  assert.equal((await c.call('POST', '/api/messages/bulk', { ids, action: 'snooze', until: '2001-01-01' })).status, 400);
  assert.equal((await c.call('POST', '/api/messages/bulk', { ids, action: 'explode' })).status, 400);
  run('UPDATE messages SET is_phishing = 1, status = ? WHERE id = ?', 'ignored', ids[0]);
  assert.equal((await c.call('POST', `/api/messages/${ids[0]}/classify`, { category: 'billing', priority: 'high', not_phishing: true })).status, 200);
  const fixed = one('SELECT * FROM messages WHERE id = ?', ids[0]);
  assert.equal(fixed.category, 'billing'); assert.equal(fixed.priority, 'high'); assert.equal(fixed.is_phishing, 0); assert.equal(fixed.status, 'triaged');
  assert.equal((await c.call('POST', `/api/messages/${ids[0]}/classify`, { category: 'bogus' })).status, 400);
  assert.equal((await other.call('POST', `/api/messages/${ids[0]}/classify`, { category: 'spam' })).status, 404);
  const ct = await c.call('POST', '/api/contacts', { email: 'vip@cust.test', name: 'Vera', vip: true });
  assert.equal(ct.status, 200);
  assert.equal((await c.call('POST', '/api/contacts', { email: 'vip@cust.test' })).status, 409);
  assert.equal((await other.call('DELETE', `/api/contacts/${ct.body.id}`)).status, 404);
  assert.equal((await c.call('DELETE', `/api/contacts/${ct.body.id}`)).status, 200);
  const notes = (await c.call('GET', '/api/notifications')).body;
  assert.ok(Array.isArray(notes));
  assert.ok((await c.call('GET', '/api/auth/me')).body.unreadNotifications >= 0);
  await c.call('POST', '/api/notifications/seen');
  assert.equal((await c.call('GET', '/api/auth/me')).body.unreadNotifications, 0);
});

test('mailbox edit: server changes are re-tested and private hosts refused', async () => {
  const c = client(base); await c.signup('mbedit@wf.test');
  const wsId = await wsOf(c);
  const id = Number(run(`INSERT INTO mailboxes (workspace_id, email, imap_host, smtp_host, username, password_enc) VALUES (?, 'e@wf.test', 'imap.example.com', 'smtp.example.com', 'u', ?)`, wsId, seal(wsId, 'mailboxes.password', 'p')).lastInsertRowid);
  assert.equal((await c.call('PATCH', `/api/mailboxes/${id}`, { label: 'Support desk' })).status, 200);
  assert.equal(one('SELECT label FROM mailboxes WHERE id = ?', id).label, 'Support desk');
  const r = await c.call('PATCH', `/api/mailboxes/${id}`, { imap_host: '10.0.0.5', imap_port: 993 });
  assert.equal(r.status, 400);
  assert.equal(one('SELECT imap_host FROM mailboxes WHERE id = ?', id).imap_host, 'imap.example.com', 'unchanged on failure');
});

test('profile and verified email change', async () => {
  const c = client(base); await c.signup('profile@wf.test');
  assert.equal((await c.call('PUT', '/api/auth/profile', { name: 'Pat', notify_digest: false, ui_theme: 'dark' })).status, 200);
  const p = (await c.call('GET', '/api/auth/profile')).body;
  assert.equal(p.name, 'Pat'); assert.equal(p.notify_digest, 0); assert.equal(p.ui_theme, 'dark');
  assert.equal((await c.call('POST', '/api/auth/change-email', { email: 'new-profile@wf.test', password: 'wrong' })).status, 400);
  assert.equal((await c.call('POST', '/api/auth/change-email', { email: 'boss@wf.test', password: PW })).status, 409);
  assert.equal((await c.call('POST', '/api/auth/change-email', { email: 'new-profile@wf.test', password: PW })).status, 200);
  assert.equal(one(`SELECT email FROM users WHERE email='profile@wf.test'`).email, 'profile@wf.test', 'not changed until confirmed');
  const uid = one(`SELECT id FROM users WHERE email='profile@wf.test'`).id;
  const token = 'email-change-test-token-123';
  run(`DELETE FROM tokens WHERE user_id = ?`, uid);
  run(`INSERT INTO tokens (token_hash, user_id, purpose, expires_at, data) VALUES (?, ?, 'email_change', datetime('now','+1 hour'), 'new-profile@wf.test')`, crypto.createHash('sha256').update(token).digest('hex'), uid);
  const r = await client(base).call('GET', `/api/auth/confirm-email?token=${token}`);
  assert.match(r.headers.get('location'), /changed=1/);
  assert.equal(one('SELECT email FROM users WHERE id = ?', uid).email, 'new-profile@wf.test');
  assert.equal((await c.call('GET', '/api/auth/me')).status, 401, 'sessions revoked after email change');
});

test('lifecycle emails: welcome, trial ending/ended, usage limits, disconnected mailbox — each sent once', async () => {
  const c = client(base); await c.signup('life@wf.test');
  const wsId = await wsOf(c);
  const sent = (kind) => one('SELECT COUNT(*) AS n FROM lifecycle_sent WHERE workspace_id = ? AND kind = ?', wsId, kind).n;
  assert.equal(sent('welcome'), 1);
  run('UPDATE workspaces SET trial_ends_at = ? WHERE id = ?', new Date(Date.now() + 2 * 86400_000).toISOString(), wsId);
  await checkLifecycle(); await checkLifecycle();
  assert.equal(sent('trial_ending'), 1, 'not repeated');
  run('UPDATE workspaces SET trial_ends_at = ? WHERE id = ?', new Date(Date.now() - 3600_000).toISOString(), wsId);
  await checkLifecycle();
  assert.equal(sent('trial_ended'), 1);
  pro(wsId);
  run(`INSERT INTO usage (workspace_id, period, ai_replies) VALUES (?, ?, 4100)`, wsId, new Date().toISOString().slice(0, 7));
  await checkLifecycle();
  assert.equal(sent('usage_80'), 1);
  run('UPDATE usage SET ai_replies = 6000 WHERE workspace_id = ?', wsId);
  await checkLifecycle();
  assert.equal(sent('usage_100'), 1);
  const mbId = Number(run(`INSERT INTO mailboxes (workspace_id, email, imap_host, smtp_host, username, password_enc, last_error, created_at) VALUES (?, 'down@wf.test', 'i', 's', 'u', '', 'IMAP login failed', datetime('now','-2 hours'))`, wsId).lastInsertRowid);
  run(`INSERT INTO activity (workspace_id, type, detail, created_at) VALUES (?, 'sync_error', ?, datetime('now','-1 hour'))`, wsId, JSON.stringify({ mailbox: mbId, error: 'x' }));
  await checkLifecycle();
  assert.equal(sent('mailbox_error'), 1);
  setSetting('lifecycle_emails', '0');
  run('DELETE FROM lifecycle_sent WHERE workspace_id = ?', wsId);
  await checkLifecycle();
  assert.equal(one('SELECT COUNT(*) AS n FROM lifecycle_sent WHERE workspace_id = ?', wsId).n, 0, 'switch in admin settings works');
  setSetting('lifecycle_emails', '1');
});

test('branding and pages: product name, company details, legal notice, 404', async () => {
  const home = await fetch(`${base}/`);
  assert.match(await home.text(), /<title>MailPilot AI/);
  setSetting('app_name', 'InboxHero');
  setSetting('support_email', 'help@inboxhero.example');
  const h2 = await (await fetch(`${base}/`)).text();
  assert.match(h2, /<title>InboxHero/);
  assert.ok(!h2.includes('MailPilot'), 'old name fully replaced');
  assert.match(h2, /<meta name="app-name" content="InboxHero">/);
  const terms = await (await fetch(`${base}/terms`)).text();
  assert.match(terms, /Template\./, 'template notice until company name is set');
  setSetting('company_legal_name', 'Hero Labs <Ltd>');
  setSetting('company_address', '1 Main St');
  const t2 = await (await fetch(`${base}/terms`)).text();
  assert.ok(!/Template\./.test(t2));
  assert.match(t2, /Hero Labs &lt;Ltd&gt;/, 'values are HTML-escaped');
  assert.match(await (await fetch(`${base}/privacy`)).text(), /help@inboxhero\.example/);
  const nf = await fetch(`${base}/definitely-missing`);
  assert.equal(nf.status, 404);
  assert.match(await nf.text(), /Page not found/);
  assert.equal((await fetch(`${base}/api/definitely-missing`)).status, 401, 'unknown API paths do not reveal themselves to anonymous users');
  const app = await (await fetch(`${base}/app`)).text();
  assert.match(app, /InboxHero/);
  setSetting('app_name', ''); setSetting('company_legal_name', ''); setSetting('company_address', ''); setSetting('support_email', '');
  void all;
});
