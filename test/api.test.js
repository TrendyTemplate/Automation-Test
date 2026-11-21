import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAILS = 'admin@test.com';
delete process.env.ANTHROPIC_API_KEY;
const { createApp } = await import('../src/server.js');
const { run, one } = await import('../src/db.js');
const { storeMessage, processMessage } = await import('../src/services/processor.js');
const { encrypt } = await import('../src/crypto.js');

let server; let base; let cookie = '';
before(async () => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

async function call(method, path, body, ck = cookie) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: ck }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('signup, me, settings, knowledge, rules, pipeline', async () => {
  let r = await call('POST', '/api/auth/signup', { email: 'admin@test.com', password: 'password123', name: 'Ada', company: 'Acme' });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/auth/me');
  assert.equal(r.body.effectivePlan.key, 'trial');
  assert.equal(r.body.user.is_admin, 1);
  const wsId = r.body.workspace.id;

  assert.equal((await call('POST', '/api/auth/signup', { email: 'admin@test.com', password: 'password123' })).status, 409);
  assert.equal((await call('POST', '/api/auth/login', { email: 'admin@test.com', password: 'wrong-pass' })).status, 401);

  r = await call('PUT', '/api/settings', { business_description: 'We sell shoes', reply_tone: '' });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/settings')).body.reply_tone, 'friendly and professional');

  assert.equal((await call('POST', '/api/knowledge', { title: 'Shipping', content: '3-5 days worldwide' })).status, 200);
  const tpl = await call('POST', '/api/templates', { name: 'Thanks', subject: '', body: 'Hi {{first_name}}, thanks for writing!' });

  r = await call('POST', '/api/rules', { name: 'bad', conditions: { items: [{ field: 'nope', op: 'contains', value: 'x' }] }, actions: [{ type: 'ignore' }] });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/rules', { name: 'Thank-you template', conditions: { match: 'all', items: [{ field: 'subject', op: 'contains', value: 'hello' }] }, actions: [{ type: 'template_reply', template_id: tpl.body.id, mode: 'draft' }] });
  assert.equal(r.status, 200);

  // Insert a mailbox directly (no real IMAP server in tests) and push messages through the pipeline.
  const mb = run(`INSERT INTO mailboxes (workspace_id, email, imap_host, smtp_host, username, password_enc, mode) VALUES (?,?,?,?,?,?, 'draft')`,
    wsId, 'support@acme.com', 'imap.x', 'smtp.x', 'support@acme.com', encrypt('pw'));
  const mailbox = one('SELECT * FROM mailboxes WHERE id = ?', Number(mb.lastInsertRowid));

  const id1 = storeMessage(mailbox, { uid: 1, message_id: '<a@x>', from_name: 'Jane Doe', from_email: 'jane@client.com', subject: 'Hello there', text_body: 'Hi!', received_at: new Date().toISOString(), headers: {} });
  await processMessage(id1);
  const reply = one('SELECT * FROM replies WHERE message_id = ?', id1);
  assert.equal(reply.status, 'pending');
  assert.equal(reply.body, 'Hi Jane, thanks for writing!');

  const id2 = storeMessage(mailbox, { uid: 2, message_id: '<b@x>', from_email: 'no-reply@shop.com', subject: 'Your order', text_body: 'Order shipped', received_at: new Date().toISOString(), headers: {} });
  await processMessage(id2);
  assert.equal(one('SELECT status FROM messages WHERE id = ?', id2).status, 'ignored');
  assert.equal(storeMessage(mailbox, { uid: 2, message_id: '<b@x>', from_email: 'x@y.z', headers: {} }), null, 'duplicates are skipped');

  r = await call('GET', '/api/replies?status=pending');
  assert.equal(r.body.length, 1);
  r = await call('GET', '/api/dashboard');
  assert.equal(r.body.counts.total, 2);

  // Tenant isolation: a second user can't see the first workspace's data.
  const other = await (async () => { const c0 = cookie; cookie = ''; await call('POST', '/api/auth/signup', { email: 'b@test.com', password: 'password123' }); const c = cookie; cookie = c0; return c; })();
  r = await call('GET', `/api/messages/${id1}`, null, other);
  assert.equal(r.status, 404);
  r = await call('GET', '/api/admin/overview', null, other);
  assert.equal(r.status, 403);
  r = await call('GET', '/api/admin/overview');
  assert.equal(r.body.users, 2);
});

test('CSRF: cross-origin POST is rejected', async () => {
  const res = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://evil.com', cookie }, body: '{}' });
  assert.equal(res.status, 403);
});
