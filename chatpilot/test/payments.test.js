// bKash / Nagad: settings, the assistant is told where to pay, TrxID attached to the order for a person to verify, reused TrxIDs flagged.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { client, fakeAnthropic } from './helpers.js';

const graph = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end('{"message_id":"m1"}'); }); });
await new Promise((r) => graph.listen(0, '127.0.0.1', r));
const aiReqs = []; let pay = { method: '', trx_id: '', amount: 0 };
const ai = await fakeAnthropic((body) => { aiReqs.push(body); return { reply: 'Dhonnobad! Amader team check kore janabe.', product_photos: [], private_reply: '', language: 'bn', intent: 'paid advance', stage: 'ordered', lead_score: 90, summary: 'Paid.',
  order_status: 'none', order: { items: [], customer_name: '', phone: '', address: '', delivery_zone: '', note: '' }, payment: pay, handoff: false, handoff_reason: '', confidence: 0.95, unsupported_claims: false }; });
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
let server; let base; let c; let ws; let order1; let order2;
before(async () => {
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  c = client(base); await c.signup('pay@shop.test');
  ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly' WHERE id = ?`, ws);
  const p = (await c.call('POST', '/api/sales/products', { name: 'Hoodie', price: 1200, stock: 10 })).body;
  const ch = Number(run(`INSERT INTO channels (workspace_id, platform, name, external_id, access_token_enc, app_secret_enc, verify_token, mode) VALUES (?, 'messenger', 'Shop', '920001', ?, ?, 'cp_pay_test_tok_0000000000001', 'auto')`,
    ws, seal(ws, 'channels.access_token', 'T'), seal(ws, 'channels.app_secret', SECRET)).lastInsertRowid);
  const conv = Number(run(`INSERT INTO conversations (workspace_id, channel_id, customer_id, last_inbound_at) VALUES (?,?, 'psid-pay', datetime('now'))`, ws, ch).lastInsertRowid);
  const mk = async () => (await c.call('POST', '/api/sales/orders', { customer_name: 'R', customer_phone: '01711000000', customer_address: 'Mirpur, Dhaka', items: [{ product_id: p.id, qty: 1 }] })).body;
  order1 = await mk(); order2 = await mk();
  run('UPDATE orders SET conversation_id = ? WHERE id = ?', conv, order1.id);
});
after(() => { server.close(); graph.close(); ai.close(); });
async function say(text) {
  const raw = JSON.stringify({ object: 'page', entry: [{ id: '920001', messaging: [{ sender: { id: 'psid-pay' }, recipient: { id: '920001' }, timestamp: Date.now(), message: { mid: `m${Math.random()}`, text } }] }] });
  await fetch(`${base}/api/social/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}` }, body: raw });
  await flushSales();
}

test('payment settings are validated and shown to the assistant', async () => {
  assert.equal((await c.call('PUT', '/api/sales/payments', { methods: { bkash: '12345' } })).status, 400);
  const r = await c.call('PUT', '/api/sales/payments', { methods: { bkash: '+8801712-345678', nagad: '01812345678' }, account_type: 'personal', advance: 'delivery' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.methods.bkash, '01712345678');
  await say('order dite chai');
  const system = JSON.stringify(aiReqs.at(-1).system);
  assert.match(system, /bKash personal 01712345678 \(Send Money\)/);
  assert.match(system, /delivery charge in advance/);
});

test('a TrxID from the chat waits on the order for a person to verify', async () => {
  pay = { method: 'bkash', trx_id: '8n7a 6b5c4d', amount: 70 };
  await say('70 taka bkash korechi, TrxID 8N7A6B5C4D');
  let o = one('SELECT * FROM orders WHERE id = ?', order1.id);
  assert.deepEqual([o.payment_trx, o.payment_method, o.payment_claim, o.payment_check, o.payment_status], ['8N7A6B5C4D', 'bKash', 70, 'pending', 'unpaid'], 'never marked paid automatically');
  assert.equal((await c.call('POST', `/api/sales/orders/${order1.id}/payment`, { ok: true, amount: 0 })).status, 400);
  const v = await c.call('POST', `/api/sales/orders/${order1.id}/payment`, { ok: true, amount: 70 });
  assert.equal(v.status, 200, v.text);
  assert.deepEqual([v.body.payment_check, v.body.payment_status, v.body.paid_amount], ['verified', 'advance', 70]);
  // The same TrxID on another order is flagged.
  run('UPDATE orders SET conversation_id = (SELECT conversation_id FROM orders WHERE id = ?) WHERE id = ?', order1.id, order2.id);
  await say('ei je TrxID 8N7A6B5C4D');
  o = one('SELECT * FROM orders WHERE id = ?', order2.id);
  assert.equal(o.payment_check, 'reused');
  assert.ok(one(`SELECT 1 AS x FROM activity WHERE workspace_id = ? AND type = 'payment_claim' AND detail LIKE '%already used%'`, ws));
  const rej = await c.call('POST', `/api/sales/orders/${order2.id}/payment`, { ok: false });
  assert.equal(rej.body.payment_check, 'rejected');
  assert.equal(rej.body.payment_status, 'unpaid');
});

test('nonsense TrxIDs are ignored', async () => {
  pay = { method: 'bkash', trx_id: 'abc', amount: 5 };
  await say('paid');
  assert.equal(one('SELECT payment_trx FROM orders WHERE id = ?', order2.id).payment_trx, '8N7A6B5C4D');
});
