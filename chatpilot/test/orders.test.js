// Orders: delivery zones, manual orders, editing, stock, payments, status messages to customers, CSV.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { client } from './helpers.js';

const sent = [];
const graph = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; });
  req.on('end', () => { res.setHeader('content-type', 'application/json'); if (req.method === 'POST') sent.push({ url: req.url, body: JSON.parse(b || '{}') }); res.end('{"message_id":"m1","name":"x"}'); });
});
await new Promise((r) => graph.listen(0, '127.0.0.1', r));
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_LIMIT = '500';
process.env.META_GRAPH_URL = `http://127.0.0.1:${graph.address().port}`;
const { createApp } = await import('../src/server.js');
const { run, one } = await import('../src/db.js');
const { seal } = await import('../src/vault.js');
const { pickZone, priceOrder } = await import('../src/services/orders.js');

let server; let base; let c; let ws; let hoodie; let panjabi;
before(async () => {
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  c = client(base);
  await c.signup('orders@shop.test');
  ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly' WHERE id = ?`, ws);
  hoodie = (await c.call('POST', '/api/sales/products', { name: 'Black Hoodie', price: 1200, stock: 10 })).body;
  panjabi = (await c.call('POST', '/api/sales/products', { name: 'Panjabi', price: 1650, stock: 5 })).body;
});
after(() => { server.close(); graph.close(); });

test('delivery zones: defaults, keyword matching, AI suggestion, free delivery threshold, validation', async () => {
  const w = one('SELECT * FROM workspaces WHERE id = ?', ws);
  assert.equal(pickZone(w, 'House 5, Mirpur 10, Dhaka').name, 'Inside Dhaka');
  assert.equal(pickZone(w, 'Sadar, Cumilla').name, 'Outside Dhaka');
  assert.equal(pickZone(w, 'Cumilla', 'Inside Dhaka').name, 'Inside Dhaka', 'a valid zone name from the AI wins');
  assert.equal(pickZone(w, 'Cumilla', 'Moon').name, 'Outside Dhaka', 'invented zone names are ignored');
  assert.equal((await c.call('PUT', '/api/sales/delivery', { zones: [{ name: '', charge: 5 }] })).status, 400);
  assert.equal((await c.call('PUT', '/api/sales/delivery', { zones: [{ name: 'Chattogram city', charge: 60, match: 'chattogram, ctg' }, { name: 'Everywhere else', charge: 120 }], free_over: 3000 })).status, 200);
  const p = priceOrder(ws, [{ product_id: hoodie.id, qty: 1 }], { address: 'Agrabad, CTG' });
  assert.deepEqual([p.subtotal, p.delivery.zone, p.delivery.charge, p.total], [1200, 'Chattogram city', 60, 1260]);
  const free = priceOrder(ws, [{ product_id: hoodie.id, qty: 3 }], { address: 'Sylhet' });
  assert.deepEqual([free.delivery.zone, free.delivery.charge, free.total], ['Everywhere else', 0, 3600]);
  assert.equal((await c.call('PUT', '/api/sales/delivery', { enabled: false, zones: [] })).status, 200);
  assert.equal(priceOrder(ws, [{ product_id: hoodie.id, qty: 1 }], { address: 'Dhaka' }).delivery.charge, 0);
  await c.call('PUT', '/api/sales/delivery', { zones: [{ name: 'Inside Dhaka', charge: 70, match: 'dhaka' }, { name: 'Outside Dhaka', charge: 130 }] });
});

test('manual order, edit with stock recalculation, payment, return restocks, CSV', async () => {
  assert.equal((await c.call('POST', '/api/sales/orders', { customer_name: 'A', items: [] })).status, 400);
  assert.equal((await c.call('POST', '/api/sales/orders', { customer_name: 'A', customer_phone: '1', customer_address: 'x', items: [{ product_id: hoodie.id, qty: 99 }] })).status, 400, 'more than in stock');
  const o = (await c.call('POST', '/api/sales/orders', { customer_name: 'Karim', customer_phone: '01800000000', customer_address: 'Uttara, Dhaka', items: [{ product_id: hoodie.id, qty: 2, variant: 'L' }], payment_status: 'advance', paid_amount: 70, payment_method: 'bKash' })).body;
  assert.deepEqual([o.subtotal, o.delivery_zone, o.delivery_charge, o.total, o.source, o.payment_status, o.paid_amount], [2400, 'Inside Dhaka', 70, 2470, 'manual', 'advance', 70]);
  assert.equal(one('SELECT stock FROM products WHERE id = ?', hoodie.id).stock, 8);
  // edit: swap items, move outside Dhaka, add discount
  const e = await c.call('PUT', `/api/sales/orders/${o.id}`, { items: [{ product_id: hoodie.id, qty: 1 }, { product_id: panjabi.id, qty: 1 }], customer_address: 'Rajshahi', discount: 100 });
  assert.equal(e.status, 200, e.text);
  assert.deepEqual([e.body.subtotal, e.body.delivery_zone, e.body.delivery_charge, e.body.discount, e.body.total], [2850, 'Outside Dhaka', 130, 100, 2880]);
  assert.equal(one('SELECT stock FROM products WHERE id = ?', hoodie.id).stock, 9);
  assert.equal(one('SELECT stock FROM products WHERE id = ?', panjabi.id).stock, 4);
  const bad = await c.call('PUT', `/api/sales/orders/${o.id}`, { items: [{ product_id: panjabi.id, qty: 50 }] });
  assert.equal(bad.status, 400);
  assert.equal(one('SELECT stock FROM products WHERE id = ?', panjabi.id).stock, 4, 'failed edit changes nothing');
  // statuses: returned puts stock back, re-opening takes it again
  assert.equal((await c.call('PUT', `/api/sales/orders/${o.id}`, { status: 'teleported' })).status, 400);
  await c.call('PUT', `/api/sales/orders/${o.id}`, { status: 'returned' });
  assert.equal(one('SELECT stock FROM products WHERE id = ?', hoodie.id).stock, 10);
  await c.call('PUT', `/api/sales/orders/${o.id}`, { status: 'confirmed' });
  assert.equal(one('SELECT stock FROM products WHERE id = ?', hoodie.id).stock, 9);
  await c.call('PUT', `/api/sales/orders/${o.id}`, { payment_status: 'paid', paid_amount: 2880 });
  const got = (await c.call('GET', `/api/sales/orders/${o.id}`)).body;
  assert.equal(got.payment_status, 'paid'); assert.equal(got.shop.name.length > 0, true);
  assert.equal((await c.call('GET', `/api/sales/orders?q=Karim`)).body.length, 1);
  const csv = (await c.call('GET', '/api/sales/orders.csv')).text;
  assert.match(csv, /Outside Dhaka/); assert.match(csv, /bKash|paid/);
  const other = client(base); await other.signup('other@shop.test');
  assert.equal((await other.call('GET', `/api/sales/orders/${o.id}`)).status, 404);
  assert.equal((await other.call('PUT', `/api/sales/orders/${o.id}`, { status: 'cancelled' })).status, 404);
});

test('status changes message the customer in their chat — only inside the 24-hour window', async () => {
  const ch = Number(run(`INSERT INTO channels (workspace_id, platform, name, external_id, access_token_enc, app_secret_enc, verify_token) VALUES (?, 'messenger', 'P', '444001', ?, '', 'cp_tok_orders_test_000000001')`,
    ws, seal(ws, 'channels.access_token', 'T')).lastInsertRowid);
  const conv = Number(run(`INSERT INTO conversations (workspace_id, channel_id, customer_id, language, last_inbound_at) VALUES (?,?, 'psid-o', 'bn', datetime('now'))`, ws, ch).lastInsertRowid);
  const o = (await c.call('POST', '/api/sales/orders', { conversation_id: conv, customer_name: 'Rina', customer_phone: '017', customer_address: 'Dhaka', items: [{ product_id: hoodie.id, qty: 1 }] })).body;
  sent.length = 0;
  await c.call('PUT', `/api/sales/orders/${o.id}`, { status: 'confirmed' });
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.message.text, /অর্ডার #\d+ কনফার্ম/, 'in the customer\'s language');
  run(`UPDATE orders SET tracking_code = 'TRK123' WHERE id = ?`, o.id);
  await c.call('PUT', `/api/sales/orders/${o.id}`, { status: 'shipped' });
  assert.match(sent[1].body.message.text, /TRK123/);
  run(`UPDATE conversations SET last_inbound_at = datetime('now', '-2 days') WHERE id = ?`, conv);
  await c.call('PUT', `/api/sales/orders/${o.id}`, { status: 'delivered' });
  assert.equal(sent.length, 2, 'no free message after 24 hours');
  assert.ok(one(`SELECT id FROM activity WHERE workspace_id = ? AND type = 'notify_skipped'`, ws));
  run('UPDATE workspaces SET notify_customers = 0 WHERE id = ?', ws);
  run(`UPDATE conversations SET last_inbound_at = datetime('now') WHERE id = ?`, conv);
  await c.call('PUT', `/api/sales/orders/${o.id}`, { status: 'cancelled' });
  assert.equal(sent.length, 2, 'notifications can be turned off');
});
