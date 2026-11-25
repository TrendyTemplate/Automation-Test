// Couriers: connect (keys verified), one-click booking with COD amount, status sync by polling and webhook,
// customer notified, fraud check (own history + BDCourier/Steadfast), Bangla-digit phone normalisation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { client } from './helpers.js';

const calls = [];
let sfStatus = 'in_review';
let pathaoStatus = 'Pending';
const courier = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const p = u.pathname; const body = b ? JSON.parse(b) : {};
    calls.push({ method: req.method, p, h: req.headers, body });
    const j = (o, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    // Steadfast
    if (p === '/sf/get_balance') return req.headers['api-key'] === 'good' ? j({ status: 200, current_balance: 4820 }) : j({ status: 401, message: 'Unauthorized' }, 401);
    if (p === '/sf/create_order') return j({ status: 200, message: 'ok', consignment: { consignment_id: 131822154, invoice: body.invoice, tracking_code: '7DB724A65D4', status: 'in_review' } });
    if (p.startsWith('/sf/status_by_cid/')) return j({ status: 200, delivery_status: sfStatus });
    if (p.startsWith('/sf/fraud_check/')) return j({ total_parcels: 24, total_delivered: 9, total_cancelled: 15, total_fraud_reports: [] });
    // Pathao
    if (p === '/pa/aladdin/api/v1/issue-token') return body.password === 'pw' ? j({ token_type: 'Bearer', expires_in: 3600, access_token: 'PTOKEN', refresh_token: 'R' }) : j({ message: 'Unauthorized', type: 'error' }, 401);
    if (p === '/pa/aladdin/api/v1/stores') return j({ message: 'ok', type: 'success', code: 200, data: { data: [{ store_id: 7 }] } });
    if (p === '/pa/aladdin/api/v1/orders') return j({ message: 'Order Created', type: 'success', code: 200, data: { consignment_id: 'DL121224VS8TTJ', merchant_order_id: body.merchant_order_id, order_status: 'Pending', delivery_fee: 83.46 } });
    if (p.endsWith('/info')) return j({ type: 'success', data: { consignment_id: 'DL121224VS8TTJ', order_status: pathaoStatus, order_status_slug: pathaoStatus } });
    // RedX
    if (p === '/rx/areas') return j({ areas: [{ id: 1, name: 'Mirpur' }] });
    if (p === '/rx/parcel') return j({ tracking_id: '21A427TU4BN3R' });
    // BDCourier
    if (p === '/bd/courier-check') return j({ status: 'success', data: { summary: { total_parcel: 10, success_parcel: 2, cancelled_parcel: 8, success_ratio: 20 }, pathao: { name: 'Pathao', total_parcel: 6, success_parcel: 1, cancelled_parcel: 5 }, steadfast: { name: 'Steadfast', total_parcel: 4, success_parcel: 1, cancelled_parcel: 3 } } });
    j({ message: 'not found' }, 404);
  });
});
const sent = [];
const graph = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { if (req.method === 'POST') sent.push(JSON.parse(b || '{}')); res.setHeader('content-type', 'application/json'); res.end('{"message_id":"m"}'); }); });
await new Promise((r) => courier.listen(0, '127.0.0.1', r));
await new Promise((r) => graph.listen(0, '127.0.0.1', r));
const C = `http://127.0.0.1:${courier.address().port}`;
Object.assign(process.env, { DB_PATH: ':memory:', NODE_ENV: 'test', AUTH_RATE_LIMIT: '500', META_GRAPH_URL: `http://127.0.0.1:${graph.address().port}`,
  COURIER_STEADFAST_URL: `${C}/sf`, COURIER_PATHAO_URL: `${C}/pa`, COURIER_REDX_URL: `${C}/rx`, COURIER_BDCOURIER_URL: `${C}/bd` });
const { createApp } = await import('../src/server.js');
const { run, one } = await import('../src/db.js');
const { seal } = await import('../src/vault.js');
const { normalizePhone, syncParcels } = await import('../src/services/couriers.js');

let server; let base; let c; let ws; let product; let conv;
before(async () => {
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  c = client(base); await c.signup('courier@shop.test');
  ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly' WHERE id = ?`, ws);
  product = (await c.call('POST', '/api/sales/products', { name: 'Hoodie', price: 1200, stock: 20 })).body;
  const ch = Number(run(`INSERT INTO channels (workspace_id, platform, name, external_id, access_token_enc, app_secret_enc, verify_token) VALUES (?, 'messenger', 'P', '900001', ?, '', 'cp_courier_test_tok_000000001')`, ws, seal(ws, 'channels.access_token', 'T')).lastInsertRowid);
  conv = Number(run(`INSERT INTO conversations (workspace_id, channel_id, customer_id, language, last_inbound_at) VALUES (?,?, 'psid-c', 'en', datetime('now'))`, ws, ch).lastInsertRowid);
});
after(() => { server.close(); courier.close(); graph.close(); });
const newOrder = async (over = {}) => (await c.call('POST', '/api/sales/orders', { conversation_id: conv, customer_name: 'Rahim', customer_phone: '+880 1711-000 000', customer_address: 'House 1, Mirpur, Dhaka', items: [{ product_id: product.id, qty: 1 }], payment_status: 'advance', paid_amount: 70, ...over })).body;

test('phone numbers are normalised, Bangla digits included', () => {
  assert.equal(normalizePhone('+880 1711-000 000'), '01711000000');
  assert.equal(normalizePhone('০১৭১১০০০০০০'), '01711000000');
  assert.equal(normalizePhone('1711000000'), '01711000000');
});

test('connecting checks the keys; secrets never come back', async () => {
  const bad = await c.call('PUT', '/api/sales/couriers/steadfast', { api_key: 'wrong', secret_key: 's' });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /Steadfast rejected/);
  assert.equal((await c.call('PUT', '/api/sales/couriers/steadfast', { api_key: 'good' })).status, 400, 'secret key required');
  const ok = await c.call('PUT', '/api/sales/couriers/steadfast', { api_key: 'good', secret_key: 'sssecret' });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.body.connected, ['steadfast']);
  assert.equal((await c.call('PUT', '/api/sales/couriers/pathao', { client_id: 'c', client_secret: 's', username: 'u', password: 'nope', store_id: '7' })).status, 400);
  assert.equal((await c.call('PUT', '/api/sales/couriers/pathao', { client_id: 'c', client_secret: 's', username: 'u', password: 'pw', store_id: '7' })).status, 200);
  assert.equal((await c.call('PUT', '/api/sales/couriers/redx', { token: 'rx', area_id: '1', area_name: 'Mirpur' })).status, 200);
  const st = (await c.call('GET', '/api/sales/couriers')).body;
  assert.deepEqual(st.connected.sort(), ['pathao', 'redx', 'steadfast']);
  assert.ok(!JSON.stringify(st).includes('sssecret'));
  assert.ok(!JSON.stringify(one('SELECT courier_json FROM workspaces WHERE id = ?', ws)).includes('sssecret'), 'encrypted at rest');
});

test('Steadfast: one-click booking sends only the amount still due; polling + webhook update the order and tell the customer', async () => {
  const o = await newOrder();
  sent.length = 0;
  const r = await c.call('POST', `/api/sales/orders/${o.id}/courier`, { courier: 'steadfast' });
  assert.equal(r.status, 200, r.text);
  const req = calls.find((x) => x.p === '/sf/create_order');
  assert.equal(req.h['api-key'], 'good'); assert.equal(req.h['secret-key'], 'sssecret');
  assert.deepEqual([req.body.cod_amount, req.body.recipient_phone, req.body.invoice], [o.total - 70, '01711000000', `CP${ws}-${o.id}`]);
  assert.deepEqual([r.body.courier, r.body.consignment_id, r.body.tracking_code, r.body.status], ['steadfast', '131822154', '7DB724A65D4', 'shipped']);
  assert.match(sent[0].message.text, /on its way.*7DB724A65D4/, 'customer gets the tracking code');
  assert.equal((await c.call('POST', `/api/sales/orders/${o.id}/courier`, { courier: 'steadfast' })).status, 409, 'no double booking');
  // polling
  sfStatus = 'delivered';
  run(`UPDATE orders SET courier_updated_at = datetime('now', '-3 hours') WHERE id = ?`, o.id);
  await syncParcels();
  assert.equal(one('SELECT status FROM orders WHERE id = ?', o.id).status, 'delivered');
  // webhook: another order returned
  const o2 = await newOrder();
  await c.call('POST', `/api/sales/orders/${o2.id}/courier`, { courier: 'steadfast' });
  run(`UPDATE orders SET consignment_id = '555' WHERE id = ?`, o2.id);
  const hook = one('SELECT courier_hook FROM workspaces WHERE id = ?', ws).courier_hook;
  const stock = one('SELECT stock FROM products WHERE id = ?', product.id).stock;
  assert.equal((await fetch(`${base}/api/couriers/hook/${'0'.repeat(36)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"consignment_id":555,"status":"cancelled"}' })).status, 404);
  const wr = await fetch(`${base}/api/couriers/hook/${hook}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notification_type: 'delivery_status', consignment_id: 555, status: 'cancelled' }) });
  assert.equal(wr.status, 200);
  assert.equal(one('SELECT status FROM orders WHERE id = ?', o2.id).status, 'returned');
  assert.equal(one('SELECT stock FROM products WHERE id = ?', product.id).stock, stock + 1, 'returned parcel goes back into stock');
});

test('Pathao and RedX booking; Pathao token reused; status mapping', async () => {
  const o = await newOrder();
  const r = await c.call('POST', `/api/sales/orders/${o.id}/courier`, { courier: 'pathao' });
  assert.equal(r.status, 200, r.text);
  const req = calls.filter((x) => x.p === '/pa/aladdin/api/v1/orders').at(-1);
  assert.equal(req.h.authorization, 'Bearer PTOKEN');
  assert.deepEqual([req.body.store_id, req.body.delivery_type, req.body.item_type, req.body.amount_to_collect], [7, 48, 2, Math.round(o.total - 70)]);
  assert.equal(r.body.tracking_code, 'DL121224VS8TTJ');
  pathaoStatus = 'Returned';
  const st = await c.call('POST', `/api/sales/orders/${o.id}/courier/status`);
  assert.equal(st.body.status, 'returned');
  assert.equal(calls.filter((x) => x.p.endsWith('issue-token')).length <= 3, true, 'token cached');
  const o3 = await newOrder();
  const rx = await c.call('POST', `/api/sales/orders/${o3.id}/courier`, { courier: 'redx' });
  assert.equal(rx.body.tracking_code, '21A427TU4BN3R');
  const rreq = calls.find((x) => x.p === '/rx/parcel');
  assert.equal(rreq.h['api-access-token'], 'Bearer rx');
  assert.equal(rreq.body.delivery_area_id, 1);
  const cancelled = await newOrder();
  await c.call('PUT', `/api/sales/orders/${cancelled.id}`, { status: 'cancelled' });
  assert.equal((await c.call('POST', `/api/sales/orders/${cancelled.id}/courier`, { courier: 'redx' })).status, 409);
  assert.equal((await c.call('POST', `/api/sales/orders/${o3.id}/courier`, { courier: 'nope' })).status, 400);
});

test('fraud check combines your own returns with BDCourier (or Steadfast) history', async () => {
  const sf = (await c.call('GET', '/api/sales/fraud-check?phone=01711000000')).body;
  assert.deepEqual(sf.sources, ['your orders', 'Steadfast']);
  assert.equal(sf.delivered, 1 + 9); assert.equal(sf.returned, 3 + 15, 'two returned + one cancelled of ours');
  assert.equal((await c.call('PUT', '/api/sales/couriers/bdcourier', { api_key: 'bdkey' })).status, 200);
  const bd = (await c.call('GET', '/api/sales/fraud-check?phone=০১৭১১০০০০০০')).body;
  assert.deepEqual(bd.sources, ['your orders', 'BDCourier']);
  assert.equal(bd.couriers.length, 2);
  assert.ok(bd.ratio < 50);
  assert.equal((await c.call('GET', '/api/sales/fraud-check?phone=12')).status, 400);
  const other = client(base); await other.signup('o@shop.test');
  const none = (await other.call('GET', '/api/sales/fraud-check?phone=01711000000')).body;
  assert.equal(none.total, 0, 'other shops do not see this shop\'s customers');
});
