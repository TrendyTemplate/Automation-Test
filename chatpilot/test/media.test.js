// Rich messages: customer photos reach the AI (vision) next to catalog photos, voice notes go to a human,
// product photos are sent, ad referrals are remembered, and payload URLs can't be used to reach other hosts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { client, fakeAnthropic } from './helpers.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const sent = []; const fetched = [];
const graph = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; });
  req.on('end', () => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p.endsWith('.png')) { fetched.push(p); res.setHeader('content-type', 'image/png'); return res.end(PNG); }
    res.setHeader('content-type', 'application/json');
    if (/\/wa-media-1$/.test(p)) return res.end(JSON.stringify({ url: `http://127.0.0.1:${graph.address().port}/wa/photo.png` }));
    if (req.method === 'POST') sent.push({ path: p, body: JSON.parse(b || '{}') });
    res.end('{"message_id":"m1","messages":[{"id":"w1"}]}');
  });
});
await new Promise((r) => graph.listen(0, '127.0.0.1', r));
const aiReqs = [];
let reply = null;
const ai = await fakeAnthropic((body) => { aiReqs.push(body); return reply; });
const decision = (o = {}) => ({ reply: 'Ji, eta amader Black Hoodie — 1200 taka.', product_photos: [], private_reply: '', language: 'bn', intent: 'photo match', stage: 'interested', lead_score: 60, summary: 'Sent a photo.',
  order_status: 'none', order: { items: [], customer_name: '', phone: '', address: '', delivery_zone: '', note: '' }, handoff: false, handoff_reason: '', confidence: 0.95, unsupported_claims: false, ...o });
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
let server; let base; let ws; let hoodie;
const G = () => `http://127.0.0.1:${graph.address().port}`;
before(async () => {
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  const c = client(base); await c.signup('media@shop.test');
  ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly' WHERE id = ?`, ws);
  hoodie = (await c.call('POST', '/api/sales/products', { name: 'Black Hoodie', price: 1200, image_url: 'https://cdn.shop.example/hoodie.jpg' })).body;
  for (const [pf, id] of [['messenger', '800001'], ['whatsapp', '800002']]) {
    run(`INSERT INTO channels (workspace_id, platform, name, external_id, access_token_enc, app_secret_enc, verify_token, mode) VALUES (?,?,?,?,?,?,?, 'auto')`,
      ws, pf, pf, id, seal(ws, 'channels.access_token', 'TOKEN'), seal(ws, 'channels.app_secret', SECRET), `cp_media_${id}_00000000000000`);
  }
});
after(() => { server.close(); graph.close(); ai.close(); });
async function hook(payload) {
  const raw = JSON.stringify(payload);
  await fetch(`${base}/api/social/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}` }, body: raw });
  await flushSales();
}
const fb = (msg, extra = {}) => ({ object: 'page', entry: [{ id: '800001', messaging: [{ sender: { id: 'psid-m' }, recipient: { id: '800001' }, timestamp: Date.now(), message: { mid: `mid-${Math.random()}`, ...msg }, ...extra }] }] });

test('a customer photo is shown to the AI next to the catalog photos; product photo sent back', async () => {
  reply = decision({ product_photos: [hoodie.id] });
  aiReqs.length = 0; sent.length = 0;
  await hook(fb({ text: 'eta ache?', attachments: [{ type: 'image', payload: { url: `${G()}/cdn/photo.png` } }] }));
  const blocks = aiReqs.at(-1).messages[0].content;
  assert.ok(Array.isArray(blocks));
  assert.ok(blocks.some((b) => b.type === 'image' && b.source.type === 'base64' && b.source.media_type === 'image/png'), 'customer photo as base64');
  assert.ok(blocks.some((b) => b.type === 'image' && b.source.type === 'url' && b.source.url === 'https://cdn.shop.example/hoodie.jpg'), 'catalog photo for comparison');
  assert.ok(blocks.some((b) => b.type === 'text' && /\[id \d+\] Black Hoodie/.test(b.text)));
  assert.match(one(`SELECT body FROM chat_messages WHERE direction = 'in' ORDER BY id DESC LIMIT 1`).body, /^e3\./);
  const img = sent.find((x) => x.body.message?.attachment);
  assert.equal(img.body.message.attachment.payload.url, 'https://cdn.shop.example/hoodie.jpg', 'product photo sent');
  assert.ok(sent.some((x) => /1200/.test(x.body.message?.text || '')));
});

test('WhatsApp photos are fetched through the media API with the token', async () => {
  reply = decision();
  fetched.length = 0;
  await hook({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '800002' }, contacts: [{ wa_id: '8801800', profile: { name: 'R' } }],
    messages: [{ from: '8801800', id: 'wamid.img', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'wa-media-1', caption: 'price?' } }] } }] }] });
  assert.deepEqual(fetched, ['/wa/photo.png']);
  assert.ok(aiReqs.at(-1).messages[0].content.some((b) => b.type === 'image' && b.source.type === 'base64'));
});

test('photo URLs from a payload pointing elsewhere are never fetched (no SSRF)', async () => {
  reply = decision();
  fetched.length = 0;
  await hook(fb({ attachments: [{ type: 'image', payload: { url: 'http://169.254.169.254/latest/meta-data/x.png' } }] }));
  await hook(fb({ attachments: [{ type: 'image', payload: { url: 'https://evil.example/x.png' } }] }));
  assert.equal(fetched.length, 0);
  assert.equal(typeof aiReqs.at(-1).messages[0].content, 'string', 'no image block — the AI just sees "[photo]"');
  assert.match(aiReqs.at(-1).messages[0].content, /\[photo\]/);
});

test('voice notes are labelled for the AI (which hands them to a person); ad referrals are remembered', async () => {
  reply = decision({ reply: 'Voice message shunte parchi na, ektu likhe janaben? 🙏', handoff: true, handoff_reason: 'Voice message' });
  await hook(fb({ attachments: [{ type: 'audio', payload: { url: `${G()}/cdn/v.mp4` } }] }, { }));
  assert.match(aiReqs.at(-1).messages[0].content, /\[voice message\]/);
  assert.equal(one(`SELECT status FROM conversations WHERE customer_id = 'psid-m'`).status, 'needs_human');
  await hook({ object: 'page', entry: [{ id: '800001', messaging: [{ sender: { id: 'psid-ad' }, recipient: { id: '800001' }, timestamp: Date.now(),
    message: { mid: 'mid-ad', text: 'details plz', referral: { source: 'ADS', type: 'OPEN_THREAD', ad_id: '120208888', ads_context_data: { ad_title: 'Winter hoodie sale' } } } }] }] });
  const ref = JSON.parse(one(`SELECT referral_json FROM conversations WHERE customer_id = 'psid-ad'`).referral_json);
  assert.deepEqual([ref.source, ref.ad_id, ref.ad_title], ['ADS', '120208888', 'Winter hoodie sale']);
});
