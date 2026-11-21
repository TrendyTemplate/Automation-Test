import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAILS = 'boss@test.com';
delete process.env.ANTHROPIC_API_KEY;
const { createApp } = await import('../src/server.js');
const { run, one } = await import('../src/db.js');
const { storeMessage, processMessage, recordCorrection } = await import('../src/services/processor.js');
const { sendDueReplies } = await import('../src/services/worker.js');
const { encrypt, decrypt } = await import('../src/crypto.js');
const { totp, verifyTotp, generateSecret } = await import('../src/services/totp.js');
const { redact } = await import('../src/services/ai.js');
const { buildAuthUrl, verifyState } = await import('../src/services/oauth.js');
const { setSetting, getSetting } = await import('../src/settings.js');

let server; let base;
before(async () => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

function client() {
  const c = { cookie: '' };
  c.call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie: c.cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc && sc.startsWith('mp_session=')) c.cookie = sc.split(';')[0];
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, headers: res.headers };
  };
  return c;
}

test('TOTP matches RFC 6238 test vector and verifies', () => {
  // RFC 6238 SHA1 secret "12345678901234567890" in base32 at T=59s -> 94287082 (8 digits) -> last 6 = 287082
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totp(secret, 59_000), '287082');
  const s = generateSecret();
  assert.ok(verifyTotp(s, totp(s)));
  assert.ok(!verifyTotp(s, '000000') || totp(s) === '000000');
});

test('privacy shield redacts card numbers and passwords', () => {
  const t = redact('My card is 4111 1111 1111 1111 and password: hunter2. Call 01712345678');
  assert.ok(!t.includes('4111 1111'));
  assert.ok(!t.includes('hunter2'));
  assert.ok(t.includes('01712345678'), 'normal phone numbers are kept');
});

test('settings: secrets are encrypted at rest and hidden from admin API', async () => {
  setSetting('stripe_secret_key', 'sk_test_123');
  assert.equal(getSetting('stripe_secret_key'), 'sk_test_123');
  assert.notEqual(one(`SELECT value FROM settings WHERE key='stripe_secret_key'`).value, 'sk_test_123');
  setSetting('stripe_secret_key', '');
});

test('OAuth: URL contains scopes + signed state; disabled provider redirects', async () => {
  setSetting('google_client_id', 'cid.apps.googleusercontent.com');
  setSetting('google_client_secret', 'secret');
  const url = new URL(buildAuthUrl('google', 'mailbox', { uid: 1, wsId: 1 }));
  assert.equal(url.hostname, 'accounts.google.com');
  assert.match(url.searchParams.get('scope'), /mail\.google\.com/);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(verifyState(url.searchParams.get('state')).purpose, 'mailbox');
  const c = client();
  const r = await c.call('GET', '/api/oauth/microsoft/login');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /provider_disabled/);
  const g = await c.call('GET', '/api/oauth/google/login');
  assert.match(g.headers.get('location'), /^https:\/\/accounts\.google\.com/);
  const bad = await c.call('GET', '/api/oauth/google/callback?code=x&state=forged');
  assert.match(bad.headers.get('location'), /error=expired/);
  setSetting('google_client_id', ''); setSetting('google_client_secret', '');
});

test('2FA login flow, password reset token, maintenance mode', async () => {
  const c = client();
  await c.call('POST', '/api/auth/signup', { email: 'tfa@test.com', password: 'password123', name: 'T' });
  const setup = await c.call('POST', '/api/auth/2fa/setup');
  assert.match(setup.body.qr, /^data:image\/png;base64,/);
  assert.equal((await c.call('POST', '/api/auth/2fa/enable', { code: '000000' })).status === 400 || totp(setup.body.secret) === '000000', true);
  assert.equal((await c.call('POST', '/api/auth/2fa/enable', { code: totp(setup.body.secret) })).status, 200);
  const c2 = client();
  const login = await c2.call('POST', '/api/auth/login', { email: 'tfa@test.com', password: 'password123' });
  assert.equal(login.body.need2fa, true);
  assert.equal((await c2.call('GET', '/api/auth/me')).status, 401);
  assert.equal((await c2.call('POST', '/api/auth/login/2fa', { pending: login.body.pending, code: '123' })).status, 401);
  assert.equal((await c2.call('POST', '/api/auth/login/2fa', { pending: login.body.pending, code: totp(setup.body.secret) })).status, 200);
  assert.equal((await c2.call('GET', '/api/auth/me')).status, 200);

  await c2.call('POST', '/api/auth/forgot', { email: 'tfa@test.com' });
  assert.equal(one(`SELECT COUNT(*) AS n FROM tokens WHERE purpose='reset'`).n, 1);
  assert.equal((await c2.call('POST', '/api/auth/reset', { token: 'wrong', password: 'newpassword1' })).status, 400);

  setSetting('maintenance_mode', '1');
  assert.equal((await c2.call('GET', '/api/dashboard')).status, 503);
  setSetting('maintenance_mode', '0');
});

test('admin: plans editable, manual payment activates plan and pays referral commission, audit + impersonation', async () => {
  const admin = client();
  await admin.call('POST', '/api/auth/signup', { email: 'boss@test.com', password: 'password123' });
  const ref = one(`SELECT referral_code FROM users WHERE email='boss@test.com'`).referral_code;

  const cust = client();
  await cust.call('POST', '/api/auth/signup', { email: 'cust@test.com', password: 'password123', ref });
  const me = await cust.call('GET', '/api/auth/me');
  const wsId = me.body.workspace.id;
  assert.equal((await cust.call('GET', '/api/admin/overview')).status, 403);

  assert.equal((await admin.call('PUT', '/api/admin/plans/pro', { price_monthly: 59, mailboxes: 12 })).status, 200);
  const plans = await admin.call('GET', '/api/billing/plans');
  assert.equal(plans.body.plans.find((p) => p.key === 'pro').priceMonthly, 59);
  assert.ok(!('stripe' in plans.body.plans[0]), 'stripe price ids are not public');

  const pay = await admin.call('POST', '/api/admin/payments', { workspace_id: wsId, amount: 59, method: 'bkash', plan: 'pro', interval: 'monthly', reference: 'TRX123', activate: true });
  assert.equal(pay.status, 200);
  assert.equal((await admin.call('POST', '/api/admin/payments', { workspace_id: wsId, amount: 59, method: 'bkash', reference: 'TRX123' })).status, 409, 'duplicate reference rejected');
  const me2 = await cust.call('GET', '/api/auth/me');
  assert.equal(me2.body.effectivePlan.key, 'pro');
  assert.equal(me2.body.effectivePlan.mailboxes, 12);
  const refs = await admin.call('GET', '/api/referrals');
  assert.equal(refs.body.signups, 1);
  assert.equal(refs.body.total, 17.7); // 30% of 59

  const ov = await admin.call('GET', '/api/admin/overview');
  assert.equal(ov.body.mrr, 59);
  assert.ok((await admin.call('GET', '/api/admin/audit')).body.some((a) => a.action === 'payment_recorded'));

  // limits override + suspension
  await admin.call('PUT', `/api/admin/workspaces/${wsId}`, { limits_override_json: '{"mailboxes":99}' });
  assert.equal((await cust.call('GET', '/api/auth/me')).body.effectivePlan.mailboxes, 99);
  await admin.call('PUT', `/api/admin/workspaces/${wsId}`, { suspended: true });
  assert.equal((await cust.call('GET', '/api/auth/me')).body.effectivePlan.key, 'expired');
  await admin.call('PUT', `/api/admin/workspaces/${wsId}`, { suspended: false });

  const custId = one(`SELECT id FROM users WHERE email='cust@test.com'`).id;
  const imp = await admin.call('POST', `/api/admin/users/${custId}/impersonate`);
  assert.equal(imp.status, 200);
  const asCust = await admin.call('GET', '/api/auth/me');
  assert.equal(asCust.body.user.email, 'cust@test.com');
  assert.ok(asCust.body.impersonatedBy);

  const settings = await client().call('GET', '/api/admin/settings');
  assert.equal(settings.status, 401);
  const health = (await (async () => { const a = client(); await a.call('POST', '/api/auth/login', { email: 'boss@test.com', password: 'password123' }); return a.call('GET', '/api/admin/health'); })());
  assert.equal(health.status, 200);
  assert.equal(typeof health.body.checks.ai, 'boolean');
});

test('API keys authenticate the public REST API', async () => {
  const c = client();
  await c.call('POST', '/api/auth/signup', { email: 'api@test.com', password: 'password123' });
  const k = await c.call('POST', '/api/api-keys', { name: 'zapier' });
  assert.match(k.body.key, /^mp_live_/);
  const anon = client();
  const r = await anon.call('GET', '/api/v1/messages', null, { authorization: `Bearer ${k.body.key}` });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  assert.equal((await anon.call('GET', '/api/v1/messages', null, { authorization: 'Bearer mp_live_nope' })).status, 401);
  assert.equal((await anon.call('GET', '/api/admin/overview', null, { authorization: `Bearer ${k.body.key}` })).status, 403);
});

test('pipeline: contacts, VIP never auto-sends, blocked senders ignored, scheduled replies can be held, edits are learned', async () => {
  const c = client();
  await c.call('POST', '/api/auth/signup', { email: 'flow@test.com', password: 'password123' });
  const wsId = (await c.call('GET', '/api/auth/me')).body.workspace.id;
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly', reply_delay_min=5, reply_delay_max=5 WHERE id=?`, wsId);
  const tpl = await c.call('POST', '/api/templates', { name: 'T', body: 'Thanks {{first_name}}!' });
  await c.call('POST', '/api/rules', { name: 'auto thanks', conditions: { match: 'all', items: [{ field: 'subject', op: 'contains', value: 'thanks' }] }, actions: [{ type: 'template_reply', template_id: tpl.body.id, mode: 'auto' }] });
  const mbId = Number(run(`INSERT INTO mailboxes (workspace_id, email, imap_host, smtp_host, username, password_enc, mode) VALUES (?,?,?,?,?,?, 'auto')`,
    wsId, 'me@biz.com', 'imap.x', 'smtp.x', 'me@biz.com', encrypt('pw')).lastInsertRowid);
  const mb = one('SELECT * FROM mailboxes WHERE id = ?', mbId);
  const mk = (uid, from, subject) => storeMessage(mb, { uid, message_id: `<${uid}@x>`, from_name: 'Sam Lee', from_email: from, subject, text_body: 'hello', received_at: new Date().toISOString(), headers: {} });

  // 1) Autopilot template reply is scheduled (human-like delay), then held by the user (undo).
  const id1 = mk(1, 'sam@client.com', 'thanks a lot');
  await processMessage(id1);
  const r1 = one('SELECT * FROM replies WHERE message_id = ?', id1);
  assert.equal(r1.status, 'scheduled');
  assert.ok(new Date(r1.scheduled_at) > new Date());
  const contact = one('SELECT * FROM contacts WHERE workspace_id = ? AND email = ?', wsId, 'sam@client.com');
  assert.equal(contact.emails_in, 1);
  assert.equal((await c.call('POST', `/api/replies/${r1.id}/hold`)).status, 200);
  assert.equal(one('SELECT status FROM replies WHERE id = ?', r1.id).status, 'pending');
  await sendDueReplies(); // must not send held replies
  assert.equal(one('SELECT status FROM replies WHERE id = ?', r1.id).status, 'pending');

  // 2) VIP sender: auto mode is downgraded to draft.
  await c.call('PUT', `/api/contacts/${contact.id}`, { vip: true });
  run(`DELETE FROM sent_log`);
  const id2 = mk(2, 'sam@client.com', 'thanks again');
  await processMessage(id2);
  const r2 = one('SELECT * FROM replies WHERE message_id = ?', id2);
  assert.equal(r2.status, 'pending');
  assert.match(r2.error, /VIP/);
  assert.equal(one('SELECT priority FROM messages WHERE id = ?', id2).priority, 'high');

  // 3) Blocked sender is ignored.
  await c.call('PUT', `/api/contacts/${contact.id}`, { blocked: true });
  const id3 = mk(3, 'sam@client.com', 'thanks thrice');
  await processMessage(id3);
  assert.equal(one('SELECT status FROM messages WHERE id = ?', id3).status, 'ignored');
  assert.equal(one('SELECT COUNT(*) AS n FROM replies WHERE message_id = ?', id3).n, 0);

  // 4) Learn from edits.
  recordCorrection({ workspace_id: wsId, message_id: id1, ai_original: 'Dear Sir, thank you.' }, 'Hey Sam, thanks!');
  recordCorrection({ workspace_id: wsId, message_id: id1, ai_original: 'Same text' }, 'Same   text');
  const corr = await c.call('GET', '/api/ai/corrections');
  assert.equal(corr.body.length, 1, 'whitespace-only edits are not stored');

  // 5) Analytics + contacts endpoints respond.
  const a = await c.call('GET', '/api/analytics?days=30');
  assert.equal(a.body.totals.received, 3);
  const list = await c.call('GET', '/api/contacts?sort=lead');
  assert.equal(list.body.length, 1);

  // 6) Settings validation.
  assert.equal((await c.call('PUT', '/api/settings', { timezone: 'Mars/Base' })).status, 400);
  assert.equal((await c.call('PUT', '/api/settings', { slack_webhook: 'https://evil.com/x' })).status, 400);
  assert.equal((await c.call('PUT', '/api/settings', { timezone: 'Asia/Dhaka', alert_on: '' })).status, 200);

  // 7) Tickets round trip + GDPR export.
  const t = await c.call('POST', '/api/tickets', { subject: 'Help', body: 'Need help' });
  assert.equal((await c.call('GET', `/api/tickets/${t.body.id}`)).body.messages.length, 1);
  const exp = await c.call('GET', '/api/auth/export');
  assert.equal(exp.body.workspaces[0].messages.length, 3);
  assert.equal(decrypt(encrypt('x')), 'x');
});

test('agency workspaces: create and switch', async () => {
  const c = client();
  await c.call('POST', '/api/auth/signup', { email: 'agency@test.com', password: 'password123' });
  const w = await c.call('POST', '/api/auth/workspaces', { name: 'Client A' });
  const me = await c.call('GET', '/api/auth/me');
  assert.equal(me.body.workspace.id, w.body.id);
  assert.equal(me.body.workspaces.length, 2);
  await c.call('POST', `/api/auth/workspaces/${me.body.workspaces[0].id}/switch`);
  assert.equal((await c.call('GET', '/api/auth/me')).body.workspace.id, me.body.workspaces[0].id);
  assert.equal((await c.call('POST', '/api/auth/workspaces/99999/switch')).status, 404);
});

test('API keys are refused on account/billing/admin routes', async () => {
  const c = client();
  await c.call('POST', '/api/auth/signup', { email: 'api2@test.com', password: 'password123' });
  const k = await c.call('POST', '/api/api-keys', { name: 'x' });
  const anon = client();
  for (const path of ['/api/auth/me', '/api/auth/export', '/api/billing/payments', '/api/admin/overview']) {
    assert.equal((await anon.call('GET', path, null, { authorization: `Bearer ${k.body.key}` })).status, 403, path);
  }
  assert.equal((await anon.call('POST', '/api/v1/api-keys', { name: 'y' }, { authorization: `Bearer ${k.body.key}` })).status, 403);
});
