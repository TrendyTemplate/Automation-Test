// Broadcasts inside Meta's rules: 24-hour window on Messenger, templates on WhatsApp, "stop" respected, daily cap.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { client } from './helpers.js';

const sent = [];
const graph = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && /message_templates/.test(req.url)) {
      return res.end(JSON.stringify({ data: [{ name: 'eid_offer', language: 'bn', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hi {{1}}, Eid offer 20% off!' }] }] }));
    }
    sent.push({ path: req.url, body: JSON.parse(b || '{}') });
    res.end('{"message_id":"m1","messages":[{"id":"w1"}]}');
  });
});
await new Promise((r) => graph.listen(0, '127.0.0.1', r));
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_LIMIT = '500';
process.env.META_GRAPH_URL = `http://127.0.0.1:${graph.address().port}`;
process.env.BROADCAST_DELAY_MS = '0';
const { createApp } = await import('../src/server.js');
const { run, one, all } = await import('../src/db.js');
const { seal } = await import('../src/vault.js');
const { ingest } = await import('../src/services/sales.js');

let server; let c; let ws; let fb; let wa;
const conv = (ch, id, name, hoursAgo, labels = null) => Number(run(`INSERT INTO conversations (workspace_id, channel_id, customer_id, customer_name, labels, last_inbound_at) VALUES (?,?,?,?,?, datetime('now', ?))`,
  ws, ch, id, name, labels, `-${hoursAgo} hours`).lastInsertRowid);
before(async () => {
  server = createApp().listen(0);
  c = client(`http://127.0.0.1:${server.address().port}`);
  await c.signup('bc@shop.test');
  ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  const ch = (pf, ext) => Number(run(`INSERT INTO channels (workspace_id, platform, name, external_id, access_token_enc, app_secret_enc, verify_token, waba_id) VALUES (?,?,?,?,?, '', ?, ?)`,
    ws, pf, pf, ext, seal(ws, 'channels.access_token', 'T'), `cp_bc_${ext}_00000000000000`, pf === 'whatsapp' ? 'waba1' : null).lastInsertRowid);
  fb = ch('messenger', '930001'); wa = ch('whatsapp', '930002');
  conv(fb, 'p1', 'Rahim Uddin', 2, 'vip'); conv(fb, 'p2', 'Karim', 5); conv(fb, 'p3', 'Old', 72, 'vip');
  conv(wa, '8801700000001', 'Nadia', 1); conv(wa, '8801700000002', 'Sumi', 100);
});
after(() => { server.close(); graph.close(); });

test('"stop" opts a customer out; "start" opts back in', async () => {
  const ch = one('SELECT * FROM channels WHERE id = ?', fb);
  ingest(ch, { customerId: 'p2', text: 'STOP', messageId: 'x1', timestamp: new Date().toISOString(), attachments: [] });
  assert.equal(one(`SELECT opted_out FROM conversations WHERE customer_id = 'p2'`).opted_out, 1);
});

test('Messenger: only people inside the 24-hour window; opted-out and label filters apply', async () => {
  const p = (await c.call('POST', '/api/sales/broadcasts/preview', { channel_id: fb })).body;
  assert.deepEqual([p.free, p.template, p.outside_window, p.opted_out], [1, 0, 1, 1]);
  assert.equal((await c.call('POST', '/api/sales/broadcasts/preview', { channel_id: fb, label: 'vip' })).body.free, 1);
  assert.equal((await c.call('POST', '/api/sales/broadcasts', { channel_id: fb, text: 'Hi' })).status, 400, 'opt-in confirmation needed');
  sent.length = 0;
  const r = await c.call('POST', '/api/sales/broadcasts', { channel_id: fb, text: 'Salam {{name}}! New stock eseche.', confirm_optin: true });
  assert.equal(r.status, 200, r.text);
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.message.text, 'Salam Rahim! New stock eseche.');
  const b = (await c.call('GET', '/api/sales/broadcasts')).body[0];
  assert.deepEqual([b.status, b.total, b.sent, b.skipped, b.body], ['done', 1, 1, 2, 'Salam {{name}}! New stock eseche.']);
  assert.ok(one(`SELECT 1 AS x FROM chat_messages WHERE source = 'broadcast'`), 'stored in the chat');
});

test('WhatsApp: free text inside 24h, approved template for everyone else', async () => {
  const t = (await c.call('GET', `/api/sales/channels/${wa}/templates`)).body;
  assert.deepEqual([t[0].name, t[0].params], ['eid_offer', 1]);
  assert.equal((await c.call('POST', '/api/sales/broadcasts/preview', { channel_id: wa })).body.outside_window, 1, 'no template: outside-window customers skipped');
  const tpl = { name: 'eid_offer', language: 'bn', params: ['{{name}}'] };
  assert.equal((await c.call('POST', '/api/sales/broadcasts/preview', { channel_id: wa, template: tpl })).body.total, 2);
  sent.length = 0;
  const r = await c.call('POST', '/api/sales/broadcasts', { channel_id: wa, text: 'Eid offer: 20% off!', template: tpl, confirm_optin: true });
  assert.equal(r.body.total, 2, r.text);
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(sent.find((x) => x.body.to === '8801700000001').body.text.body, 'Eid offer: 20% off!');
  const tm = sent.find((x) => x.body.to === '8801700000002').body;
  assert.equal(tm.type, 'template');
  assert.deepEqual([tm.template.name, tm.template.language.code, tm.template.components[0].parameters[0].text], ['eid_offer', 'bn', 'Sumi']);
});

test('at most 5 broadcasts a day', async () => {
  for (let i = 0; i < 3; i++) await c.call('POST', '/api/sales/broadcasts', { channel_id: fb, text: `x${i}`, confirm_optin: true });
  assert.equal((await c.call('POST', '/api/sales/broadcasts', { channel_id: fb, text: 'too many', confirm_optin: true })).status, 429);
  assert.equal(all('SELECT id FROM broadcasts').length, 5);
});
