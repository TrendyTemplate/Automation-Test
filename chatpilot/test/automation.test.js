// Rules without the AI: comment moderation (hide phones / links / words), keyword replies, posts with replies off,
// once per person per post, business hours + away message, chat profile (Get Started, ice breakers, menu), story replies, postbacks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { client, fakeAnthropic } from './helpers.js';

const sent = [];
const graph = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'application/json');
    if (req.method !== 'GET') sent.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: JSON.parse(b || '{}') });
    res.end('{"id":"r1","message_id":"m1","success":true}');
  });
});
await new Promise((r) => graph.listen(0, '127.0.0.1', r));
const aiReqs = [];
const ai = await fakeAnthropic((body) => { aiReqs.push(body); return { reply: 'Inbox check korun 🙂', product_photos: [], private_reply: 'Dam 1200 taka.', language: 'bn', intent: 'price', stage: 'interested', lead_score: 50, summary: 'Asked price.',
  order_status: 'none', order: { items: [], customer_name: '', phone: '', address: '', delivery_zone: '', note: '' }, handoff: false, handoff_reason: '', confidence: 0.95, unsupported_claims: false }; });
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_LIMIT = '500';
process.env.ANTHROPIC_BASE_URL = ai.url;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.META_GRAPH_URL = `http://127.0.0.1:${graph.address().port}`;
process.env.SALES_DEBOUNCE_MS = '0';
process.env.LEARN_DEBOUNCE_MS = '0';
const { createApp } = await import('../src/server.js');
const { run, one, all } = await import('../src/db.js');
const { seal } = await import('../src/vault.js');
const { flushSales } = await import('../src/services/sales.js');
const { isOpen, validateHours } = await import('../src/services/automation.js');

const SECRET = '0123456789abcdef0123456789abcdef';
let server; let base; let c; let ws; let page; let wa;
before(async () => {
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  c = client(base); await c.signup('rules@shop.test');
  ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly' WHERE id = ?`, ws);
  await c.call('POST', '/api/sales/products', { name: 'Black Hoodie', price: 1200 });
  const add = (pf, id) => Number(run(`INSERT INTO channels (workspace_id, platform, name, external_id, access_token_enc, app_secret_enc, verify_token, mode, comment_mode) VALUES (?,?,?,?,?,?,?, 'auto', 'auto')`,
    ws, pf, pf, id, seal(ws, 'channels.access_token', 'TOKEN'), seal(ws, 'channels.app_secret', SECRET), `cp_rules_${id}_00000000000000`).lastInsertRowid);
  page = add('messenger', '910001'); wa = add('whatsapp', '910002');
});
after(() => { server.close(); graph.close(); ai.close(); });
async function hook(payload) {
  const raw = JSON.stringify(payload);
  const r = await fetch(`${base}/api/social/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}` }, body: raw });
  await flushSales();
  await new Promise((res) => setTimeout(res, 50)); // hide / keyword sends run in the background
  return r;
}
let n = 0;
const comment = (text, { from = 'u1', post = '910001_p1' } = {}) => ({ object: 'page', entry: [{ id: '910001', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: `cm${++n}`, post_id: post, from: { id: from, name: 'Buyer' }, message: text, created_time: Math.floor(Date.now() / 1000) } }] }] });

test('comment rules: validation', async () => {
  assert.equal((await c.call('PUT', `/api/sales/channels/${page}/rules`, { triggers: [{ words: 'price' }] })).status, 400, 'a keyword needs a reply');
  const r = await c.call('PUT', `/api/sales/channels/${page}/rules`, { hide_phones: true, hide_links: true, hide_words: 'scam, fake', skip_posts: ['https://facebook.com/shop/posts/910001_p9'],
    triggers: [{ words: 'dam koto, price', public: 'Inbox e details dilam ✅', private: 'Black Hoodie: 1200 taka. Order korte naam, phone, thikana din.' }] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.comment_rules.hide_words, ['scam', 'fake']);
  assert.deepEqual(r.body.comment_rules.skip_posts, ['910001_p9'], 'post links are reduced to the id');
  assert.equal(r.body.comment_rules.once_per_person, true);
});

test('a comment with a phone number (Bangla digits too) or a blocked word is hidden, not answered', async () => {
  sent.length = 0; aiReqs.length = 0;
  await hook(comment('amar number ০১৭১১-২২৩৩৪৪ call den'));
  assert.ok(sent.some((x) => /\/cm\d+$/.test(x.path) && x.body.is_hidden === true), 'hidden on Facebook');
  assert.equal(aiReqs.length, 0, 'AI not asked');
  const conv = one(`SELECT * FROM conversations WHERE kind = 'comment' ORDER BY id DESC LIMIT 1`);
  assert.equal(conv.status, 'closed');
  assert.match(conv.handoff_reason, /phone/);
  sent.length = 0;
  await hook(comment('this page is a SCAM', { from: 'u2' }));
  assert.ok(sent.some((x) => x.body.is_hidden === true));
  assert.equal(aiReqs.length, 0);
});

test('keyword reply goes out publicly and in the inbox without the AI; posts with replies off are skipped', async () => {
  sent.length = 0; aiReqs.length = 0;
  await hook(comment('Dam koto vai?', { from: 'u3' }));
  assert.equal(aiReqs.length, 0);
  assert.ok(sent.some((x) => /\/comments$/.test(x.path) && x.body.message === 'Inbox e details dilam ✅'), 'public reply');
  assert.ok(sent.some((x) => /\/messages$/.test(x.path) && x.body.recipient?.comment_id && /1200 taka/.test(x.body.message.text)), 'private reply');
  sent.length = 0;
  await hook(comment('size ki ki ache?', { from: 'u4', post: '910001_p9' }));
  assert.equal(sent.length, 0); assert.equal(aiReqs.length, 0, 'post has auto replies off');
  await hook(comment('size ki ki ache?', { from: 'u4' }));
  assert.equal(aiReqs.length, 1, 'other posts go to the AI');
  assert.ok(sent.some((x) => x.body.message === 'Inbox check korun 🙂'));
  sent.length = 0; aiReqs.length = 0;
  await hook(comment('XL ache?', { from: 'u4' }));
  assert.equal(aiReqs.length, 0, 'same person on the same post: answered once');
  assert.equal(sent.length, 0);
});

test('business hours: overnight ranges, validation, away message once, AI quiet when asked', async () => {
  assert.throws(() => validateHours({ days: { mon: ['25:00', '10:00'] } }), /times/);
  assert.throws(() => validateHours({ tz: 'Mars/Base' }), /time zone/);
  const all7 = (v) => Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, v]));
  const w = { hours_json: JSON.stringify({ enabled: true, tz: 'Asia/Dhaka', days: all7(['18:00', '02:00']) }) };
  assert.equal(isOpen(w, new Date('2026-11-25T14:00:00Z')), true, '20:00 Dhaka');
  assert.equal(isOpen(w, new Date('2026-11-25T19:30:00Z')), true, '01:30 Dhaka, overnight');
  assert.equal(isOpen(w, new Date('2026-11-25T06:00:00Z')), false, '12:00 Dhaka');
  // Closed all week, AI stays quiet: away message only.
  const r = await c.call('PUT', '/api/sales/hours', { enabled: true, tz: 'Asia/Dhaka', days: all7(null), away: 'Amra ekhon bondho, kal uttor dibo.', ai_after_hours: false });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.open_now, false);
  sent.length = 0; aiReqs.length = 0;
  const wamsg = (text) => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '910002' }, contacts: [{ wa_id: '8801700000001', profile: { name: 'R' } }],
    messages: [{ from: '8801700000001', id: `wamid.${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
  await hook(wamsg('hello'));
  await hook(wamsg('ache?'));
  const away = sent.filter((x) => x.body.text?.body === 'Amra ekhon bondho, kal uttor dibo.');
  assert.equal(away.length, 1, 'once per 12 hours');
  assert.equal(aiReqs.length, 0);
  // AI may answer after hours: it is told the shop is closed, no away message on top.
  await c.call('PUT', '/api/sales/hours', { enabled: true, tz: 'Asia/Dhaka', days: all7(null), away: 'x', ai_after_hours: true });
  await hook(wamsg('order dite chai'));
  assert.equal(aiReqs.length, 1);
  assert.match(JSON.stringify(aiReqs[0].system), /CLOSED/);
  await c.call('PUT', '/api/sales/hours', { enabled: false });
});

test('chat profile: Messenger Get Started + greeting + ice breakers + menu; WhatsApp prompts; bad links refused', async () => {
  assert.equal((await c.call('PUT', `/api/sales/channels/${page}/profile`, { menu: [{ title: 'Site', url: 'http://x.test' }] })).status, 400);
  sent.length = 0;
  const r = await c.call('PUT', `/api/sales/channels/${page}/profile`, { greeting: 'Assalamu alaikum!', ice_breakers: 'Dam koto?\nDelivery charge koto?', menu: [{ title: 'Order korbo' }, { title: 'Website', url: 'https://shop.test' }] });
  assert.equal(r.status, 200, r.text);
  const post = sent.find((x) => x.method === 'POST' && x.path.endsWith('/910001/messenger_profile'));
  assert.equal(post.body.get_started.payload, 'GET_STARTED');
  assert.equal(post.body.greeting[0].text, 'Assalamu alaikum!');
  assert.deepEqual(post.body.ice_breakers[0].call_to_actions.map((x) => x.question), ['Dam koto?', 'Delivery charge koto?']);
  assert.deepEqual(post.body.persistent_menu[0].call_to_actions.map((x) => x.type), ['postback', 'web_url']);
  assert.deepEqual(r.body.profile.ice_breakers, ['Dam koto?', 'Delivery charge koto?']);
  sent.length = 0;
  assert.equal((await c.call('PUT', `/api/sales/channels/${wa}/profile`, { ice_breakers: ['Price?'] })).status, 200);
  const w = sent.find((x) => x.path.endsWith('/910002/conversational_automation'));
  assert.deepEqual(JSON.parse(w.query.prompts), ['Price?']);
});

test('tapping an ice breaker and replying to a story reach the AI as customer messages', async () => {
  aiReqs.length = 0;
  await hook({ object: 'page', entry: [{ id: '910001', messaging: [{ sender: { id: 'psid-pb' }, recipient: { id: '910001' }, timestamp: Date.now(), postback: { title: 'Dam koto?', payload: 'ICE:Dam koto?', mid: 'pb-1' } }] }] });
  assert.equal(aiReqs.length, 1);
  const conv = one(`SELECT id FROM conversations WHERE customer_id = 'psid-pb'`);
  assert.ok(all('SELECT id FROM chat_messages WHERE conversation_id = ? AND direction = \'in\'', conv.id).length === 1);
  await hook({ object: 'instagram', entry: [{ id: '910001', messaging: [{ sender: { id: 'ig-1' }, recipient: { id: '910001' }, timestamp: Date.now(), message: { mid: 'ig-m1', text: 'eta koto?', reply_to: { story: { id: 's1', url: 'https://cdninstagram.com/s1.jpg' } } } }] }] });
  // No Instagram channel with that id here; the parser is what matters.
  const { parseWebhook } = await import('../src/services/social.js');
  const ev = parseWebhook({ object: 'instagram', entry: [{ id: '1', messaging: [{ sender: { id: 'a' }, recipient: { id: '1' }, timestamp: 1, message: { mid: 'x', text: 'hi', reply_to: { story: { id: 's', url: 'https://cdninstagram.com/s.jpg' } }, attachments: [{ type: 'story_mention', payload: { url: 'https://cdninstagram.com/m.jpg' } }] } }] }] })[0];
  assert.deepEqual(ev.attachments.map((a) => a.type), ['story_reply', 'story_mention']);
});
