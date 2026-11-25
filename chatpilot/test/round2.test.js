// Production hardening: Graph errors (rate limit → retry, dead token → reconnect), WhatsApp ticks/failures/billing,
// stored webhooks + replay, connection health + backups, order updates by template after 24 h, erase, snooze/overdue,
// live-selling codes, and the review fixes (echo race, split replies, status-only order save, courier backwards,
// follow-ups vs "stop", expired plans, broadcasts after deletion / restart).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { client, fakeAnthropic } from './helpers.js';

const sent = []; let handler = null;
const graph = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; });
  req.on('end', async () => {
    const u = new URL(req.url, 'http://x');
    const body = JSON.parse(b || '{}');
    const r = handler?.(req.method, u.pathname, body, u.searchParams);
    const out = r instanceof Promise ? await r : r;
    res.setHeader('content-type', 'application/json');
    if (out?.status) { res.statusCode = out.status; return res.end(JSON.stringify(out.body)); }
    if (req.method !== 'GET') sent.push({ path: u.pathname, body });
    res.end(JSON.stringify(out?.body || { message_id: `mid.${sent.length}`, messages: [{ id: `wamid.${sent.length}` }], data: [{ id: 'app' }], id: '1' }));
  });
});
await new Promise((r) => graph.listen(0, '127.0.0.1', r));
let reply = 'Ji, ache!';
const ai = await fakeAnthropic(() => ({ reply, product_photos: [], private_reply: '', language: 'bn', intent: 'q', stage: 'interested', lead_score: 60, summary: 's',
  order_status: 'none', order: { items: [], customer_name: '', phone: '', address: '', delivery_zone: '', coupon: '', note: '' }, payment: { method: '', trx_id: '', amount: 0 }, handoff: false, handoff_reason: '', confidence: 0.95, unsupported_claims: false }));
const BK = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-bk-'));
Object.assign(process.env, { DB_PATH: ':memory:', NODE_ENV: 'test', AUTH_RATE_LIMIT: '500', ANTHROPIC_BASE_URL: ai.url, ANTHROPIC_API_KEY: 'sk-ant-test',
  META_GRAPH_URL: `http://127.0.0.1:${graph.address().port}`, SALES_DEBOUNCE_MS: '0', LEARN_DEBOUNCE_MS: '0', BROADCAST_DELAY_MS: '0', BACKUP_DIR: BK, BACKUP_KEEP: '2' });
const { createApp } = await import('../src/server.js');
const { run, one, all } = await import('../src/db.js');
const { seal } = await import('../src/vault.js');
const { flushSales, retryFailedSends, salesFollowUps } = await import('../src/services/sales.js');
const { classify } = await import('../src/services/graph-errors.js');
const { replyWindow } = await import('../src/services/social.js');
const { checkChannel, backupNow, lastBackup } = await import('../src/services/health.js');
const { replayWebhooks } = await import('../src/routes/sales.js');
const { applyCourierStatus } = await import('../src/services/couriers.js');

const SECRET = '0123456789abcdef0123456789abcdef';
let server; let base; let c; let ws; let fb; let wa;
before(async () => {
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  c = client(base); await c.signup('r2@shop.test');
  ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly', notify_customers = 1 WHERE id = ?`, ws);
  const add = (pf, id, extra = '') => Number(run(`INSERT INTO channels (workspace_id, platform, name, external_id, access_token_enc, app_secret_enc, verify_token, mode, waba_id) VALUES (?,?,?,?,?,?,?, 'auto', ?)`,
    ws, pf, pf, id, seal(ws, 'channels.access_token', 'TOKEN'), seal(ws, 'channels.app_secret', SECRET), `cp_r2_${id}_00000000000000${extra}`, pf === 'whatsapp' ? 'waba9' : null).lastInsertRowid);
  fb = add('messenger', '960001'); wa = add('whatsapp', '960002');
});
after(() => { server.close(); graph.close(); ai.close(); fs.rmSync(BK, { recursive: true, force: true }); });
const sign = (raw) => `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}`;
async function hook(payload, wait = true) {
  const raw = JSON.stringify(payload);
  await fetch(`${base}/api/social/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': sign(raw) }, body: raw });
  if (wait) { await flushSales(); await new Promise((r) => setTimeout(r, 30)); }
}
const fbMsg = (psid, text, extra = {}) => ({ object: 'page', entry: [{ id: '960001', messaging: [{ sender: { id: psid }, recipient: { id: '960001' }, timestamp: Date.now(), message: { mid: `in-${Math.random()}`, text, ...extra } }] }] });
const waBody = (value) => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba9', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '960002' }, ...value } }] }] });

test('Graph errors are sorted by what to do', () => {
  assert.equal(classify(613), 'rate_limit');
  assert.equal(classify(131056), 'rate_limit');
  assert.equal(classify(190, 460), 'token');
  assert.equal(classify(10, 2018278), 'window');
  assert.equal(classify(551), 'unavailable');
  assert.equal(classify(131049), 'permanent');
  assert.equal(classify(0, 0, 503), 'transient');
});

test('reply windows: 24 h; ad leads 7 days; a person 7 days with HUMAN_AGENT; WhatsApp 24 h', () => {
  const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString();
  assert.deepEqual(replyWindow('messenger', { last_inbound_at: ago(2) }), { open: true, tag: null });
  assert.equal(replyWindow('messenger', { last_inbound_at: ago(30) }).open, false, 'AI after 24 h');
  assert.equal(replyWindow('messenger', { last_inbound_at: ago(30), referral_json: '{"source":"ADS","ad_id":"1"}' }).open, true, 'ad lead');
  assert.equal(replyWindow('messenger', { last_inbound_at: ago(30) }, { human: true }).tag, 'HUMAN_AGENT');
  assert.equal(replyWindow('messenger', { last_inbound_at: ago(24 * 8) }, { human: true }).open, false);
  assert.equal(replyWindow('whatsapp', { last_inbound_at: ago(30) }, { human: true }).open, false);
});

test('rate limit: the reply waits and is sent automatically; a dead token marks the page disconnected', async () => {
  handler = (m, p) => (m === 'POST' && p.endsWith('/messages') ? { status: 400, body: { error: { message: 'Calls to this api have exceeded the rate limit.', code: 613 } } } : null);
  await hook(fbMsg('psid-rl', 'dam koto?'));
  let msg = one(`SELECT m.* FROM chat_messages m JOIN conversations v ON v.id = m.conversation_id WHERE v.customer_id = 'psid-rl' AND m.direction = 'out'`);
  assert.deepEqual([msg.status, msg.error_kind, Boolean(msg.retry_at)], ['failed', 'rate_limit', true]);
  assert.equal(one('SELECT health FROM channels WHERE id = ?', fb).health, 'rate_limited');
  handler = null; sent.length = 0;
  run(`UPDATE chat_messages SET retry_at = datetime('now', '-1 minute') WHERE id = ?`, msg.id);
  run('UPDATE channels SET paused_until = NULL WHERE id = ?', fb);
  assert.equal(await retryFailedSends(), 1);
  msg = one('SELECT * FROM chat_messages WHERE id = ?', msg.id);
  assert.equal(msg.status, 'sent');
  assert.equal(one('SELECT health FROM channels WHERE id = ?', fb).health, 'ok');
  // Token revoked
  handler = (m, p) => (m === 'POST' && p.endsWith('/messages') ? { status: 400, body: { error: { message: 'Error validating access token', code: 190, error_subcode: 460 } } } : null);
  await hook(fbMsg('psid-tok', 'hello'));
  assert.equal(one('SELECT health FROM channels WHERE id = ?', fb).health, 'token');
  const m2 = one(`SELECT m.* FROM chat_messages m JOIN conversations v ON v.id = m.conversation_id WHERE v.customer_id = 'psid-tok' AND m.direction = 'out'`);
  assert.equal(m2.retry_at, null, 'not retried: needs a reconnect');
  const ch = (await c.call('GET', '/api/sales/channels')).body.find((x) => x.id === fb);
  assert.equal(ch.health, 'token');
  handler = null;
  run(`UPDATE channels SET health = 'ok' WHERE id = ?`, fb);
});

test('WhatsApp ticks, failures (broadcast counters) and billing; Messenger read receipts', async () => {
  await hook(waBody({ contacts: [{ wa_id: '8801711111111', user_id: 'BD.user1', profile: { name: 'W' } }], messages: [{ from: '8801711111111', id: 'wamid.in1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'hi' } }] }));
  const conv = one(`SELECT * FROM conversations WHERE customer_id = '8801711111111'`);
  assert.equal(conv.wa_user_id, 'BD.user1', 'business-scoped user id stored');
  const out = one(`SELECT * FROM chat_messages WHERE conversation_id = ? AND direction = 'out'`, conv.id);
  await hook(waBody({ statuses: [{ id: out.external_id, status: 'delivered', pricing: { billable: true, category: 'service', type: 'regular' } }] }));
  assert.deepEqual(Object.values(one('SELECT delivery_status, billing FROM chat_messages WHERE id = ?', out.id)), ['delivered', 'service']);
  await hook(waBody({ statuses: [{ id: out.external_id, status: 'sent' }] }));
  assert.equal(one('SELECT delivery_status FROM chat_messages WHERE id = ?', out.id).delivery_status, 'delivered', 'never goes backwards');
  const b = (await c.call('POST', '/api/sales/broadcasts', { channel_id: wa, text: 'Offer!', confirm_optin: true })).body;
  await new Promise((r) => setTimeout(r, 80));
  const bm = one('SELECT * FROM chat_messages WHERE broadcast_id = ?', b.id);
  await hook(waBody({ statuses: [{ id: bm.external_id, status: 'failed', errors: [{ code: 131049, title: 'Marketing message limit' }] }] }));
  assert.deepEqual(Object.values(one('SELECT sent, failed FROM broadcasts WHERE id = ?', b.id)), [0, 1]);
  assert.match(one('SELECT error FROM chat_messages WHERE id = ?', bm.id).error, /131049/);
  // Messenger read
  const fconv = one(`SELECT * FROM conversations WHERE customer_id = 'psid-rl'`);
  await hook({ object: 'page', entry: [{ id: '960001', messaging: [{ sender: { id: 'psid-rl' }, recipient: { id: '960001' }, timestamp: Date.now(), read: { watermark: Date.now() + 5000 } }] }] });
  assert.equal(one(`SELECT delivery_status FROM chat_messages WHERE conversation_id = ? AND direction = 'out' AND status = 'sent'`, fconv.id).delivery_status, 'read');
});

test('webhooks are stored encrypted and a failed one is replayed', async () => {
  const row = one('SELECT * FROM webhook_events ORDER BY id DESC LIMIT 1');
  assert.ok(row.processed_at);
  assert.match(row.payload, /^e3\./);
  run('UPDATE webhook_events SET processed_at = NULL, created_at = datetime(\'now\', \'-5 minutes\') WHERE id = ?', row.id);
  assert.equal(replayWebhooks(), 1);
  assert.ok(one('SELECT processed_at FROM webhook_events WHERE id = ?', row.id).processed_at);
});

test('connection check re-subscribes a page Meta dropped, flags a revoked token; backups rotate; readiness', async () => {
  sent.length = 0;
  handler = (m, p) => (m === 'GET' && p.endsWith('/subscribed_apps') ? { body: { data: [] } } : null);
  assert.equal(await checkChannel(one('SELECT * FROM channels WHERE id = ?', fb)), 'ok');
  assert.ok(sent.some((x) => x.path.endsWith('/960001/subscribed_apps')), 're-subscribed');
  handler = () => ({ status: 400, body: { error: { message: 'Session has expired', code: 190, error_subcode: 463 } } });
  assert.equal(await checkChannel(one('SELECT * FROM channels WHERE id = ?', wa)), 'token');
  handler = null; run(`UPDATE channels SET health = 'ok' WHERE id = ?`, wa);
  assert.ok(backupNow({ force: true }));
  await new Promise((r) => setTimeout(r, 1100));
  backupNow({ force: true }); await new Promise((r) => setTimeout(r, 1100)); backupNow({ force: true });
  assert.equal(lastBackup().count, 2, 'only the newest 2 kept');
  const ready = await (await fetch(`${base}/health/ready`)).json();
  assert.equal(ready.checks.database, 'ok');
  assert.equal(ready.checks.backup, 'ok');
});

test('order update after 24 h on WhatsApp goes out as the shop\'s template', async () => {
  const conv = one(`SELECT * FROM conversations WHERE customer_id = '8801711111111'`);
  run(`UPDATE conversations SET last_inbound_at = datetime('now', '-3 days') WHERE id = ?`, conv.id);
  assert.equal((await c.call('PUT', '/api/sales/order-templates', { shipped: { name: 'Bad Name', language: 'bn' } })).status, 400);
  assert.equal((await c.call('PUT', '/api/sales/order-templates', { shipped: { name: 'order_shipped', language: 'bn', params: '{{name}}, {{order}}, {{tracking}}' } })).status, 200);
  const p = (await c.call('POST', '/api/sales/products', { name: 'Kurti', price: 900, stock: 5 })).body;
  const o = (await c.call('POST', '/api/sales/orders', { customer_name: 'Wahid Khan', customer_phone: '01711111111', customer_address: 'Dhaka', items: [{ product_id: p.id, qty: 1 }] })).body;
  run('UPDATE orders SET conversation_id = ?, tracking_code = ? WHERE id = ?', conv.id, 'TRK9', o.id);
  sent.length = 0;
  assert.equal((await c.call('PUT', `/api/sales/orders/${o.id}`, { status: 'shipped' })).status, 200);
  const t = sent.find((x) => x.body.type === 'template');
  assert.deepEqual([t.body.template.name, t.body.template.components[0].parameters.map((x) => x.text)], ['order_shipped', ['Wahid', String(o.id), 'TRK9']]);
});

test('status-only save never re-prices; hidden products stay; courier updates never go backwards', async () => {
  const p = (await c.call('POST', '/api/sales/products', { name: 'Cap', price: 300, stock: 10 })).body;
  const o = (await c.call('POST', '/api/sales/orders', { customer_name: 'A', customer_phone: '01600000000', customer_address: 'Mirpur, Dhaka', items: [{ product_id: p.id, qty: 2 }] })).body;
  await c.call('PUT', `/api/sales/products/${p.id}`, { name: 'Cap', price: 999, stock: 8, active: false });
  // the UI sends the whole form back with a status change
  const r = await c.call('PUT', `/api/sales/orders/${o.id}`, { status: 'confirmed', items: [{ product_id: p.id, qty: 2, variant: '' }], delivery_zone: o.delivery_zone, discount: 0, customer_address: 'Mirpur, Dhaka' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.total, r.body.status], [o.total, 'confirmed']);
  // a real change (qty) keeps the old price of the hidden product
  const r2 = await c.call('PUT', `/api/sales/orders/${o.id}`, { items: [{ product_id: p.id, qty: 1, variant: '' }] });
  assert.equal(r2.status, 200, r2.text);
  assert.equal(r2.body.items[0].price, 300);
  run(`UPDATE orders SET courier = 'steadfast', consignment_id = '777', status = 'cancelled' WHERE id = ?`, o.id);
  const stock = one('SELECT stock FROM products WHERE id = ?', p.id).stock;
  assert.equal(await applyCourierStatus(one('SELECT * FROM orders WHERE id = ?', o.id), 'pending'), false);
  assert.deepEqual([one('SELECT status FROM orders WHERE id = ?', o.id).status, one('SELECT stock FROM products WHERE id = ?', p.id).stock], ['cancelled', stock]);
});

test('our own echo arriving before the send returns is not a staff reply; split replies are recognised', async () => {
  reply = 'A'.repeat(2300); // two Messenger parts
  let n = 0;
  handler = async (m, p, body) => {
    if (m === 'POST' && p.endsWith('/messages') && body.recipient?.id === 'psid-echo') {
      n++;
      const mid = `mid.echo${n}`;
      // Meta echoes the message to the webhook before answering the send call.
      const raw = JSON.stringify({ object: 'page', entry: [{ id: '960001', messaging: [{ sender: { id: '960001' }, recipient: { id: 'psid-echo' }, timestamp: Date.now(), message: { mid, text: body.message.text, is_echo: true } }] }] });
      await fetch(`${base}/api/social/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': sign(raw) }, body: raw });
      return { body: { message_id: mid } };
    }
    return null;
  };
  await hook(fbMsg('psid-echo', 'details?'));
  await new Promise((r) => setTimeout(r, 100));
  handler = null; reply = 'Ji, ache!';
  const conv = one(`SELECT * FROM conversations WHERE customer_id = 'psid-echo'`);
  const outs = all(`SELECT source, status, part_ids FROM chat_messages WHERE conversation_id = ? AND direction = 'out'`, conv.id);
  assert.deepEqual(outs.map((x) => [x.source, x.status]), [['ai', 'sent']], 'no staff copy, not failed');
  assert.deepEqual(JSON.parse(outs[0].part_ids), ['mid.echo1', 'mid.echo2']);
  assert.equal(conv.ai_paused_until, null, 'AI not paused by its own echo');
  // a late echo of part 2 is matched by id
  await hook({ object: 'page', entry: [{ id: '960001', messaging: [{ sender: { id: '960001' }, recipient: { id: 'psid-echo' }, timestamp: Date.now(), message: { mid: 'mid.echo2', text: 'AAA', is_echo: true } }] }] });
  assert.equal(all(`SELECT 1 FROM chat_messages WHERE conversation_id = ? AND source = 'human_app'`, conv.id).length, 0);
});

test('erase a customer; snooze and overdue views; live-selling product codes', async () => {
  const conv = one(`SELECT * FROM conversations WHERE customer_id = 'psid-tok'`);
  run(`UPDATE conversations SET last_inbound_at = datetime('now', '-30 minutes'), last_outbound_at = NULL WHERE id = ?`, conv.id);
  const ids = (q) => c.call('GET', `/api/sales/conversations?${q}`).then((r) => r.body.map((x) => x.id));
  assert.ok((await ids('view=overdue')).includes(conv.id));
  await c.call('PUT', `/api/sales/conversations/${conv.id}`, { snooze: 2 });
  assert.ok(!(await ids('')).includes(conv.id), 'hidden while snoozed');
  assert.ok((await ids('view=snoozed')).includes(conv.id));
  await hook(fbMsg('psid-tok', 'are you there?'));
  assert.ok((await ids('')).includes(conv.id), 'a new message wakes it');
  run(`UPDATE conversations SET customer_phone = '01999999999' WHERE id = ?`, conv.id);
  const e = await c.call('POST', '/api/sales/customers/erase', { phone: '01999999999' });
  assert.equal(e.body.chats, 1);
  assert.equal(one('SELECT 1 AS x FROM conversations WHERE id = ?', conv.id), undefined);
  // live selling
  await c.call('POST', '/api/sales/products', { name: 'Silk Saree', sku: 'P12', price: 2500, variant_stock: 'Red:2, Blue:0' });
  await c.call('PUT', `/api/sales/channels/${fb}/rules`, { sku_replies: true, once_per_person: false });
  sent.length = 0;
  await hook({ object: 'page', entry: [{ id: '960001', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'live1', post_id: '960001_v1', from: { id: 'u9', name: 'B' }, message: 'p12 red 1ta', created_time: Math.floor(Date.now() / 1000) } }] }] });
  await new Promise((r) => setTimeout(r, 80));
  const priv = sent.find((x) => x.body.recipient?.comment_id === 'live1');
  assert.match(priv.body.message.text, /Silk Saree \(P12\) — BDT 2500\nAvailable: Red/);
});

test('follow-ups skip people who said stop; expired shops can\'t use AI test chat or broadcasts; broadcasts survive deletion', async () => {
  const conv = one(`SELECT * FROM conversations WHERE customer_id = 'psid-echo'`);
  run(`UPDATE channels SET followup_hours = 1 WHERE id = ?`, fb);
  run(`UPDATE conversations SET opted_out = 1, stage = 'interested', status = 'open', last_inbound_at = datetime('now', '-3 hours'), last_outbound_at = datetime('now', '-2 hours') WHERE id = ?`, conv.id);
  assert.equal(await salesFollowUps(), 0);
  // broadcast whose channel is deleted mid-way doesn't crash the server
  process.env.BROADCAST_DELAY_MS = '50';
  run(`UPDATE conversations SET opted_out = 0, last_inbound_at = datetime('now') WHERE channel_id = ?`, fb);
  run('DELETE FROM broadcasts');
  const b = await c.call('POST', '/api/sales/broadcasts', { channel_id: fb, text: 'x', confirm_optin: true });
  assert.equal(b.status, 200, b.text);
  run('DELETE FROM channels WHERE id = ?', fb);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await fetch(`${base}/health`)).status, 200, 'still alive');
  process.env.BROADCAST_DELAY_MS = '0';
  run(`UPDATE workspaces SET plan = 'trial', trial_ends_at = datetime('now', '-1 day'), subscription_status = NULL WHERE id = ?`, ws);
  const sim = await c.call('POST', '/api/sales/simulate', { messages: [{ from: 'customer', text: 'hi' }] });
  assert.equal(sim.status, 402);
  assert.equal((await c.call('POST', '/api/sales/broadcasts', { channel_id: wa, text: 'x', confirm_optin: true })).status, 402);
});
