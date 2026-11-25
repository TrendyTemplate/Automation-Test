// Regression tests for the second independent review: each test is one finding.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { client, fakeAnthropic } from './helpers.js';

const sent = []; let handler = null; let slow = 0;
const ext = http.createServer((req, res) => {
  const chunks = []; req.on('data', (d) => chunks.push(d));
  req.on('end', async () => {
    const u = new URL(req.url, 'http://x'); const p = u.pathname;
    let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* form */ }
    const r = handler?.(req.method, p, body);
    if (slow && p.endsWith('/messages')) await new Promise((x) => setTimeout(x, slow));
    res.setHeader('content-type', 'application/json');
    if (r?.status) { res.statusCode = r.status; return res.end(JSON.stringify(r.body)); }
    if (r?.body) return res.end(JSON.stringify(r.body));
    if (req.method === 'POST') sent.push({ path: p, body });
    if (p.endsWith('/token/grant')) return res.end('{"statusCode":"0000","id_token":"T"}');
    if (p.endsWith('/checkout/create')) return res.end(JSON.stringify({ statusCode: '0000', paymentID: `PAY${sent.length}`, bkashURL: 'https://pay.test/x' }));
    if (p.endsWith('/checkout/execute')) return res.end(JSON.stringify({ statusCode: '0000', transactionStatus: 'Completed', trxID: `TRX${body.paymentID}`, amount: body.paymentID === 'PAYA' ? '200' : '870' }));
    res.end(JSON.stringify({ message_id: `mid.${sent.length}`, messages: [{ id: `wamid.${sent.length}` }], data: [] }));
  });
});
await new Promise((r) => ext.listen(0, '127.0.0.1', r));
const G = `http://127.0.0.1:${ext.address().port}`;
const ai = await fakeAnthropic(() => ({ reply: 'Ji', product_photos: [], private_reply: '', language: 'bn', intent: 'q', stage: 'interested', lead_score: 50, summary: 's',
  order_status: 'none', order: { items: [], customer_name: '', phone: '', address: '', delivery_zone: '', coupon: '', note: '' }, payment: { method: '', trx_id: '', amount: 0 }, handoff: false, handoff_reason: '', confidence: 0.95, unsupported_claims: false }));
Object.assign(process.env, { DB_PATH: ':memory:', NODE_ENV: 'test', AUTH_RATE_LIMIT: '500', ANTHROPIC_BASE_URL: ai.url, ANTHROPIC_API_KEY: 'sk-ant-test', META_GRAPH_URL: G,
  SALES_DEBOUNCE_MS: '0', LEARN_DEBOUNCE_MS: '0', BROADCAST_DELAY_MS: '0', BKASH_BASE_URL: G, META_APP_SECRET: 'f'.repeat(32), META_APP_ID: '555' });
const { createApp } = await import('../src/server.js');
const { run, one, all } = await import('../src/db.js');
const { seal, open } = await import('../src/vault.js');
const { flushSales, retryFailedSends, storeOutbound, deliver } = await import('../src/services/sales.js');
const { setSetting } = await import('../src/settings.js');

const SECRET = '0123456789abcdef0123456789abcdef';
let server; let base; let c; let ws; let fb; let wa; let conv; let hoodie; let cap;
const ch = (w, pf, id, extra = {}) => Number(run(`INSERT INTO channels (workspace_id, platform, name, external_id, access_token_enc, app_secret_enc, verify_token, mode, managed, waba_id) VALUES (?,?,?,?,?,?,?, 'draft', ?, ?)`,
  w, pf, pf, id, seal(w, 'channels.access_token', 'T'), seal(w, 'channels.app_secret', SECRET), `cp_rv2_${id}_000000000000000`, extra.managed ? 1 : 0, extra.waba || null).lastInsertRowid);
before(async () => {
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  c = client(base); await c.signup('rv2@shop.test');
  ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly', notify_customers = 1 WHERE id = ?`, ws);
  fb = ch(ws, 'messenger', '980001'); wa = ch(ws, 'whatsapp', '980002', { waba: 'wb1' });
  conv = Number(run(`INSERT INTO conversations (workspace_id, channel_id, customer_id, last_inbound_at) VALUES (?,?, 'psid-a', datetime('now'))`, ws, fb).lastInsertRowid);
  hoodie = (await c.call('POST', '/api/sales/products', { name: 'Old Hoodie', price: 1000, stock: 5 })).body;
  cap = (await c.call('POST', '/api/sales/products', { name: 'Cap', price: 200, stock: 100 })).body;
});
after(() => { server.close(); ext.close(); ai.close(); });
const order = async (items, extra = {}) => (await c.call('POST', '/api/sales/orders', { customer_name: 'N', customer_phone: '01712345678', customer_address: 'Mirpur, Dhaka', items, ...extra })).body;

test('1. the same reply is never sent twice by two clicks at once', async () => {
  const id = storeOutbound({ id: conv, workspace_id: ws, kind: 'message' }, 'hello', { source: 'ai', status: 'draft' });
  sent.length = 0; slow = 200;
  const rs = await Promise.all([c.call('POST', `/api/sales/messages/${id}/approve`, {}), c.call('POST', `/api/sales/messages/${id}/approve`, {})]);
  slow = 0;
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 404], 'the second click finds nothing left to send');
  assert.equal(sent.filter((s) => s.path.endsWith('/messages')).length, 1);
});

test('2. a failed reply whose window closed stops being retried (and does not block the queue)', async () => {
  const c2 = Number(run(`INSERT INTO conversations (workspace_id, channel_id, customer_id, last_inbound_at) VALUES (?,?, 'psid-old', datetime('now', '-3 days'))`, ws, fb).lastInsertRowid);
  const id = Number(run(`INSERT INTO chat_messages (workspace_id, conversation_id, direction, source, body, status, retry_at, attempts) VALUES (?,?, 'out', 'ai', ?, 'failed', datetime('now', '-1 minute'), 1)`, ws, c2, seal(ws, 'chat_messages.body', 'x')).lastInsertRowid);
  await retryFailedSends();
  assert.equal(one('SELECT retry_at FROM chat_messages WHERE id = ?', id).retry_at, null);
});

test('3. deleting a product used by orders hides it; saving the order keeps the item', async () => {
  const o = await order([{ product_id: hoodie.id, qty: 1 }]);
  const del = await c.call('DELETE', `/api/sales/products/${hoodie.id}`);
  assert.equal(del.body.hidden, true);
  const r = await c.call('PUT', `/api/sales/orders/${o.id}`, { status: 'confirmed', items: [{ product_id: hoodie.id, qty: 1, variant: '' }], customer_address: 'Uttara, Dhaka' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.items[0].name, r.body.items[0].price], ['Old Hoodie', 1000]);
  // and when the row is really gone, kept lines still price from the order
  run('DELETE FROM products WHERE id = ?', hoodie.id);
  const r2 = await c.call('PUT', `/api/sales/orders/${o.id}`, { customer_address: 'Mirpur, Dhaka' });
  assert.equal(r2.status, 200, r2.text);
  assert.equal(r2.body.items[0].price, 1000);
});

test('4. editing an order keeps its coupon (re-applied to the new subtotal)', async () => {
  await c.call('POST', '/api/sales/coupons', { code: 'TEN', kind: 'percent', value: 10, max_uses: 1 });
  await c.call('POST', '/api/sales/coupons', { code: 'SHIPFREE', kind: 'free_delivery' });
  const o = await order([{ product_id: cap.id, qty: 1 }], { coupon: 'TEN' });
  assert.equal(o.discount, 20);
  const r = await c.call('PUT', `/api/sales/orders/${o.id}`, { items: [{ product_id: cap.id, qty: 3 }] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.discount, r.body.coupon, r.body.subtotal], [60, 'TEN', 600], 'still 10%, even though the coupon is used up now');
  const f = await order([{ product_id: cap.id, qty: 1 }], { coupon: 'SHIPFREE' });
  const r2 = await c.call('PUT', `/api/sales/orders/${f.id}`, { customer_address: 'Sylhet' });
  assert.equal(r2.body.delivery_charge, 0, 'free delivery survives an address change');
});

test('5. editing a cancelled order does not move stock', async () => {
  const o = await order([{ product_id: cap.id, qty: 2 }]);
  await c.call('PUT', `/api/sales/orders/${o.id}`, { status: 'cancelled' });
  const before = one('SELECT stock FROM products WHERE id = ?', cap.id).stock;
  await c.call('PUT', `/api/sales/orders/${o.id}`, { items: [{ product_id: cap.id, qty: 4 }] });
  assert.equal(one('SELECT stock FROM products WHERE id = ?', cap.id).stock, before);
});

test('6 & 9. bKash: a second link for the balance is captured; verifying a TrxID adds to earlier payments', async () => {
  await c.call('PUT', '/api/sales/bkash', { app_key: 'k', app_secret: 's', username: 'u', password: 'p', sandbox: true });
  const o = await order([{ product_id: cap.id, qty: 5 }]);
  run(`UPDATE orders SET bkash_payment_id = 'PAYA', bkash_links = '["PAYA","PAYB"]' WHERE id = ?`, o.id);
  await fetch(`${base}/api/pay/bkash/callback?paymentID=PAYA&status=success`);
  await fetch(`${base}/api/pay/bkash/callback?paymentID=PAYB&status=success`);
  assert.equal(one('SELECT paid_amount FROM orders WHERE id = ?', o.id).paid_amount, 1070);
  assert.match(await fetch(`${base}/api/pay/bkash/callback?paymentID=PAYB&status=success`).then((x) => x.text()), /Already paid/);
  assert.equal(one('SELECT paid_amount FROM orders WHERE id = ?', o.id).paid_amount, 1070, 'refresh does not double count');
  const o2 = await order([{ product_id: cap.id, qty: 1 }]);
  run(`UPDATE orders SET paid_amount = 100, payment_status = 'advance', payment_trx = 'ABC12345', payment_check = 'pending' WHERE id = ?`, o2.id);
  const v = await c.call('POST', `/api/sales/orders/${o2.id}/payment`, { ok: true, amount: 170 });
  assert.deepEqual([v.body.paid_amount, v.body.payment_status], [270, 'paid']);
  assert.equal((await c.call('POST', `/api/sales/orders/${o2.id}/payment`, { ok: true, amount: 170 })).status, 409);
});

test('7 & 8. a resent WhatsApp reply shows its new ticks; broadcast counters follow failure reports', async () => {
  const wc = Number(run(`INSERT INTO conversations (workspace_id, channel_id, customer_id, last_inbound_at) VALUES (?,?, '8801700000001', datetime('now'))`, ws, wa).lastInsertRowid);
  const id = Number(run(`INSERT INTO chat_messages (workspace_id, conversation_id, direction, source, body, status, delivery_status) VALUES (?,?, 'out', 'human', ?, 'failed', 'failed')`, ws, wc, seal(ws, 'chat_messages.body', 'hi')).lastInsertRowid);
  await deliver(id);
  assert.equal(one('SELECT delivery_status FROM chat_messages WHERE id = ?', id).delivery_status, null);
  const b = (await c.call('POST', '/api/sales/broadcasts', { channel_id: wa, text: 'Offer', confirm_optin: true })).body;
  await new Promise((r) => setTimeout(r, 80));
  const m = one('SELECT external_id FROM chat_messages WHERE broadcast_id = ?', b.id);
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'wb1', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '980002' }, statuses: [{ id: m.external_id, status: 'failed', errors: [{ code: 131026, title: 'Undeliverable' }] }] } }] }] });
  await fetch(`${base}/api/social/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}` }, body: raw });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(Object.values(one('SELECT sent, failed FROM broadcasts WHERE id = ?', b.id)), [0, 1]);
});

test('10. the SMS confirmation link remembers "I did not order this"', async () => {
  const { confirmAnswer, confirmPage } = await import('../src/services/sms.js');
  const o = await order([{ product_id: cap.id, qty: 1 }]);
  const tok = 'a'.repeat(32);
  run('UPDATE orders SET confirm_token = ? WHERE id = ?', tok, o.id);
  const again = await confirmAnswer(tok, undefined);
  assert.match(again, /কনফার্ম করুন/, `no answer = page again, not a denial: ${again.slice(-300)}`);
  await confirmAnswer(tok, 'no');
  assert.equal(one('SELECT customer_confirmed FROM orders WHERE id = ?', o.id).customer_confirmed, -1);
  assert.doesNotMatch(confirmPage(tok), /কনফার্ম হয়েছে/);
});

test('11. one Meta delivery for two shops is stored per shop, each with its own key', async () => {
  setSetting('meta_app_secret', 'f'.repeat(32));
  const c2 = client(base); await c2.signup('other@shop.test');
  const ws2 = (await c2.call('GET', '/api/auth/me')).body.workspace.id;
  ch(ws, 'messenger', '980101', { managed: true }); ch(ws2, 'messenger', '980102', { managed: true });
  const msg = (page, psid, text) => ({ id: page, messaging: [{ sender: { id: psid }, recipient: { id: page }, timestamp: Date.now(), message: { mid: `m-${psid}`, text } }] });
  const raw = JSON.stringify({ object: 'page', entry: [msg('980101', 'pa', 'for A'), msg('980102', 'pb', 'secret for B')] });
  run('DELETE FROM webhook_events');
  await fetch(`${base}/api/social/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', 'f'.repeat(32)).update(raw).digest('hex')}` }, body: raw });
  await flushSales();
  const rows = all('SELECT * FROM webhook_events ORDER BY id');
  assert.equal(rows.length, 2);
  const a = open(ws, 'webhook_events.payload', rows.find((r) => r.workspace_id === ws).payload);
  assert.match(a, /for A/); assert.doesNotMatch(a, /secret for B/);
  assert.match(open(ws2, 'webhook_events.payload', rows.find((r) => r.workspace_id === ws2).payload), /secret for B/);
});

test('12. erasing a customer also clears activity lines and stored webhooks', async () => {
  const cv = one(`SELECT * FROM conversations WHERE customer_id = 'pa'`);
  run(`INSERT INTO activity (workspace_id, type, detail) VALUES (?, 'order_created', ?)`, ws, JSON.stringify({ conversation: cv.id, from: 'Nadia Rahman' }));
  await c.call('POST', '/api/sales/customers/erase', { conversations: [cv.id] });
  assert.equal(one(`SELECT COUNT(*) AS n FROM activity WHERE detail LIKE '%Nadia%'`).n, 0);
  assert.equal(one('SELECT COUNT(*) AS n FROM webhook_events WHERE workspace_id = ?', ws).n, 0);
});

test('13. a failed order-update template is reported, not swallowed', async () => {
  const wc = one(`SELECT id FROM conversations WHERE customer_id = '8801700000001'`).id;
  run(`UPDATE conversations SET last_inbound_at = datetime('now', '-3 days') WHERE id = ?`, wc);
  await c.call('PUT', '/api/sales/order-templates', { confirmed: { name: 'order_ok', language: 'bn' } });
  const o = await order([{ product_id: cap.id, qty: 1 }]);
  run('UPDATE orders SET conversation_id = ? WHERE id = ?', wc, o.id);
  handler = (m, p, b) => (b.type === 'template' ? { status: 400, body: { error: { message: 'Template name does not exist', code: 132001 } } } : null);
  const r = await c.call('PUT', `/api/sales/orders/${o.id}`, { status: 'confirmed' });
  handler = null;
  assert.equal(r.status, 200, r.text);
  assert.match(r.body.notified.error, /order_ok/);
  assert.ok(one(`SELECT 1 AS x FROM activity WHERE type = 'send_failed' AND detail LIKE '%order_ok%'`));
});

test('14. the daily check notices our app is not subscribed even if another app is', async () => {
  const { checkChannel } = await import('../src/services/health.js');
  const id = ch(ws, 'messenger', '980201', { managed: true });
  sent.length = 0;
  handler = (m, p) => (m === 'GET' && p.endsWith('/subscribed_apps') ? { body: { data: [{ id: '999', name: 'Other bot' }] } } : null);
  assert.equal(await checkChannel(one('SELECT * FROM channels WHERE id = ?', id)), 'ok');
  handler = null;
  assert.ok(sent.some((s) => s.path.endsWith('/980201/subscribed_apps')), 're-subscribed');
});
