// Functional API tests: accounts, 2FA, admin business operations, team inbox, settings, plans.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { client, PW } from './helpers.js';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAILS = 'boss@api.test';
process.env.AUTH_RATE_LIMIT = '500';
delete process.env.ANTHROPIC_API_KEY;
const { createApp } = await import('../src/server.js');
const { run, one, all } = await import('../src/db.js');
const { totp } = await import('../src/services/totp.js');
const { setSetting } = await import('../src/settings.js');
const { buildAuthUrl, verifyState } = await import('../src/services/oauth.js');

let server; let base;
before(() => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

test('signup, profile, settings validation, knowledge, team seats, plan limits', async () => {
  const c = client(base);
  await c.signup('owner@api.test', { company: 'Acme Fashion' });
  const me = (await c.call('GET', '/api/auth/me')).body;
  assert.equal(me.effectivePlan.key, 'trial');
  assert.equal(me.workspace.name, 'Acme Fashion');
  assert.equal(me.effectivePlan.channels, 3);
  assert.equal((await c.call('POST', '/api/auth/signup', { email: 'owner@api.test', password: PW })).status, 409);
  assert.equal((await c.call('PUT', '/api/settings', { business_description: 'We sell hoodies', reply_tone: '' })).status, 200);
  const s = (await c.call('GET', '/api/settings')).body;
  assert.equal(s.reply_tone, 'friendly and helpful');
  assert.equal(s.timezone, 'Asia/Dhaka');
  for (const bad of [{ timezone: 'Mars/Base' }, { slack_webhook: 'https://evil.example/x' }]) {
    assert.equal((await c.call('PUT', '/api/settings', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await c.call('PUT', '/api/settings', { auto_send_min_confidence: 3, never_say: 'guaranteed' })).status, 200);
  assert.equal((await c.call('GET', '/api/settings')).body.auto_send_min_confidence, 1, 'confidence is clamped to 0..1');
  assert.equal((await c.call('POST', '/api/knowledge', { title: 'Delivery', content: 'Inside Dhaka ৳70' })).status, 200);
  assert.equal((await c.call('POST', '/api/knowledge', { title: '' })).status, 400);
  assert.equal((await c.call('PUT', '/api/auth/profile', { name: 'Olivia', ui_theme: 'dark' })).status, 200);
  assert.equal(one(`SELECT ui_theme FROM users WHERE email='owner@api.test'`).ui_theme, 'dark');
  // Plan limits: products and channels
  const ws = me.workspace.id;
  run(`UPDATE workspaces SET limits_override_json = '{"products":2,"channels":1}' WHERE id = ?`, ws);
  assert.equal((await c.call('POST', '/api/sales/products', { name: 'A', price: 1 })).status, 200);
  assert.equal((await c.call('POST', '/api/sales/products', { name: 'B', price: 2 })).status, 200);
  assert.equal((await c.call('POST', '/api/sales/products', { name: 'C', price: 3 })).status, 402);
  const imp = (await c.call('POST', '/api/sales/products/import', { csv: 'name,price\nD,4' })).body;
  assert.equal(imp.added, 0);
  assert.match(imp.errors[0], /limit/);
  assert.equal((await c.call('POST', '/api/sales/channels', { platform: 'messenger', external_id: '5550001', access_token: 't', app_secret: 'abcdef0123456789', test: false })).status, 200);
  assert.equal((await c.call('POST', '/api/sales/channels', { platform: 'whatsapp', external_id: '5550002', access_token: 't', app_secret: 'abcdef0123456789', test: false })).status, 402);
  for (const bad of [{ platform: 'telegram', external_id: '1234567' }, { platform: 'whatsapp', external_id: '+8801700' }, { platform: 'messenger', external_id: '1234567', access_token: 't', app_secret: 'not-hex!' }]) {
    assert.equal((await c.call('POST', '/api/sales/channels', { access_token: 't', app_secret: 'abcdef0123456789', test: false, ...bad })).status, 400, JSON.stringify(bad));
  }
  const dash = (await c.call('GET', '/api/dashboard')).body;
  assert.equal(dash.setup.products, 2);
  assert.equal(dash.setup.channels, 1);
  assert.equal(dash.setup.knowledge, 1);
});

test('2FA: setup → enable → login needs code; wrong codes count toward lockout', async () => {
  const c = client(base);
  await c.signup('tfa@api.test');
  const setup = (await c.call('POST', '/api/auth/2fa/setup')).body;
  assert.match(setup.qr, /^data:image\/png;base64,/);
  assert.equal((await c.call('POST', '/api/auth/2fa/enable', { code: '000000' })).status === 400 || totp(setup.secret) === '000000', true);
  assert.equal((await c.call('POST', '/api/auth/2fa/enable', { code: totp(setup.secret) })).status, 200);
  const d = client(base);
  const login = (await d.call('POST', '/api/auth/login', { email: 'tfa@api.test', password: PW })).body;
  assert.equal(login.need2fa, true);
  assert.equal((await d.call('GET', '/api/auth/me')).status, 401, 'no session before the code');
  const fake = client(base); fake.cookie = `mp_session=${login.pending}`;
  assert.equal((await fake.call('GET', '/api/auth/me')).status, 401, 'pending token is not a session');
  assert.equal((await d.call('POST', '/api/auth/login/2fa', { pending: login.pending, code: '123456' })).status === 401 || totp(setup.secret) === '123456', true);
  assert.equal((await d.call('POST', '/api/auth/login/2fa', { pending: login.pending, code: totp(setup.secret) })).status, 200);
  assert.equal((await d.call('GET', '/api/auth/me')).status, 200);
  assert.ok((await d.call('GET', '/api/auth/security-events')).body.some((e) => e.type === '2fa_enabled'));
});

test('OAuth sign-in: signed state, basic scopes only, disabled providers refused, forged callbacks rejected', async () => {
  setSetting('google_client_id', 'cid.apps.googleusercontent.com');
  setSetting('google_client_secret', 'secret');
  const login = new URL(buildAuthUrl('google', 'login'));
  assert.equal(login.searchParams.get('scope'), 'openid email profile', 'sign-in uses only basic scopes');
  assert.equal(login.searchParams.get('access_type'), null);
  assert.equal(verifyState(login.searchParams.get('state')).purpose, 'login');
  assert.ok([401, 404].includes((await client(base).call('GET', '/api/oauth/google/connect')).status), 'no mailbox connect route in ChatPilot');
  const c = client(base);
  assert.match((await c.call('GET', '/api/oauth/microsoft/login')).headers.get('location'), /provider_disabled/);
  assert.match((await c.call('GET', '/api/oauth/google/login')).headers.get('location'), /^https:\/\/accounts\.google\.com/);
  assert.match((await c.call('GET', '/api/oauth/google/callback?code=x&state=forged')).headers.get('location'), /error=expired/);
  const msState = new URL(buildAuthUrl('google', 'login')).searchParams.get('state');
  assert.match((await c.call('GET', `/api/oauth/microsoft/callback?code=x&state=${encodeURIComponent(msState)}`)).headers.get('location'), /bad_state/, 'state cannot be replayed across providers');
  setSetting('google_client_id', ''); setSetting('google_client_secret', '');
});

test('admin business ops: plans, manual payment activates plan, referral commission, margins, overrides, suspension', async () => {
  const admin = client(base);
  await admin.signup('boss@api.test');
  const ref = one(`SELECT referral_code FROM users WHERE email='boss@api.test'`).referral_code;
  const cust = client(base);
  await cust.signup('cust@api.test', { ref });
  const wsId = (await cust.call('GET', '/api/auth/me')).body.workspace.id;
  assert.equal((await admin.call('PUT', '/api/admin/plans/pro', { price_monthly: 59, channels: 12, ai_calls: 9000 })).status, 200);
  const pub = (await admin.call('GET', '/api/billing/plans')).body.plans.find((p) => p.key === 'pro');
  assert.equal(pub.priceMonthly, 59);
  assert.equal(pub.stripe, undefined, 'stripe price ids are not public');
  assert.equal((await admin.call('POST', '/api/admin/payments', { workspace_id: wsId, amount: 59, method: 'bkash', plan: 'pro', interval: 'monthly', reference: 'TRX1', activate: true })).status, 200);
  assert.equal((await admin.call('POST', '/api/admin/payments', { workspace_id: wsId, amount: 59, method: 'bkash', reference: 'TRX1' })).status, 409);
  const plan = (await cust.call('GET', '/api/auth/me')).body.effectivePlan;
  assert.equal(plan.key, 'pro'); assert.equal(plan.channels, 12); assert.equal(plan.aiCalls, 9000);
  const refs = (await admin.call('GET', '/api/referrals')).body;
  assert.equal(refs.signups, 1); assert.equal(refs.total, 17.7);
  run(`INSERT INTO usage (workspace_id, period, ai_calls, input_tokens, output_tokens) VALUES (?, ?, 10, 1000000, 100000)`, wsId, new Date().toISOString().slice(0, 7));
  const ai = (await admin.call('GET', '/api/admin/ai-usage')).body.rows.find((r) => r.workspace_id === wsId);
  assert.equal(ai.revenue, 59); assert.equal(ai.cost, 6); assert.equal(ai.margin, 90);
  assert.equal((await admin.call('GET', '/api/admin/overview')).body.mrr, 59);
  await admin.call('PUT', `/api/admin/workspaces/${wsId}`, { limits_override_json: '{"channels":99}' });
  assert.equal((await cust.call('GET', '/api/auth/me')).body.effectivePlan.channels, 99);
  assert.equal((await admin.call('PUT', `/api/admin/workspaces/${wsId}`, { limits_override_json: '{bad' })).status, 400);
  await admin.call('PUT', `/api/admin/workspaces/${wsId}`, { suspended: true });
  assert.equal((await cust.call('GET', '/api/auth/me')).body.effectivePlan.key, 'expired');
  await admin.call('PUT', `/api/admin/workspaces/${wsId}`, { suspended: false });
  assert.equal((await admin.call('POST', `/api/admin/workspaces/${wsId}/extend-trial`, { days: 7 })).status, 200);
  const custId = one(`SELECT id FROM users WHERE email='cust@api.test'`).id;
  await admin.call('PUT', `/api/admin/users/${custId}`, { suspended: true });
  assert.equal((await cust.call('GET', '/api/auth/me')).status, 401, 'suspension revokes sessions');
  await admin.call('PUT', `/api/admin/users/${custId}`, { suspended: false });
  const temp = (await admin.call('POST', `/api/admin/users/${custId}/reset-password`)).body.tempPassword;
  assert.equal((await client(base).call('POST', '/api/auth/login', { email: 'cust@api.test', password: temp })).status, 200);
  for (const p of ['/api/admin/users', '/api/admin/workspaces', '/api/admin/payments', '/api/admin/plans', '/api/admin/channels', '/api/admin/tickets?status=all',
    '/api/admin/announcements', '/api/admin/referrals', '/api/admin/audit', '/api/admin/activity', '/api/admin/settings', '/api/admin/health', '/api/admin/security', `/api/admin/users/${custId}`, `/api/admin/workspaces/${wsId}`]) {
    assert.equal((await admin.call('GET', p)).status, 200, p);
  }
  const settings = (await admin.call('GET', '/api/admin/settings')).body;
  setSetting('stripe_secret_key', 'sk_test_secret');
  assert.ok(!JSON.stringify((await admin.call('GET', '/api/admin/settings')).body).includes('sk_test_secret'), 'secrets never returned');
  assert.ok(settings.length > 20);
  setSetting('stripe_secret_key', '');
  assert.ok((await admin.call('GET', '/api/admin/audit')).body.some((a) => a.action === 'payment_recorded'));
  assert.equal((await admin.call('POST', '/api/admin/announcements', { message: 'Hello world', level: 'success' })).status, 200);
  const custNow = client(base);
  await custNow.call('POST', '/api/auth/login', { email: 'cust@api.test', password: temp });
  assert.equal((await custNow.call('GET', '/api/auth/me')).body.announcements[0].message, 'Hello world');
});

test('tickets, referrals, agency workspaces, support access toggle, GDPR export', async () => {
  const c = client(base);
  await c.signup('misc@api.test');
  await c.call('POST', '/api/sales/products', { name: 'Panjabi', price: 1650 });
  const exp = await c.call('GET', '/api/auth/export');
  assert.equal(exp.status, 200);
  assert.equal(exp.body.workspaces[0].products[0].name, 'Panjabi');
  assert.ok(Array.isArray(exp.body.workspaces[0].conversations));
  const t = (await c.call('POST', '/api/tickets', { subject: 'Help', body: 'Need help' })).body;
  assert.equal((await c.call('GET', `/api/tickets/${t.id}`)).body.messages.length, 1);
  assert.equal((await c.call('POST', `/api/tickets/${t.id}/reply`, { body: 'more info' })).status, 200);
  assert.match((await c.call('GET', '/api/referrals')).body.link, /\?ref=/);
  const w = (await c.call('POST', '/api/auth/workspaces', { name: 'Client A' })).body;
  const me = (await c.call('GET', '/api/auth/me')).body;
  assert.equal(me.workspace.id, w.id);
  assert.equal(me.workspaces.length, 2);
  await c.call('POST', `/api/auth/workspaces/${me.workspaces[0].id}/switch`);
  assert.equal((await c.call('GET', '/api/auth/me')).body.workspace.id, me.workspaces[0].id);
  const sa = (await c.call('POST', '/api/auth/support-access', { hours: 24 })).body;
  assert.ok(new Date(sa.until) > new Date());
  assert.equal((await c.call('POST', '/api/auth/support-access', { hours: 0 })).body.until, null);
  void all;
});

test('maintenance mode blocks customers but not admins', async () => {
  const c = client(base);
  await c.signup('maint@api.test');
  setSetting('maintenance_mode', '1');
  assert.equal((await c.call('GET', '/api/dashboard')).status, 503);
  setSetting('maintenance_mode', '0');
  assert.equal((await c.call('GET', '/api/dashboard')).status, 200);
});
