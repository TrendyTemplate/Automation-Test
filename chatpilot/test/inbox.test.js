// Team inbox: live updates (SSE), saved replies, notes, labels, assignment and round-robin auto-assign.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { client, fakeAnthropic } from './helpers.js';

const graph = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end('{"message_id":"m1"}'); }); });
await new Promise((r) => graph.listen(0, '127.0.0.1', r));
const ai = await fakeAnthropic(() => ({ reply: 'A team member will help you.', private_reply: '', language: 'en', intent: 'refund', stage: 'support', lead_score: 5, summary: 'Wants refund.', order_status: 'none',
  order: { items: [], customer_name: '', phone: '', address: '', delivery_zone: '', note: '' }, handoff: true, handoff_reason: 'Refund request', confidence: 0.4, unsupported_claims: false }));
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_LIMIT = '500';
process.env.ANTHROPIC_BASE_URL = ai.url;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.META_GRAPH_URL = `http://127.0.0.1:${graph.address().port}`;
process.env.SALES_DEBOUNCE_MS = '0';
process.env.LEARN_DEBOUNCE_MS = '0';
const { createApp } = await import('../src/server.js');
const { run, one } = await import('../src/db.js');
const { seal } = await import('../src/vault.js');
const { flushSales } = await import('../src/services/sales.js');

const SECRET = '0123456789abcdef0123456789abcdef';
let server; let base; let owner; let ws; let conv; let mate;
before(async () => {
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  owner = client(base); await owner.signup('boss@inbox.test');
  ws = (await owner.call('GET', '/api/auth/me')).body.workspace.id;
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly' WHERE id = ?`, ws);
  run(`INSERT INTO channels (workspace_id, platform, name, external_id, access_token_enc, app_secret_enc, verify_token, mode) VALUES (?, 'messenger', 'Shop', '700001', ?, ?, 'cp_inbox_test_token_000000001', 'auto')`,
    ws, seal(ws, 'channels.access_token', 'T'), seal(ws, 'channels.app_secret', SECRET));
  const inv = (await owner.call('POST', '/api/team/invite', { email: 'mate@inbox.test', role: 'member' })).body;
  mate = client(base); await mate.signup('mate@inbox.test', { invite: inv.token });
});
after(() => { server.close(); graph.close(); ai.close(); });

async function customerWrites(text, mid) {
  const raw = JSON.stringify({ object: 'page', entry: [{ id: '700001', messaging: [{ sender: { id: 'psid-x' }, recipient: { id: '700001' }, timestamp: Date.now(), message: { mid, text } }] }] });
  await fetch(`${base}/api/social/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}` }, body: raw });
  await flushSales();
}

test('live updates: the dashboard is told about new messages and hand-offs instantly (no content in the event)', async () => {
  const ctl = new AbortController();
  const res = await fetch(`${base}/api/sales/stream`, { headers: { cookie: owner.cookie }, signal: ctl.signal });
  assert.match(res.headers.get('content-type'), /^text\/event-stream/);
  const reader = res.body.getReader();
  let got = '';
  const read = (async () => { for (;;) { const { value, done } = await reader.read(); if (done) break; got += Buffer.from(value).toString(); if (/event: handoff/.test(got)) break; } })();
  run(`UPDATE workspaces SET auto_assign = 1 WHERE id = ?`, ws);
  await customerWrites('I want a refund for my secret order', 'mid-1');
  await Promise.race([read, new Promise((r) => setTimeout(r, 3000))]);
  ctl.abort();
  assert.match(got, /event: message/);
  assert.match(got, /event: handoff/);
  assert.ok(!got.includes('secret order'), 'events carry ids only');
  conv = one(`SELECT * FROM conversations WHERE customer_id = 'psid-x'`);
  assert.ok(conv.assigned_to, 'round-robin auto-assign on hand-off');
  assert.equal((await client(base).call('GET', '/api/sales/stream')).status, 401);
});

test('saved replies: create, unique shortcut, edit, count uses, delete; team members can use them', async () => {
  assert.equal((await owner.call('POST', '/api/sales/saved-replies', { shortcut: 'bad shortcut!', body: 'x' })).status, 400);
  const r = (await owner.call('POST', '/api/sales/saved-replies', { shortcut: '/bKash', body: 'bKash 01XXXXXXXXX — send and share TrxID, {{name}}' })).body;
  assert.equal(r.shortcut, 'bkash');
  assert.equal((await owner.call('POST', '/api/sales/saved-replies', { shortcut: 'bkash', body: 'dup' })).status, 409);
  await mate.call('POST', `/api/sales/saved-replies/${r.id}/used`);
  await owner.call('PUT', `/api/sales/saved-replies/${r.id}`, { body: 'Updated text' });
  const list = (await mate.call('GET', '/api/sales/saved-replies')).body;
  assert.deepEqual([list[0].body, list[0].uses], ['Updated text', 1]);
  const other = client(base); await other.signup('x@inbox.test');
  assert.equal((await other.call('GET', '/api/sales/saved-replies')).body.length, 0);
  await other.call('DELETE', `/api/sales/saved-replies/${r.id}`);
  assert.equal((await owner.call('GET', '/api/sales/saved-replies')).body.length, 1, 'other workspaces cannot delete it');
});

test('notes (encrypted, team-only), labels with filter, assignment with "mine" view', async () => {
  await mate.call('POST', `/api/sales/conversations/${conv.id}/notes`, { body: 'Called her, refund approved' });
  assert.ok(!JSON.stringify(one('SELECT body FROM conversation_notes')).includes('refund approved'), 'encrypted at rest');
  await owner.call('PUT', `/api/sales/conversations/${conv.id}`, { labels: ['VIP', 'refund', 'vip'] });
  const d = (await owner.call('GET', `/api/sales/conversations/${conv.id}`)).body;
  assert.deepEqual(d.labels, ['vip', 'refund']);
  assert.equal(d.notes[0].body, 'Called her, refund approved');
  assert.equal((await owner.call('GET', '/api/sales/conversations?label=vip')).body.length, 1);
  assert.equal((await owner.call('GET', '/api/sales/conversations?label=wholesale')).body.length, 0);
  const mateId = one(`SELECT id FROM users WHERE email = 'mate@inbox.test'`).id;
  const outsider = one(`SELECT id FROM users WHERE email = 'x@inbox.test'`).id;
  assert.equal((await owner.call('PUT', `/api/sales/conversations/${conv.id}`, { assigned_to: outsider })).status, 400);
  await owner.call('PUT', `/api/sales/conversations/${conv.id}`, { assigned_to: mateId });
  assert.equal((await mate.call('GET', '/api/sales/conversations?view=mine')).body.length, 1);
  assert.equal((await owner.call('GET', '/api/sales/conversations?view=mine')).body.length, 0);
  assert.equal((await owner.call('GET', '/api/sales/conversations')).body[0].assignee.length > 0, true);
});
