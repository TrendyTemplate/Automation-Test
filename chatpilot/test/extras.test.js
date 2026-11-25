// Coupons, stock per size/colour, Meta Conversions API purchase events, team report.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { client } from './helpers.js';

const posted = [];
const graph = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; });
  req.on('end', () => { res.setHeader('content-type', 'application/json'); if (req.method === 'POST') posted.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(b || '{}') }); res.end('{"events_received":1}'); });
});
await new Promise((r) => graph.listen(0, '127.0.0.1', r));
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_LIMIT = '500';
process.env.META_GRAPH_URL = `http://127.0.0.1:${graph.address().port}`;
const { createApp } = await import('../src/server.js');
const { run, one } = await import('../src/db.js');
const { seal } = await import('../src/vault.js');
const { priceOrder, createOrder, setStatus } = await import('../src/services/orders.js');
const { sendPurchase } = await import('../src/services/capi.js');

let server; let c; let ws; let tee;
before(async () => {
  server = createApp().listen(0);
  c = client(`http://127.0.0.1:${server.address().port}`);
  await c.signup('extras@shop.test');
  ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly' WHERE id = ?`, ws);
});
after(() => { server.close(); graph.close(); });

test('stock per size: validated, the assistant can only sell what is there, orders and returns move the right size', async () => {
  assert.equal((await c.call('POST', '/api/sales/products', { name: 'T', price: 500, variant_stock: 'M:-1' })).status, 400);
  const r = await c.call('POST', '/api/sales/products', { name: 'Tee', price: 500, variant_stock: 'M:2, L:0, XL:3' });
  assert.equal(r.status, 200, r.text);
  tee = r.body;
  assert.equal(tee.stock, 5, 'total follows the sizes');
  assert.match(priceOrder(ws, [{ product_id: tee.id, qty: 1, variant: '' }]).problems[0], /choose one of M, L, XL/);
  assert.match(priceOrder(ws, [{ product_id: tee.id, qty: 1, variant: 'l' }]).problems[0], /\(L\): only 0/);
  const p = priceOrder(ws, [{ product_id: tee.id, qty: 2, variant: 'm' }]);
  assert.deepEqual([p.problems.length, p.lines[0].variant], [0, 'M'], 'size matched case-insensitively');
  const id = createOrder(ws, { priced: p, name: 'A', phone: '01700000000', address: 'Dhaka' });
  let row = one('SELECT stock, variant_stock FROM products WHERE id = ?', tee.id);
  assert.deepEqual([row.stock, JSON.parse(row.variant_stock).M], [3, 0]);
  setStatus(one('SELECT * FROM orders WHERE id = ?', id), 'cancelled');
  row = one('SELECT stock, variant_stock FROM products WHERE id = ?', tee.id);
  assert.deepEqual([row.stock, JSON.parse(row.variant_stock).M], [5, 2], 'cancel puts the size back');
});

test('coupons: percent, fixed, free delivery, minimum, expiry, usage limit', async () => {
  assert.equal((await c.call('POST', '/api/sales/coupons', { code: 'X', kind: 'percent', value: 10 })).status, 400, 'code too short');
  assert.equal((await c.call('POST', '/api/sales/coupons', { code: 'BIG', kind: 'percent', value: 150 })).status, 400);
  for (const cp of [{ code: 'eid20', kind: 'percent', value: 20, max_uses: 1 }, { code: 'MIN1000', kind: 'fixed', value: 100, min_order: 1000 },
    { code: 'FREESHIP', kind: 'free_delivery' }, { code: 'OLD', kind: 'fixed', value: 50, expires_at: '2020-01-01' }]) {
    const r = await c.call('POST', '/api/sales/coupons', cp);
    assert.equal(r.status, 200, r.text);
  }
  assert.equal((await c.call('POST', '/api/sales/coupons', { code: 'EID20', kind: 'fixed', value: 1 })).status, 400, 'duplicate');
  const line = [{ product_id: tee.id, qty: 1, variant: 'XL' }];
  const a = priceOrder(ws, line, { address: 'Mirpur, Dhaka', coupon: ' eid20 ' });
  assert.deepEqual([a.coupon, a.discount, a.total], ['EID20', 100, 500 - 100 + 70]);
  assert.match(priceOrder(ws, line, { coupon: 'MIN1000' }).couponError, /at least 1000/);
  assert.equal(priceOrder(ws, line, { address: 'Sylhet', coupon: 'FREESHIP' }).delivery.charge, 0);
  assert.match(priceOrder(ws, line, { coupon: 'OLD' }).couponError, /expired/);
  assert.match(priceOrder(ws, line, { coupon: 'NOPE' }).couponError, /not valid/);
  // Manual order with the coupon uses it up.
  const o = await c.call('POST', '/api/sales/orders', { customer_name: 'B', customer_phone: '01800000000', customer_address: 'Dhaka', items: line, coupon: 'EID20' });
  assert.equal(o.status, 200, o.text);
  assert.deepEqual([o.body.coupon, o.body.discount], ['EID20', 100]);
  assert.match(priceOrder(ws, line, { coupon: 'EID20' }).couponError, /fully used/);
});

test('Conversions API: a chat order is reported to Meta once, with the right ids', async () => {
  assert.equal((await c.call('PUT', '/api/sales/capi', { dataset_id: 'abc', token: 't' })).status, 400);
  const r = await c.call('PUT', '/api/sales/capi', { dataset_id: '123456789', token: 'CAPI-TOKEN', test_code: 'TEST1' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.enabled, true);
  assert.ok(!JSON.stringify(r.body).includes('CAPI-TOKEN'), 'token never returned');
  assert.match(one('SELECT capi_json FROM workspaces WHERE id = ?', ws).capi_json, /"token":"e3\./, 'token stored encrypted');
  const ch = Number(run(`INSERT INTO channels (workspace_id, platform, name, external_id, access_token_enc, app_secret_enc, verify_token) VALUES (?, 'messenger', 'P', '940001', ?, '', 'cp_capi_tok_00000000000000001')`, ws, seal(ws, 'channels.access_token', 'T')).lastInsertRowid);
  const conv = Number(run(`INSERT INTO conversations (workspace_id, channel_id, customer_id) VALUES (?,?, 'psid-ads')`, ws, ch).lastInsertRowid);
  const id = createOrder(ws, { conversationId: conv, priced: priceOrder(ws, [{ product_id: tee.id, qty: 1, variant: 'XL' }], { address: 'Dhaka' }), name: 'C', phone: '01900000000', address: 'Dhaka' });
  posted.length = 0;
  assert.equal(await sendPurchase(id), true);
  assert.equal(await sendPurchase(id), false, 'only once');
  assert.equal(posted.length, 1);
  assert.match(posted[0].path, /\/123456789\/events$/);
  assert.equal(posted[0].auth, 'Bearer CAPI-TOKEN');
  const e = posted[0].body.data[0];
  assert.deepEqual([e.event_name, e.action_source, e.messaging_channel, e.user_data.page_id, e.user_data.page_scoped_user_id, e.custom_data.value, posted[0].body.test_event_code],
    ['Purchase', 'business_messaging', 'messenger', '940001', 'psid-ads', 570, 'TEST1']);
});

test('team report lists each person', async () => {
  const a = (await c.call('GET', '/api/sales/analytics')).body;
  assert.equal(a.team.length, 1);
  assert.deepEqual(Object.keys(a.team[0]).sort(), ['approved', 'assigned', 'id', 'name', 'orders', 'typed']);
});
