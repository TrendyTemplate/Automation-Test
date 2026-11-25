// Customers CRM (merge by phone across pages) and analytics numbers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './helpers.js';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_LIMIT = '500';
const { createApp } = await import('../src/server.js');
const { run } = await import('../src/db.js');
const { seal } = await import('../src/vault.js');

let server; let c; let ws; let fb; let wa;
const conv = (ch, cid, name, phone, extra = {}) => Number(run(`INSERT INTO conversations (workspace_id, channel_id, customer_id, customer_name, customer_phone, last_inbound_at, referral_json, labels, created_at)
  VALUES (?,?,?,?,?, datetime('now'), ?, ?, datetime('now', '-1 hour'))`, ws, ch, cid, name, phone, extra.ref ? JSON.stringify(extra.ref) : null, extra.labels || null).lastInsertRowid);
const msg = (cv, dir, source, ago, status = dir === 'in' ? 'received' : 'sent', by = null) => run(`INSERT INTO chat_messages (workspace_id, conversation_id, direction, source, status, body, sent_by, created_at)
  VALUES (?,?,?,?,?, '', ?, datetime('now', ?))`, ws, cv, dir, source, status, by, `-${ago} seconds`);
const order = (cv, phone, status, total) => run(`INSERT INTO orders (workspace_id, conversation_id, customer_name, customer_phone, items_json, total, status) VALUES (?,?,?,?,?,?,?)`,
  ws, cv, 'X', phone, JSON.stringify([{ name: 'Hoodie', qty: 1, price: total }]), total, status);

before(async () => {
  server = createApp().listen(0);
  c = client(`http://127.0.0.1:${server.address().port}`);
  await c.signup('insights@shop.test');
  ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  const ch = (p, ext) => Number(run(`INSERT INTO channels (workspace_id, platform, name, external_id, access_token_enc, app_secret_enc, verify_token) VALUES (?,?,?,?,?, '', ?)`, ws, p, `${p} page`, ext, seal(ws, 'channels.access_token', 'T'), `cp_ins_${ext}_0000000000000`).lastInsertRowid);
  fb = ch('messenger', '81001'); wa = ch('whatsapp', '81002');
  // Rahim chats on Messenger (from an ad) and on WhatsApp, with the same number written two ways.
  const a = conv(fb, 'psid-r', 'Rahim', '01711-000000', { ref: { ad_id: 'ad9', ad_title: 'Eid hoodie' }, labels: 'vip' });
  const b = conv(wa, '8801711000000', 'Rahim', '+8801711000000');
  const k = conv(fb, 'psid-k', 'Karim', null);
  msg(a, 'in', 'customer', 120); msg(a, 'out', 'ai', 110);
  msg(b, 'in', 'customer', 100); msg(b, 'out', 'ai', 40, 'sent', 1);
  msg(k, 'in', 'customer', 90); msg(k, 'out', 'human', 30);
  order(a, '01711000000', 'delivered', 1200); order(b, '01711000000', 'delivered', 800); order(b, '01711000000', 'returned', 500);
});
after(() => server.close());

test('customers are merged by phone across pages, with spend and delivery ratio', async () => {
  const list = (await c.call('GET', '/api/sales/customers')).body;
  assert.equal(list.length, 2);
  const r = list.find((x) => x.name === 'Rahim');
  assert.deepEqual([r.phone, r.orders, r.delivered, r.returned, r.spent, r.ratio], ['01711000000', 3, 2, 1, 2000, 67]);
  assert.deepEqual(r.platforms.sort(), ['messenger', 'whatsapp']);
  assert.equal(r.conversations.length, 2);
  assert.deepEqual(r.labels, ['vip']);
  assert.equal((await c.call('GET', '/api/sales/customers?segment=repeat')).body.length, 1);
  assert.equal((await c.call('GET', '/api/sales/customers?q=karim')).body[0].name, 'Karim');
  assert.equal((await c.call('GET', '/api/sales/customers?sort=spent')).body[0].name, 'Rahim');
  const csv = await c.call('GET', '/api/sales/customers.csv');
  assert.match(csv.text, /^name,phone/);
  assert.match(csv.text, /"Rahim","01711000000"/);
});

test('analytics: first response, AI share, conversion, delivery rate, page and ad revenue', async () => {
  const a = (await c.call('GET', '/api/sales/analytics?days=30')).body;
  assert.equal(a.conversations, 3);
  assert.equal(a.converted, 2);
  assert.equal(a.conversion, 66.7);
  assert.equal(a.messages.inbound, 3);
  assert.deepEqual([a.messages.ai_auto, a.messages.ai_approved, a.messages.human], [1, 1, 1]);
  assert.equal(a.automation, 33);
  assert.equal(a.firstResponseSec, 60, 'median of 10s, 60s, 60s');
  assert.equal(a.deliveryRate, 67);
  assert.equal(a.orders.value, 2000);
  assert.equal(a.byAd[0].ad_title, 'Eid hoodie');
  assert.equal(a.byAd[0].value, 1200);
  assert.equal(a.byPage.find((p) => p.platform === 'whatsapp').value, 800);
  assert.equal(a.topProducts[0].name, 'Hoodie');
  assert.ok(a.daily.length >= 1);
});
