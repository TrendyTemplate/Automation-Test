// "Connect with Facebook" (platform Meta app), webhooks signed with the platform secret, and Meta's
// data-deletion / deauthorize callbacks — against a fake Graph API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { client, fakeAnthropic } from './helpers.js';

const APP_SECRET = 'feedfacecafebeef0123456789abcdef';
const calls = [];
const graph = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    calls.push({ method: req.method, path: u.pathname, q: Object.fromEntries(u.searchParams), auth: req.headers.authorization, body });
    const p = u.pathname.replace(/^\/v[\d.]+\//, '');
    const json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (p === 'oauth/access_token') return json({ access_token: u.searchParams.get('grant_type') ? 'USER-LONG' : 'USER-SHORT' });
    if (p === 'me') return json({ id: '9001', name: 'Shop Owner' });
    if (p === 'me/accounts') return json({ data: [{ id: '3001', name: 'Dhaka Fashion', access_token: 'PAGE-TOKEN-1', instagram_business_account: { id: '1780001', username: 'dhakafashion' } }, { id: '3002', name: 'Second Page', access_token: 'PAGE-TOKEN-2' }] });
    if (p === 'debug_token') return json({ data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['5550001'] }, { scope: 'business_management' }] } });
    if (p === '5550001/phone_numbers') return json({ data: [{ id: '6660001', display_phone_number: '+880 1700-000000', verified_name: 'Dhaka Fashion' }] });
    if (p.endsWith('/subscribed_apps')) return json({ success: true });
    if (p.endsWith('/messages')) return json({ message_id: 'm_1', messages: [{ id: 'wamid.1' }] });
    res.statusCode = 404; json({ error: { message: `unknown ${p}` } });
  });
});
await new Promise((r) => graph.listen(0, '127.0.0.1', r));
const ai = await fakeAnthropic(() => ({ reply: 'Hello!', language: 'en', intent: 'hi', stage: 'browsing', lead_score: 10, summary: 'Said hi.', order_status: 'none',
  order: { items: [], customer_name: '', phone: '', address: '', note: '' }, handoff: false, handoff_reason: '', confidence: 0.95, unsupported_claims: false }));

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_LIMIT = '500';
process.env.ANTHROPIC_BASE_URL = ai.url;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.META_GRAPH_URL = `http://127.0.0.1:${graph.address().port}`;
process.env.SALES_DEBOUNCE_MS = '0';
const { createApp } = await import('../src/server.js');
const { run, one, all } = await import('../src/db.js');
const { setSetting } = await import('../src/settings.js');
const { flushSales } = await import('../src/services/sales.js');

let server; let base;
before(() => {
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  setSetting('meta_app_id', '424242'); setSetting('meta_app_secret', APP_SECRET); setSetting('meta_verify_token', 'platform-verify-token-0123456789');
});
after(() => { server.close(); graph.close(); ai.close(); });

async function owner(email) {
  const c = client(base);
  await c.signup(email);
  const ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly' WHERE id = ?`, ws);
  return { c, ws };
}
// Follow our own redirect to Facebook, then "come back" from Facebook with a code.
async function connect(c, kind) {
  const start = await c.call('GET', `/api/oauth/meta/connect?kind=${kind}`);
  assert.equal(start.status, 302);
  const fb = new URL(start.headers.get('location'));
  assert.equal(fb.origin, 'https://www.facebook.com');
  assert.match(fb.pathname, /\/dialog\/oauth$/);
  assert.equal(fb.searchParams.get('client_id'), '424242');
  const back = await c.call('GET', `/api/oauth/meta/callback?code=abc&state=${encodeURIComponent(fb.searchParams.get('state'))}`);
  const hash = back.headers.get('location');
  const pick = new URLSearchParams(hash.split('?')[1]).get('pick');
  assert.ok(pick, hash);
  return { fb, pick };
}
const sign = (raw, secret = APP_SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
const signedRequest = (obj, secret = APP_SECRET) => {
  const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}.${payload}`;
};

test('Connect with Facebook: Pages + Instagram picked, webhooks subscribed, tokens encrypted, no per-shop app needed', async () => {
  const { c, ws } = await owner('fb@meta.test');
  assert.equal((await c.call('GET', '/api/sales/meta/status')).body.available, true);
  const { fb, pick } = await connect(c, 'pages');
  assert.match(fb.searchParams.get('scope'), /pages_messaging/);
  assert.match(fb.searchParams.get('scope'), /instagram_manage_messages/);
  const list = (await c.call('GET', `/api/sales/meta/pending/${pick}`)).body;
  assert.equal(list.kind, 'pages');
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].instagram.username, 'dhakafashion');
  assert.ok(!JSON.stringify(list).includes('PAGE-TOKEN'), 'tokens never reach the browser');
  // another user cannot use this pending selection
  const other = await owner('other@meta.test');
  assert.equal((await other.c.call('GET', `/api/sales/meta/pending/${pick}`)).status, 404);

  calls.length = 0;
  const done = await c.call('POST', `/api/sales/meta/pending/${pick}/connect`, { select: ['messenger:3001', 'instagram:1780001'], mode: 'auto' });
  assert.equal(done.status, 200, done.text);
  assert.ok(done.body.results.every((r) => r.ok));
  const subs = calls.filter((x) => x.path.endsWith('/subscribed_apps'));
  assert.equal(subs.length, 1, 'one subscription per Page covers Messenger and Instagram');
  assert.equal(subs[0].auth, 'Bearer PAGE-TOKEN-1');
  assert.match(subs[0].q.subscribed_fields, /messages/);
  const chans = all('SELECT * FROM channels WHERE workspace_id = ? ORDER BY platform', ws);
  assert.deepEqual(chans.map((x) => [x.platform, x.external_id, x.send_id, x.managed, x.connected_by]), [['instagram', '1780001', '3001', 1, '9001'], ['messenger', '3001', null, 1, '9001']]);
  assert.ok(!JSON.stringify(chans).includes('PAGE-TOKEN'), 'tokens encrypted at rest');
  assert.equal((await c.call('GET', `/api/sales/meta/pending/${pick}`)).status, 404, 'pending selection is single use');

  // Platform webhook: verify token from admin settings, events signed with the platform app secret.
  const v = await fetch(`${base}/api/social/webhook?hub.mode=subscribe&hub.verify_token=platform-verify-token-0123456789&hub.challenge=42`);
  assert.equal(await v.text(), '42');
  const raw = JSON.stringify({ object: 'instagram', entry: [{ id: '1780001', messaging: [{ sender: { id: 'igsid-1' }, recipient: { id: '1780001' }, timestamp: Date.now(), message: { mid: 'ig.1', text: 'hi' } }] }] });
  assert.equal((await fetch(`${base}/api/social/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': sign(raw, 'wrong') }, body: raw })).status, 403);
  calls.length = 0;
  assert.equal((await fetch(`${base}/api/social/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': sign(raw) }, body: raw })).status, 200);
  await flushSales();
  const sent = calls.find((x) => x.path.endsWith('/messages'));
  assert.ok(sent, 'auto-pilot reply sent');
  assert.match(sent.path, /\/3001\/messages$/, 'Instagram replies go through the linked Page');
  assert.equal(JSON.parse(sent.body).recipient.id, 'igsid-1');

  // The same Page cannot be taken over by another workspace.
  const p2 = await connect(other.c, 'pages');
  const r2 = (await other.c.call('POST', `/api/sales/meta/pending/${p2.pick}/connect`, { select: ['messenger:3001'] })).body;
  assert.match(r2.results[0].error, /another ChatPilot workspace/);
});

test('Connect WhatsApp: numbers come from the token\'s granular scopes; WABA subscribed', async () => {
  const { c, ws } = await owner('wa@meta.test');
  setSetting('meta_config_id_whatsapp', '777888');
  const { fb, pick } = await connect(c, 'whatsapp');
  assert.equal(fb.searchParams.get('config_id'), '777888', 'Embedded Signup configuration is used');
  assert.equal(fb.searchParams.get('scope'), null);
  const list = (await c.call('GET', `/api/sales/meta/pending/${pick}`)).body;
  assert.deepEqual(list.items.map((i) => [i.id, i.phone]), [['6660001', '+880 1700-000000']]);
  calls.length = 0;
  const done = (await c.call('POST', `/api/sales/meta/pending/${pick}/connect`, { select: ['whatsapp:6660001'] })).body;
  assert.ok(done.results[0].ok);
  assert.ok(calls.some((x) => x.method === 'POST' && x.path.endsWith('/5550001/subscribed_apps')));
  const ch = one('SELECT * FROM channels WHERE workspace_id = ?', ws);
  assert.equal(ch.platform, 'whatsapp'); assert.equal(ch.waba_id, '5550001'); assert.equal(ch.mode, 'draft');
  setSetting('meta_config_id_whatsapp', '');
});

test('connect flow refuses members, forged state and missing configuration', async () => {
  const { c } = await owner('guard@meta.test');
  const bad = await c.call('GET', '/api/oauth/meta/callback?code=x&state=forged');
  assert.match(bad.headers.get('location'), /error=expired/);
  const denied = await c.call('GET', '/api/oauth/meta/callback?error=access_denied&error_reason=user_denied');
  assert.match(denied.headers.get('location'), /error=user_denied/);
  setSetting('meta_app_secret', '');
  assert.match((await c.call('GET', '/api/oauth/meta/connect')).headers.get('location'), /not_configured/);
  setSetting('meta_app_secret', APP_SECRET);
  assert.equal((await client(base).call('GET', '/api/oauth/meta/connect')).status, 401);
});

test('Meta deauthorize and data-deletion callbacks verify signed_request and remove the user\'s data', async () => {
  const { c, ws } = await owner('del@meta.test');
  const { pick } = await connect(c, 'pages');
  await c.call('POST', `/api/sales/meta/pending/${pick}/connect`, { select: ['messenger:3002'] });
  const ch = one('SELECT * FROM channels WHERE workspace_id = ?', ws);
  run(`UPDATE channels SET connected_by = '7007' WHERE id = ?`, ch.id);
  run(`INSERT INTO conversations (workspace_id, channel_id, customer_id) VALUES (?,?, 'psid-del')`, ws, ch.id);
  const form = (sr) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `signed_request=${encodeURIComponent(sr)}` });

  assert.equal((await fetch(`${base}/api/meta/deauthorize`, form(signedRequest({ algorithm: 'HMAC-SHA256', user_id: '7007' }, 'wrong-secret')))).status, 400);
  assert.equal((await fetch(`${base}/api/meta/deauthorize`, form(signedRequest({ algorithm: 'HMAC-SHA256', user_id: '7007' })))).status, 200);
  const off = one('SELECT * FROM channels WHERE id = ?', ch.id);
  assert.equal(off.enabled, 0); assert.equal(off.access_token_enc, '');

  const r = await fetch(`${base}/api/meta/data-deletion`, form(signedRequest({ algorithm: 'HMAC-SHA256', user_id: '7007', issued_at: 1 })));
  const body = await r.json();
  assert.match(body.confirmation_code, /^[a-f0-9]{20}$/);
  assert.equal(one('SELECT COUNT(*) AS n FROM channels WHERE id = ?', ch.id).n, 0);
  assert.equal(one(`SELECT COUNT(*) AS n FROM conversations WHERE customer_id = 'psid-del'`).n, 0, 'conversations deleted with the channel');
  const page = await (await fetch(new URL(new URL(body.url).pathname + new URL(body.url).search, base))).text();
  assert.match(page, /Completed/);
  assert.match(page, new RegExp(body.confirmation_code));
  assert.match(await (await fetch(`${base}/deletion?code=<script>`)).text(), /could not find/);
});
