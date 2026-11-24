// "Continue with Facebook" (account + all pages in one step), auto-connect, page-profile autofill, comments,
// the learning engine (history import, live signals, distilled playbook, recall) and Meta's deletion callbacks —
// against a fake Graph API and a fake Anthropic API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { client, fakeAnthropic } from './helpers.js';

const APP_SECRET = 'feedfacecafebeef0123456789abcdef';
const calls = [];
let fbUser = { id: '9001', name: 'Shop Owner', email: 'owner@fb.test' };
const json = (res, o, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
const graph = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    calls.push({ method: req.method, path: u.pathname, q: Object.fromEntries(u.searchParams), auth: req.headers.authorization, body });
    const p = u.pathname.replace(/^\/v[\d.]+\//, '');
    if (p === 'oauth/access_token') return json(res, { access_token: u.searchParams.get('grant_type') ? 'USER-LONG' : 'USER-SHORT' });
    if (p === 'me') return json(res, fbUser);
    if (p === 'me/accounts') return json(res, { data: [{ id: '3001', name: 'Dhaka Fashion', access_token: 'PAGE-TOKEN-1', instagram_business_account: { id: '1780001', username: 'dhakafashion' } }, { id: '3002', name: 'Gadget Corner', access_token: 'PAGE-TOKEN-2' }] });
    if (p === 'debug_token') return json(res, { data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['5550001'] }] } });
    if (p === '5550001/phone_numbers') return json(res, { data: [{ id: '6660001', display_phone_number: '+880 1700-000000', verified_name: 'Dhaka Fashion' }] });
    if (p === '3001' || p === '3002') return json(res, { name: p === '3001' ? 'Dhaka Fashion' : 'Gadget Corner', category: 'Clothing store', about: 'Trendy hoodies and panjabis, cash on delivery.', website: 'https://dhakafashion.example', phone: '+8801700000000' });
    if (p === '3001/conversations' && u.searchParams.get('platform') === 'messenger') {
      return json(res, { data: [{ messages: { data: [ // newest first, like the Graph API
        { id: 'h4', message: 'Inside Dhaka delivery 70 taka, outside 130 taka 🙂', from: { id: '3001' }, created_time: '2026-11-01T10:05:00+0000' },
        { id: 'h3', message: 'delivery charge koto?', from: { id: 'cust-9' }, created_time: '2026-11-01T10:04:00+0000' },
        { id: 'h2', message: 'Ji apu, black hoodie 1200 taka. Size M L XL ache.', from: { id: '3001' }, created_time: '2026-11-01T10:01:00+0000' },
        { id: 'h1', message: 'hoodie er dam koto?', from: { id: 'cust-9' }, created_time: '2026-11-01T10:00:00+0000' },
      ] } }] });
    }
    if (p.endsWith('/conversations')) return json(res, { data: [] });
    if (p === '3001/feed') return json(res, { data: [{ id: '3001_77', comments: { data: [{ id: 'cm1', message: 'price?', from: { id: 'cust-5' }, created_time: '2026-11-02T09:00:00+0000',
      comments: { data: [{ id: 'cm2', message: 'Inbox e details dichi apu, check korun 💌', from: { id: '3001' }, created_time: '2026-11-02T09:02:00+0000' }] } }] } }] });
    if (p.endsWith('/feed') || p.endsWith('/media')) return json(res, { data: [] });
    if (p.endsWith('/subscribed_apps')) return json(res, { success: true });
    if (p.endsWith('/comments') || p.endsWith('/replies')) return json(res, { id: `reply_${calls.length}` });
    if (p.endsWith('/messages')) return json(res, { message_id: `m_${calls.length}`, messages: [{ id: 'wamid.1' }] });
    json(res, { error: { message: `unknown ${p}` } }, 404);
  });
});
await new Promise((r) => graph.listen(0, '127.0.0.1', r));

// Fake Claude: the learning engine (schema with "facts") gets a playbook; chats get a reply that uses learned style.
const aiCalls = [];
let chatReply = null;
const ai = await fakeAnthropic((body) => {
  aiCalls.push(body);
  const schema = body.output_config?.format?.schema;
  if (schema?.required?.includes('facts')) {
    return { summary: 'Dhaka clothing shop; friendly, uses apu/bhaiya.', style: { languages: 'Banglish', tone: 'friendly, apu/bhaiya', greeting: 'Ji apu', sign_off: '', emoji: 'one emoji', length: '1-2 sentences', comment_style: 'short public reply, details in inbox' },
      facts: [{ topic: 'price', fact: 'Black hoodie costs 1200 taka', last_seen: '2026-11-01' }, { topic: 'delivery', fact: 'Delivery inside Dhaka 70 taka, outside 130 taka', last_seen: '2026-11-01' }],
      faq: [{ question: 'delivery charge?', answer: 'Inside Dhaka 70 taka, outside 130 taka' }], avoid: ['promising free delivery'] };
  }
  return chatReply || { reply: 'Ji apu, black hoodie 1200 taka 🙂', private_reply: '', language: 'bn', intent: 'price', stage: 'interested', lead_score: 60, summary: 'Asked price.', order_status: 'none',
    order: { items: [], customer_name: '', phone: '', address: '', note: '' }, handoff: false, handoff_reason: '', confidence: 0.95, unsupported_claims: false };
});

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
const { setSetting } = await import('../src/settings.js');
const { flushSales } = await import('../src/services/sales.js');
const { learningIdle, similarExamples } = await import('../src/services/learning.js');

let server; let base;
before(() => {
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  setSetting('meta_app_id', '424242'); setSetting('meta_app_secret', APP_SECRET); setSetting('meta_verify_token', 'platform-verify-token-0123456789');
});
after(() => { server.close(); graph.close(); ai.close(); });

const sign = (raw, secret = APP_SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
const signedRequest = (obj, secret = APP_SECRET) => {
  const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}.${payload}`;
};
async function hook(payload) {
  const raw = JSON.stringify(payload);
  const r = await fetch(`${base}/api/social/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': sign(raw) }, body: raw });
  await flushSales(); await learningIdle();
  return r.status;
}
/** Follow our redirect to Facebook, then come back with a code. Returns the final /app#welcome query. */
async function viaFacebook(c, path) {
  const start = await c.call('GET', path);
  assert.equal(start.status, 302, start.text);
  const fb = new URL(start.headers.get('location'));
  assert.equal(fb.origin, 'https://www.facebook.com');
  const back = await c.call('GET', `/api/oauth/meta/callback?code=abc&state=${encodeURIComponent(fb.searchParams.get('state'))}`);
  await learningIdle();
  const loc = back.headers.get('location');
  return { fb, loc, q: new URLSearchParams(loc.split('?')[1] || '') };
}

let shop; // the account created with "Continue with Facebook"
test('Continue with Facebook: account created, every page + Instagram connected, shop described, history learned — one step', async () => {
  const c = client(base);
  assert.equal((await c.call('GET', '/api/public/config')).body.facebookSignup, true);
  const { fb, loc, q } = await viaFacebook(c, '/api/oauth/meta/signup');
  assert.match(fb.searchParams.get('scope'), /email/);
  assert.match(fb.searchParams.get('scope'), /pages_messaging/);
  assert.match(fb.searchParams.get('scope'), /pages_read_user_content/);
  assert.match(loc, /^\/app#welcome/);
  assert.equal(q.get('connected'), '3', 'two Pages + one linked Instagram, no picking step');
  const me = (await c.call('GET', '/api/auth/me')).body;
  assert.equal(me.user.email, 'owner@fb.test');
  const ws = me.workspace.id;
  shop = { c, ws };
  const chans = all('SELECT * FROM channels WHERE workspace_id = ? ORDER BY id', ws);
  assert.deepEqual(chans.map((x) => [x.platform, x.external_id, x.mode, x.comment_mode]), [['messenger', '3001', 'auto', 'auto'], ['instagram', '1780001', 'auto', 'auto'], ['messenger', '3002', 'auto', 'auto']]);
  assert.ok(calls.some((x) => x.path.endsWith('/3001/subscribed_apps') && /feed/.test(x.q.subscribed_fields)), 'comments (feed) subscribed too');
  // Shop profile filled from the Page — nothing typed by the owner.
  const w = one('SELECT * FROM workspaces WHERE id = ?', ws);
  assert.match(w.business_description, /Trendy hoodies/);
  assert.equal(w.name, 'Dhaka Fashion');
  assert.equal(w.allowed_link_domains, 'dhakafashion.example');
  // History learned automatically: 2 chat pairs + 1 comment pair; playbook distilled.
  const page1 = chans[0];
  assert.equal(one('SELECT history_status FROM channels WHERE id = ?', page1.id).history_status, 'done');
  const ex = all('SELECT * FROM learn_examples WHERE channel_id = ?', page1.id);
  assert.equal(ex.length, 3);
  assert.ok(ex.some((e) => e.kind === 'comment'));
  assert.ok(!JSON.stringify(ex).includes('1200 taka'), 'examples are encrypted at rest');
  const learning = (await c.call('GET', '/api/sales/learning')).body;
  const l1 = learning.channels.find((x) => x.id === page1.id);
  assert.equal(l1.from_history, 3);
  assert.equal(l1.profile.facts[0].fact, 'Black hoodie costs 1200 taka');
  assert.ok(aiCalls.some((b) => /hoodie er dam koto/.test(JSON.stringify(b.messages)) && b.output_config.format.schema.required.includes('facts')));
  // WhatsApp has no history API: learning starts with new chats.
  // Signing in again with Facebook logs into the same account (no duplicate).
  const again = client(base);
  await viaFacebook(again, '/api/oauth/meta/signup');
  assert.equal((await again.call('GET', '/api/auth/me')).body.workspace.id, ws);
  assert.equal(one(`SELECT COUNT(*) AS n FROM users WHERE facebook_id = '9001'`).n, 1);
});

test('the assistant answers with what it learned: playbook in the prompt, similar past replies as examples, learned prices allowed', async () => {
  const { ws } = shop;
  calls.length = 0; aiCalls.length = 0;
  await hook({ object: 'page', entry: [{ id: '3001', messaging: [{ sender: { id: 'psid-new' }, recipient: { id: '3001' }, timestamp: Date.now(), message: { mid: 'n1', text: 'hoodie dam koto apu?' } }] }] });
  const chatCall = aiCalls.find((b) => b.output_config?.format?.schema?.required?.includes('private_reply'));
  assert.match(chatCall.system[0].text, /Black hoodie costs 1200 taka/, 'learned facts in the system prompt');
  assert.match(chatCall.system[0].text, /Ji apu/, 'learned greeting/style');
  assert.match(JSON.stringify(chatCall.messages), /past_replies/);
  assert.match(JSON.stringify(chatCall.messages), /black hoodie 1200 taka\. Size M L XL/, 'most similar past answer recalled');
  const sent = calls.find((x) => x.path.endsWith('/3001/messages'));
  assert.ok(sent, 'auto-sent: "1200" is a price the shop itself uses, so the guard allows it (no catalog needed)');
  const sim = similarExamples(ws, null, 'message', 'daam koto hoodie');
  assert.ok(sim.good.length >= 1, 'Banglish spelling variants still match');
});

test('live learning: human replies, Meta-inbox replies, edited and discarded drafts all teach the assistant', async () => {
  const { c, ws } = shop;
  const page2 = one(`SELECT * FROM channels WHERE workspace_id = ? AND external_id = '3002'`, ws);
  const before = one('SELECT COUNT(*) AS n FROM learn_examples WHERE channel_id = ?', page2.id).n;
  run(`UPDATE channels SET mode = 'draft' WHERE id = ?`, page2.id);
  // 1) customer asks, owner discards the AI draft and writes their own answer
  await hook({ object: 'page', entry: [{ id: '3002', messaging: [{ sender: { id: 'g1' }, recipient: { id: '3002' }, timestamp: Date.now(), message: { mid: 'g1a', text: 'earbuds warranty ache?' } }] }] });
  const conv = one(`SELECT * FROM conversations WHERE customer_id = 'g1'`);
  const draft = one(`SELECT * FROM chat_messages WHERE conversation_id = ? AND status = 'draft'`, conv.id);
  await c.call('POST', `/api/sales/messages/${draft.id}/reject`);
  assert.equal((await c.call('POST', `/api/sales/conversations/${conv.id}/reply`, { body: '6 months official warranty bhaiya' })).status, 200);
  // 2) next question: AI draft edited before sending
  run('UPDATE conversations SET ai_paused_until = NULL WHERE id = ?', conv.id);
  await hook({ object: 'page', entry: [{ id: '3002', messaging: [{ sender: { id: 'g1' }, recipient: { id: '3002' }, timestamp: Date.now(), message: { mid: 'g1b', text: 'cash on delivery hobe?' } }] }] });
  const d2 = one(`SELECT * FROM chat_messages WHERE conversation_id = ? AND status = 'draft'`, conv.id);
  assert.equal((await c.call('POST', `/api/sales/messages/${d2.id}/approve`, { body: 'Ji bhaiya, all Bangladesh COD available' })).status, 200);
  // 3) staff answer another customer directly in Meta's inbox (echo)
  await hook({ object: 'page', entry: [{ id: '3002', messaging: [{ sender: { id: 'g2' }, recipient: { id: '3002' }, timestamp: Date.now(), message: { mid: 'g2a', text: 'shop kothay?' } }] }] });
  await hook({ object: 'page', entry: [{ id: '3002', messaging: [{ sender: { id: '3002' }, recipient: { id: 'g2' }, timestamp: Date.now(), message: { mid: 'echo-staff-1', is_echo: true, text: 'Online only bhaiya, home delivery' } }] }] });
  const rows = all('SELECT source, weight FROM learn_examples WHERE channel_id = ? ORDER BY id', page2.id).slice(before);
  const sources = rows.map((r) => r.source);
  assert.ok(sources.includes('ai_rejected'), 'discarded draft = negative example');
  assert.ok(sources.includes('human'), 'owner reply learned');
  assert.ok(sources.includes('ai_edited'), 'edited draft learned with high weight');
  assert.ok(sources.includes('human_app'), 'reply typed in Meta inbox learned');
  assert.ok(rows.find((r) => r.source === 'ai_edited').weight > rows.find((r) => r.source === 'human').weight);
  assert.ok(rows.filter((r) => r.source === 'ai_rejected').every((r) => r.weight < 0));
  // personal data is masked before learning
  await hook({ object: 'page', entry: [{ id: '3002', messaging: [{ sender: { id: 'g3' }, recipient: { id: '3002' }, timestamp: Date.now(), message: { mid: 'g3a', text: 'number dien' } }] }] });
  await hook({ object: 'page', entry: [{ id: '3002', messaging: [{ sender: { id: '3002' }, recipient: { id: 'g3' }, timestamp: Date.now(), message: { mid: 'echo-staff-2', is_echo: true, text: 'Call 01711-223344 or mail sales@gadget.test' } }] }] });
  const { open } = await import('../src/vault.js');
  const last = one(`SELECT * FROM learn_examples WHERE channel_id = ? ORDER BY id DESC LIMIT 1`, page2.id);
  const a = open(ws, 'learn.answer', last.answer_enc);
  assert.ok(!a.includes('01711') && !a.includes('sales@gadget.test'), a);
  // the playbook of page 2 was (re)distilled from these live lessons
  assert.ok(one('SELECT COUNT(*) AS n FROM learned_profiles WHERE channel_id = ?', page2.id).n >= 1);
  // owner can remove a learned fact; it is never learned again
  await c.call('POST', '/api/sales/learning/forget', { fact: 'Black hoodie costs 1200 taka' });
  const l = (await c.call('GET', '/api/sales/learning')).body.channels.find((x) => x.external_id === '3001' || x.name === 'Dhaka Fashion');
  assert.ok(!l.profile.facts.some((f) => f.fact === 'Black hoodie costs 1200 taka'));
});

test('comments: AI replies publicly + sends details privately; page\'s own comment replies are learned', async () => {
  const { ws } = shop;
  calls.length = 0;
  chatReply = { reply: 'Inbox check korun apu 💌', private_reply: 'Size M L XL ache, Dhaka delivery 70 taka. Order korte nam, phone, address din.', language: 'bn', intent: 'price', stage: 'interested', lead_score: 55,
    summary: 'Asked price under post.', order_status: 'none', order: { items: [], customer_name: '', phone: '', address: '', note: '' }, handoff: false, handoff_reason: '', confidence: 0.95, unsupported_claims: false };
  await hook({ object: 'page', entry: [{ id: '3001', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '3001_77_c9', post_id: '3001_77', parent_id: '3001_77', from: { id: 'cust-77', name: 'Nadia' }, message: 'price koto?', created_time: Math.floor(Date.now() / 1000) } }] }] });
  const pub = calls.find((x) => x.path.endsWith('/3001_77_c9/comments'));
  assert.ok(pub, 'public reply under the comment');
  assert.equal(JSON.parse(pub.body).message, 'Inbox check korun apu 💌');
  const priv = calls.find((x) => x.path.endsWith('/3001/messages'));
  assert.deepEqual(JSON.parse(priv.body).recipient, { comment_id: '3001_77_c9' }, 'private reply to the commenter');
  const conv = one(`SELECT * FROM conversations WHERE customer_id = 'c:3001_77_c9'`);
  assert.equal(conv.kind, 'comment'); assert.equal(conv.customer_name, 'Nadia');
  // Our own reply echoing back is ignored; a reply the page writes itself is learned.
  const ours = one(`SELECT external_id FROM chat_messages WHERE conversation_id = ? AND delivery = 'public' AND status = 'sent'`, conv.id).external_id;
  await hook({ object: 'page', entry: [{ id: '3001', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: ours, post_id: '3001_77', parent_id: '3001_77_c9', from: { id: '3001' }, message: 'Inbox check korun apu 💌' } }] }] });
  assert.equal(one(`SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ? AND source = 'human_app'`, conv.id).n, 0);
  await hook({ object: 'page', entry: [{ id: '3001', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '3001_77_c10', post_id: '3001_77', parent_id: '3001_77_c9', from: { id: 'cust-77', name: 'Nadia' }, message: 'blue color ache?' } }] }] });
  await hook({ object: 'page', entry: [{ id: '3001', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '3001_77_c11', post_id: '3001_77', parent_id: '3001_77_c10', from: { id: '3001' }, message: 'Blue next week ashbe apu' } }] }] });
  const learned = all(`SELECT * FROM learn_examples WHERE conversation_id = ? AND kind = 'comment'`, conv.id);
  assert.ok(learned.some((e) => e.source === 'human_app'), 'page reply to a comment is learned');
  // Instagram comment
  calls.length = 0;
  chatReply = { ...chatReply, reply: 'DM korechi 💌', private_reply: '' };
  await hook({ object: 'instagram', entry: [{ id: '1780001', changes: [{ field: 'comments', value: { id: 'igc1', text: 'how much?', from: { id: 'igu1', username: 'rina' }, media: { id: 'med1' } } }] }] });
  assert.ok(calls.some((x) => x.path.endsWith('/igc1/replies')), 'Instagram comments are answered with /replies');
  chatReply = null;
  void ws;
});

test('multiple pages in one account: filter chats by page and by comments', async () => {
  const { c } = shop;
  const page1 = one(`SELECT id FROM channels WHERE external_id = '3001'`).id;
  const page2 = one(`SELECT id FROM channels WHERE external_id = '3002'`).id;
  const p1 = (await c.call('GET', `/api/sales/conversations?channel=${page1}`)).body;
  const p2 = (await c.call('GET', `/api/sales/conversations?channel=${page2}`)).body;
  assert.ok(p1.length && p2.length);
  assert.ok(p1.every((x) => x.channel_id === page1) && p2.every((x) => x.channel_id === page2));
  const comments = (await c.call('GET', '/api/sales/conversations?kind=comment')).body;
  assert.ok(comments.length >= 2 && comments.every((x) => x.kind === 'comment'));
  const dash = (await c.call('GET', '/api/dashboard')).body;
  assert.equal(dash.pages.length, 3);
  assert.ok(dash.pages.every((x) => 'learned' in x && 'today' in x));
});

test('signed-in Connect, WhatsApp via Embedded Signup, and the safe-linking rules', async () => {
  // A password account connects WhatsApp: numbers come from the token's granular scopes, WABA subscribed.
  const c = client(base);
  await c.signup('wa@meta.test');
  setSetting('meta_config_id_whatsapp', '777888');
  fbUser = { id: '9002', name: 'WA Owner', email: 'wa-owner@fb.test' };
  const { fb, q } = await viaFacebook(c, '/api/oauth/meta/connect?kind=whatsapp');
  assert.equal(fb.searchParams.get('config_id'), '777888');
  assert.equal(q.get('connected'), '1');
  const ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  const ch = one('SELECT * FROM channels WHERE workspace_id = ?', ws);
  assert.equal(ch.platform, 'whatsapp'); assert.equal(ch.waba_id, '5550001');
  assert.equal(ch.history_status, 'unavailable');
  setSetting('meta_config_id_whatsapp', '');
  // The same Page cannot be taken over by another account.
  fbUser = { id: '9003', name: 'Other', email: 'other@fb.test' };
  const o = client(base);
  const r = await viaFacebook(o, '/api/oauth/meta/signup');
  assert.equal(r.q.get('connected'), '0');
  assert.match(r.q.get('problems'), /another ChatPilot account/);
  // Facebook email matching an existing password account is not auto-linked.
  fbUser = { id: '9004', name: 'Imposter', email: 'wa@meta.test' };
  const x = await viaFacebook(client(base), '/api/oauth/meta/signup');
  assert.match(x.loc, /^\/signup\?error=account_exists_use_password/);
  // Forged state / cancelled dialog / not configured
  assert.match((await c.call('GET', '/api/oauth/meta/callback?code=x&state=forged')).headers.get('location'), /error=expired/);
  assert.match((await c.call('GET', '/api/oauth/meta/callback?error=access_denied&error_reason=user_denied')).headers.get('location'), /error=user_denied/);
  setSetting('meta_app_secret', '');
  assert.match((await c.call('GET', '/api/oauth/meta/connect')).headers.get('location'), /not_configured/);
  setSetting('meta_app_secret', APP_SECRET);
  assert.equal((await client(base).call('GET', '/api/oauth/meta/connect')).status, 401);
});

test('Meta deauthorize and data-deletion callbacks verify signed_request and remove the user\'s data, including what was learned', async () => {
  const ch = one(`SELECT * FROM channels WHERE external_id = '3002'`);
  assert.ok(one('SELECT COUNT(*) AS n FROM learn_examples WHERE channel_id = ?', ch.id).n > 0);
  const form = (sr) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `signed_request=${encodeURIComponent(sr)}` });
  assert.equal((await fetch(`${base}/api/meta/deauthorize`, form(signedRequest({ algorithm: 'HMAC-SHA256', user_id: '9001' }, 'wrong-secret')))).status, 400);
  assert.equal((await fetch(`${base}/api/meta/deauthorize`, form(signedRequest({ algorithm: 'HMAC-SHA256', user_id: '9001' })))).status, 200);
  const off = one('SELECT * FROM channels WHERE id = ?', ch.id);
  assert.equal(off.enabled, 0); assert.equal(off.access_token_enc, '');
  const r = await fetch(`${base}/api/meta/data-deletion`, form(signedRequest({ algorithm: 'HMAC-SHA256', user_id: '9001', issued_at: 1 })));
  const body = await r.json();
  assert.match(body.confirmation_code, /^[a-f0-9]{20}$/);
  assert.equal(one(`SELECT COUNT(*) AS n FROM channels WHERE connected_by = '9001'`).n, 0);
  assert.equal(one('SELECT COUNT(*) AS n FROM learn_examples WHERE channel_id = ?', ch.id).n, 0, 'learned examples deleted with the page');
  const page = await (await fetch(new URL(new URL(body.url).pathname + new URL(body.url).search, base))).text();
  assert.match(page, /Completed/);
  assert.match(await (await fetch(`${base}/deletion?code=<script>`)).text(), /could not find/);
});
