// SMS (order updates + one-tap confirm link), bKash payment links, WooCommerce / Shopify import,
// voice-note transcription, WhatsApp catalog carts, "How did we do?" ratings.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { client, fakeAnthropic } from './helpers.js';

const hits = [];
// One fake server for every outside service: Graph, SMS gateways, bKash, WooCommerce, Shopify, transcription.
const ext = http.createServer((req, res) => {
  const chunks = []; req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const raw = Buffer.concat(chunks); const u = new URL(req.url, 'http://x'); const p = u.pathname;
    let body = {}; try { body = JSON.parse(raw.toString() || '{}'); } catch { body = Object.fromEntries(new URLSearchParams(raw.toString())); }
    hits.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, headers: req.headers, raw });
    const j = (o, s = 200) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (p === '/sms/bulk') return j(u.searchParams.get('api_key') === 'GOOD' ? { response_code: 202, success_message: 'ok' } : { response_code: 1002, error_message: 'Invalid API key' });
    if (p.endsWith('/token/grant')) return j(req.headers.username === 'shop' ? { statusCode: '0000', id_token: 'IDT' } : { statusCode: '2001', statusMessage: 'Invalid App Key' });
    if (p.endsWith('/checkout/create')) return j({ statusCode: '0000', paymentID: 'PAY1', bkashURL: 'https://sandbox.payment.bkash.com/?paymentId=PAY1' });
    if (p.endsWith('/checkout/execute')) return j({ statusCode: '0000', transactionStatus: 'Completed', trxID: 'BK123XYZ', amount: '70.00', paymentID: body.paymentID });
    if (p === '/wp-json/wc/v3/products') {
      if (req.headers.authorization !== `Basic ${Buffer.from('ck:cs').toString('base64')}`) return j({ message: 'Consumer key is invalid.' }, 401);
      return j(u.searchParams.get('page') === '1' ? [{ id: 11, name: 'Woo Hoodie', sku: 'WH1', price: '1500', manage_stock: true, stock_quantity: 4, images: [{ src: 'https://shop.test/h.jpg' }], short_description: '<p>Warm</p>', attributes: [{ name: 'Size', options: ['M', 'L'], variation: true }] }] : []);
    }
    if (p === '/admin/api/2025-01/products.json') return j({ products: [{ id: 22, title: 'Shopify Tee', body_html: 'Cotton', image: { src: 'https://cdn.shopify.com/t.jpg' }, options: [{ name: 'Size', values: ['M', 'L'] }],
      variants: [{ title: 'M', sku: 'ST1', price: '600', inventory_management: 'shopify', inventory_quantity: 3 }, { title: 'L', sku: 'ST1-L', price: '600', inventory_management: 'shopify', inventory_quantity: 0 }] }] });
    if (p === '/stt') return j({ text: 'ei hoodie ta ki L size e ache?' });
    if (p.endsWith('/voice.ogg')) { res.setHeader('content-type', 'audio/ogg'); return res.end(Buffer.from('OggS fake audio')); }
    if (/\/wa-voice-1$/.test(p)) return j({ url: `${G()}/media/voice.ogg` });
    return j({ message_id: `mid.${hits.length}`, messages: [{ id: `wamid.${hits.length}` }] });
  });
});
await new Promise((r) => ext.listen(0, '127.0.0.1', r));
const G = () => `http://127.0.0.1:${ext.address().port}`;
const prompts = [];
const ai = await fakeAnthropic((b) => { prompts.push(JSON.stringify(b.messages)); return { reply: 'Ji, L size ache!', product_photos: [], private_reply: '', language: 'bn', intent: 'q', stage: 'interested', lead_score: 60, summary: 's',
  order_status: 'none', order: { items: [], customer_name: '', phone: '', address: '', delivery_zone: '', coupon: '', note: '' }, payment: { method: '', trx_id: '', amount: 0 }, handoff: false, handoff_reason: '', confidence: 0.95, unsupported_claims: false }; });
Object.assign(process.env, { DB_PATH: ':memory:', NODE_ENV: 'test', AUTH_RATE_LIMIT: '500', ANTHROPIC_BASE_URL: ai.url, ANTHROPIC_API_KEY: 'sk-ant-test', META_GRAPH_URL: G(),
  SALES_DEBOUNCE_MS: '0', LEARN_DEBOUNCE_MS: '0', SMS_BULKSMSBD_URL: `${G()}/sms/bulk`, BKASH_BASE_URL: G(), SHOPIFY_BASE_URL: G(), STT_URL: `${G()}/stt`, STT_API_KEY: 'stt-key' });
const { createApp } = await import('../src/server.js');
const { run, one } = await import('../src/db.js');
const { seal } = await import('../src/vault.js');
const { flushSales } = await import('../src/services/sales.js');

const SECRET = '0123456789abcdef0123456789abcdef';
let server; let base; let c; let ws; let fb; let product;
before(async () => {
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  c = client(base); await c.signup('r3@shop.test');
  ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly', notify_customers = 1 WHERE id = ?`, ws);
  const add = (pf, id) => Number(run(`INSERT INTO channels (workspace_id, platform, name, external_id, access_token_enc, app_secret_enc, verify_token, mode) VALUES (?,?,?,?,?,?,?, 'auto')`,
    ws, pf, pf, id, seal(ws, 'channels.access_token', 'TOKEN'), seal(ws, 'channels.app_secret', SECRET), `cp_r3_${id}_00000000000000`).lastInsertRowid);
  fb = add('messenger', '970001'); add('whatsapp', '970002');
  product = (await c.call('POST', '/api/sales/products', { name: 'Hoodie', price: 1200, stock: 10 })).body;
});
after(() => { server.close(); ext.close(); ai.close(); });
async function hook(payload) {
  const raw = JSON.stringify(payload);
  await fetch(`${base}/api/social/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}` }, body: raw });
  await flushSales(); await new Promise((r) => setTimeout(r, 30));
}

test('SMS: keys checked with a test SMS, order updates by SMS, one-tap confirmation page', async () => {
  assert.equal((await c.call('PUT', '/api/sales/sms', { provider: 'bulksmsbd', api_key: 'BAD', test_phone: '01711000000', events: {} })).status, 400);
  const r = await c.call('PUT', '/api/sales/sms', { provider: 'bulksmsbd', api_key: 'GOOD', sender_id: 'MYSHOP', test_phone: '01711000000', events: { shipped: true, risky_confirm: true } });
  assert.equal(r.status, 200, r.text);
  assert.ok(!JSON.stringify(r.body).includes('GOOD'), 'key never returned');
  const o = (await c.call('POST', '/api/sales/orders', { customer_name: 'K', customer_phone: '01811-222333', customer_address: 'Dhaka', items: [{ product_id: product.id, qty: 1 }] })).body;
  hits.length = 0;
  await c.call('PUT', `/api/sales/orders/${o.id}`, { status: 'shipped' });
  const sms = hits.find((h) => h.path === '/sms/bulk');
  assert.deepEqual([sms.query.number, sms.query.senderid], ['8801811222333', 'MYSHOP']);
  assert.match(sms.query.message, new RegExp(`Order #${o.id} shipped`));
  // risky confirm link
  const { smsOrder } = await import('../src/services/sms.js');
  hits.length = 0;
  assert.equal(await smsOrder(o.id, 'risky_confirm'), true);
  const link = hits.find((h) => h.path === '/sms/bulk').query.message.match(/\/c\/([a-f0-9]{32})/)[1];
  const page = await fetch(`${base}/c/${link}`).then((x) => x.text());
  assert.match(page, /কনফার্ম করুন/);
  const done = await fetch(`${base}/c/${link}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'answer=yes' }).then((x) => x.text());
  assert.match(done, /কনফার্ম হয়েছে/);
  assert.equal(one('SELECT customer_confirmed FROM orders WHERE id = ?', o.id).customer_confirmed, 1);
  assert.equal((await fetch(`${base}/c/${'0'.repeat(32)}`).then((x) => x.text())).includes('কাজ করছে না'), true);
});

test('bKash: keys checked; payment link sent to the chat; callback marks the order paid (verified by bKash)', async () => {
  assert.equal((await c.call('PUT', '/api/sales/bkash', { app_key: 'k', app_secret: 's', username: 'wrong', password: 'p', sandbox: true })).status, 400);
  assert.equal((await c.call('PUT', '/api/sales/bkash', { app_key: 'k', app_secret: 's', username: 'shop', password: 'p', sandbox: true })).body.connected, true);
  const conv = Number(run(`INSERT INTO conversations (workspace_id, channel_id, customer_id, last_inbound_at) VALUES (?,?, 'psid-pay', datetime('now'))`, ws, fb).lastInsertRowid);
  const o = (await c.call('POST', '/api/sales/orders', { customer_name: 'P', customer_phone: '01700000001', customer_address: 'Dhaka', items: [{ product_id: product.id, qty: 1 }] })).body;
  run('UPDATE orders SET conversation_id = ? WHERE id = ?', conv, o.id);
  hits.length = 0;
  const r = await c.call('POST', `/api/sales/orders/${o.id}/paylink`, { amount: 70, send: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.sentToChat, true);
  assert.equal(hits.find((h) => h.path.endsWith('/checkout/create')).body.amount, '70.00');
  assert.ok(hits.some((h) => h.path.endsWith('/messages') && /sandbox\.payment\.bkash\.com/.test(h.body.message?.text)));
  const back = await fetch(`${base}/api/pay/bkash/callback?paymentID=PAY1&status=success`).then((x) => x.text());
  assert.match(back, /BK123XYZ/);
  const paid = one('SELECT * FROM orders WHERE id = ?', o.id);
  assert.deepEqual([paid.payment_check, paid.payment_trx, paid.paid_amount, paid.payment_status], ['verified', 'BK123XYZ', 70, 'advance']);
  assert.match(await fetch(`${base}/api/pay/bkash/callback?paymentID=PAY1&status=success`).then((x) => x.text()), /Already paid/, 'refresh is safe');
  assert.equal(one('SELECT paid_amount FROM orders WHERE id = ?', o.id).paid_amount, 70);
});

test('product import: WooCommerce and Shopify, re-sync updates instead of duplicating', async () => {
  assert.equal((await c.call('POST', '/api/sales/store-sync', { source: 'woocommerce', url: G().replace('http:', 'https:'), key: 'ck', secret: 'cs' })).status, 400, 'unreachable https → refused');
  // tests talk http to the fake server; the URL check only allows https, so point Woo at the fake through the stored config
  const { syncProducts } = await import('../src/services/catalogsync.js');
  const w = one('SELECT * FROM workspaces WHERE id = ?', ws);
  await assert.rejects(() => syncProducts(w, { source: 'woocommerce', url: 'https://nope', key: 'ck', secret: 'cs' }));
  const real = globalThis.fetch;
  globalThis.fetch = (url, o) => real(String(url).replace('https://woo.test', G()), o);
  try {
    const r = await syncProducts(w, { source: 'woocommerce', url: 'https://woo.test', key: 'ck', secret: 'cs' });
    assert.deepEqual([r.found, r.added], [1, 1]);
    const again = await syncProducts(one('SELECT * FROM workspaces WHERE id = ?', ws));
    assert.deepEqual([again.added, again.updated], [0, 1], 're-sync from the stored (encrypted) config updates');
  } finally { globalThis.fetch = real; }
  const woo = one(`SELECT * FROM products WHERE external_ref = 'woo:11'`);
  assert.deepEqual([woo.name, woo.price, woo.stock, woo.sku, woo.description], ['Woo Hoodie', 1500, 4, 'WH1', 'Warm']);
  assert.match(one('SELECT store_sync FROM workspaces WHERE id = ?', ws).store_sync, /"enc":"e3\./);
  const s = await c.call('POST', '/api/sales/store-sync', { source: 'shopify', url: 'shop1.myshopify.com', secret: 'shpat_x' });
  assert.equal(s.status, 200, s.text);
  const tee = one(`SELECT * FROM products WHERE external_ref = 'shopify:22'`);
  assert.deepEqual([tee.price, tee.stock, JSON.parse(tee.variant_stock)], [600, 3, { M: 3, L: 0 }]);
});

test('voice notes are transcribed and answered; WhatsApp catalog carts reach the assistant', async () => {
  prompts.length = 0;
  await hook({ object: 'whatsapp_business_account', entry: [{ id: 'w', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '970002' }, contacts: [{ wa_id: '8801700000009', profile: { name: 'V' } }],
    messages: [{ from: '8801700000009', id: 'wamid.v1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'audio', audio: { id: 'wa-voice-1', voice: true } }] } }] }] });
  assert.match(prompts.at(-1), /they said: ei hoodie ta ki L size e ache\?/);
  const stt = hits.find((h) => h.path === '/stt');
  assert.equal(stt.headers.authorization, 'Bearer stt-key');
  const conv = one(`SELECT * FROM conversations WHERE customer_id = '8801700000009'`);
  assert.equal(conv.status, 'open', 'not handed to a person');
  await hook({ object: 'whatsapp_business_account', entry: [{ id: 'w', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '970002' },
    messages: [{ from: '8801700000009', id: 'wamid.o1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'order', order: { catalog_id: 'c1', product_items: [{ product_retailer_id: 'WH1', quantity: 2, item_price: 1500, currency: 'BDT' }] } }] } }] }] });
  assert.match(prompts.at(-1), /cart from your WhatsApp catalog\] 2 × SKU WH1/);
});

test('"How did we do?": asked when a chat is closed, answer recorded without an AI turn, shown in analytics', async () => {
  assert.equal((await c.call('PUT', '/api/settings', { csat_enabled: true })).status, 200);
  const conv = one(`SELECT * FROM conversations WHERE customer_id = '8801700000009'`);
  hits.length = 0;
  await c.call('PUT', `/api/sales/conversations/${conv.id}`, { status: 'closed' });
  await new Promise((r) => setTimeout(r, 80));
  const ask = hits.find((h) => h.body.interactive?.action?.buttons);
  assert.deepEqual(ask.body.interactive.action.buttons.map((b) => b.reply.title), ['😊 ভালো', '😐 মোটামুটি', '😞 খারাপ']);
  prompts.length = 0;
  await hook({ object: 'whatsapp_business_account', entry: [{ id: 'w', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '970002' },
    messages: [{ from: '8801700000009', id: 'wamid.r1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b0', title: '😊 ভালো' } } }] } }] }] });
  assert.equal(prompts.length, 0, 'no AI call for the rating');
  assert.equal(one('SELECT csat FROM conversations WHERE id = ?', conv.id).csat, 3);
  const a = (await c.call('GET', '/api/sales/analytics')).body;
  assert.deepEqual([a.csat.n, a.csat.good], [1, 100]);
});
