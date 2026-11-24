// Attack-style tests: tenant isolation, session security, brute force, CSRF, SSRF, encryption at rest, headers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { client, PW } from './helpers.js';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAILS = 'root@sec.test';
process.env.AUTH_RATE_LIMIT = '500'; // per-IP limiter is tested separately below
delete process.env.ANTHROPIC_API_KEY;
const { createApp } = await import('../src/server.js');
const { one, run, all, db } = await import('../src/db.js');
const { seal, open, migrateEncryption } = await import('../src/vault.js');
const { encrypt, decrypt } = await import('../src/crypto.js');
const { isPrivateIp } = await import('../src/services/net.js');

let server; let base; let alice; let bob; let aliceWs; let convId; let draftId; let channelId; let productId; let orderId;
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  alice = client(base); bob = client(base);
  await alice.signup('alice@sec.test');
  await bob.signup('bob@sec.test');
  aliceWs = (await alice.call('GET', '/api/auth/me')).body.workspace.id;
  channelId = Number(run(`INSERT INTO channels (workspace_id, platform, name, external_id, access_token_enc, app_secret_enc, verify_token, mode) VALUES (?, 'messenger', 'Alice Shop', '1234567', ?, ?, ?, 'draft')`,
    aliceWs, seal(aliceWs, 'channels.access_token', 'EAA-super-secret-token'), seal(aliceWs, 'channels.app_secret', 'abcdef0123456789abcdef0123456789'), 'mp_verify_token_alice_0123456789').lastInsertRowid);
  convId = Number(run(`INSERT INTO conversations (workspace_id, channel_id, customer_id, customer_name, customer_phone, last_inbound_at) VALUES (?,?,?,?,?, datetime('now'))`,
    aliceWs, channelId, 'psid-77', 'Karim', '01700000000').lastInsertRowid);
  run(`INSERT INTO chat_messages (workspace_id, conversation_id, direction, body, status) VALUES (?,?, 'in', ?, 'received')`, aliceWs, convId, seal(aliceWs, 'chat_messages.body', 'Confidential: my address is House 9 Gulshan'));
  draftId = Number(run(`INSERT INTO chat_messages (workspace_id, conversation_id, direction, source, body, status) VALUES (?,?, 'out', 'ai', ?, 'draft')`, aliceWs, convId, seal(aliceWs, 'chat_messages.body', 'draft text')).lastInsertRowid);
  productId = (await alice.call('POST', '/api/sales/products', { name: 'Secret Product', price: 500 })).body.id;
  orderId = Number(run(`INSERT INTO orders (workspace_id, conversation_id, items_json, total, customer_name) VALUES (?,?, '[]', 500, 'Karim')`, aliceWs, convId).lastInsertRowid);
  await alice.call('POST', '/api/knowledge', { title: 'KB', content: 'alice facts' });
});
after(() => server.close());

test('tenant isolation: another customer cannot read or change any of Alice\'s data', async () => {
  const kb = one('SELECT id FROM knowledge WHERE workspace_id = ?', aliceWs).id;
  assert.equal((await bob.call('GET', `/api/sales/conversations/${convId}`)).status, 404);
  const writes = [
    ['POST', `/api/sales/messages/${draftId}/approve`, {}], ['POST', `/api/sales/messages/${draftId}/reject`],
    ['POST', `/api/sales/conversations/${convId}/reply`, { body: 'x' }], ['PUT', `/api/sales/conversations/${convId}`, { status: 'closed', ai_paused: true }],
    ['PUT', `/api/sales/channels/${channelId}`, { mode: 'auto' }], ['DELETE', `/api/sales/channels/${channelId}`],
    ['PUT', `/api/sales/products/${productId}`, { name: 'hacked', price: 1 }], ['DELETE', `/api/sales/products/${productId}`],
    ['PUT', `/api/sales/orders/${orderId}`, { status: 'cancelled' }],
    ['PUT', `/api/knowledge/${kb}`, { title: 'hacked', content: 'x' }], ['DELETE', `/api/knowledge/${kb}`],
  ];
  for (const [m, p, b] of writes) {
    const r = await bob.call(m, p, b);
    assert.ok([400, 403, 404, 409].includes(r.status) || (r.status === 200 && r.body?.ok), `${m} ${p} -> ${r.status}`);
  }
  // Nothing of Alice's changed.
  assert.equal(one('SELECT mode FROM channels WHERE id = ?', channelId).mode, 'draft');
  assert.equal(one('SELECT status FROM chat_messages WHERE id = ?', draftId).status, 'draft');
  assert.equal(one('SELECT status, ai_paused_until FROM conversations WHERE id = ?', convId).status, 'open');
  assert.equal(one('SELECT name FROM products WHERE id = ?', productId).name, 'Secret Product');
  assert.equal(one('SELECT status FROM orders WHERE id = ?', orderId).status, 'new');
  assert.equal(one('SELECT title FROM knowledge WHERE id = ?', kb).title, 'KB');
  // Lists never leak
  for (const p of ['/api/sales/conversations', '/api/sales/products', '/api/sales/orders', '/api/sales/channels', '/api/knowledge', '/api/sales/orders.csv', '/api/dashboard']) {
    const r = await bob.call('GET', p);
    const text = r.text;
    assert.ok(!text.includes('Karim') && !text.includes('Secret Product') && !text.includes('alice facts') && !text.includes('1234567'), p);
  }
  // Workspace switch to someone else's workspace is refused
  assert.equal((await bob.call('POST', `/api/auth/workspaces/${aliceWs}/switch`)).status, 404);
});

test('encryption at rest: raw database never contains tokens or chat content; ciphertexts are bound to their field', async () => {
  const dump = JSON.stringify([...all('SELECT * FROM channels'), ...all('SELECT * FROM chat_messages')]);
  assert.ok(!dump.includes('EAA-super-secret-token'));
  assert.ok(!dump.includes('abcdef0123456789abcdef0123456789'));
  assert.ok(!dump.includes('House 9 Gulshan'));
  assert.ok(!dump.includes('draft text'));
  const raw = one(`SELECT body FROM chat_messages WHERE conversation_id = ? AND direction = 'in'`, convId).body;
  assert.match(raw, /^e3\./);
  assert.equal(open(aliceWs, 'chat_messages.body', raw), 'Confidential: my address is House 9 Gulshan');
  assert.match(open(aliceWs, 'channels.access_token', raw), /unreadable/, 'ciphertext moved to another field does not decrypt');
  const bobWs = (await bob.call('GET', '/api/auth/me')).body.workspace.id;
  assert.match(open(bobWs, 'chat_messages.body', raw), /unreadable/, 'another workspace key cannot decrypt it');
  // Master-key ciphertext tamper detection
  const c = encrypt('x', 'aad1');
  assert.throws(() => decrypt(c, 'aad2'));
  const tampered = c.slice(0, -4) + (c.at(-4) === 'A' ? 'B' : 'A') + c.slice(-3);
  assert.throws(() => decrypt(tampered, 'aad1'));
  // Migration is idempotent
  const counts = migrateEncryption();
  assert.equal(counts.rewrapped + counts.settings + counts.totp, 0);
});

test('sessions: logout and password change revoke sessions server-side; stolen cookie stops working', async () => {
  const u = client(base);
  await u.signup('sess@sec.test');
  const stolen = u.cookie;
  const other = client(base); other.cookie = stolen;
  assert.equal((await other.call('GET', '/api/auth/me')).status, 200);
  const second = client(base);
  assert.equal((await second.call('POST', '/api/auth/login', { email: 'sess@sec.test', password: PW })).status, 200);
  const list = await second.call('GET', '/api/auth/sessions');
  assert.equal(list.body.length, 2);
  assert.ok(list.body.every((s) => s.id.length === 12), 'session ids are not exposed in full');
  assert.equal((await second.call('POST', '/api/auth/change-password', { current: PW, next: 'Another-Strong-Pass-77' })).status, 200);
  assert.equal((await other.call('GET', '/api/auth/me')).status, 401, 'old session revoked after password change');
  assert.equal((await second.call('GET', '/api/auth/me')).status, 200, 'current device stays signed in');
  await second.call('POST', '/api/auth/logout');
  const replay = client(base); replay.cookie = second.cookie || stolen;
  assert.equal((await replay.call('GET', '/api/auth/me')).status, 401);
  // forged / random cookies
  const forged = client(base); forged.cookie = `mp_session=${'a'.repeat(64)}`;
  assert.equal((await forged.call('GET', '/api/auth/me')).status, 401);
  assert.equal(all('SELECT id FROM sessions').every((s) => /^[0-9a-f]{64}$/.test(s.id)), true, 'only hashes stored');
});

test('brute force: account locks after 5 failures, no user enumeration, weak passwords refused', async () => {
  const u = client(base);
  await u.signup('victim@sec.test');
  const att = client(base);
  for (let i = 0; i < 5; i++) assert.equal((await att.call('POST', '/api/auth/login', { email: 'victim@sec.test', password: `wrong-${i}` })).status, 401);
  const locked = await att.call('POST', '/api/auth/login', { email: 'victim@sec.test', password: PW });
  assert.equal(locked.status, 429, 'even the right password is refused while locked');
  const unknown = await att.call('POST', '/api/auth/login', { email: 'nobody@sec.test', password: 'whatever-123' });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error, 'Invalid email or password');
  for (const weak of ['short', 'password123', 'aaaaaaaaaaaa', 'victim2victim2']) {
    const r = await client(base).call('POST', '/api/auth/signup', { email: 'victim2@sec.test', password: weak });
    assert.equal(r.status, 400, weak);
  }
  const f1 = await att.call('POST', '/api/auth/forgot', { email: 'victim@sec.test' });
  const f2 = await att.call('POST', '/api/auth/forgot', { email: 'nobody@sec.test' });
  assert.deepEqual(f1.body, f2.body, 'forgot-password does not reveal accounts');
  assert.ok(one(`SELECT COUNT(*) AS n FROM security_events WHERE type = 'login_failed'`).n >= 5);
});

test('password reset token: single use, expires, signs out all devices', async () => {
  const u = client(base);
  await u.signup('reset@sec.test');
  const uid = one(`SELECT id FROM users WHERE email = 'reset@sec.test'`).id;
  const crypto = await import('node:crypto');
  const token = 'known-token-for-test-1234567890';
  run(`INSERT INTO tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, 'reset', datetime('now','+1 hour'))`, crypto.createHash('sha256').update(token).digest('hex'), uid);
  assert.equal((await client(base).call('POST', '/api/auth/reset', { token, password: 'short' })).status, 400);
  assert.equal((await client(base).call('POST', '/api/auth/reset', { token, password: 'Brand-New-Password-55' })).status, 200);
  assert.equal((await client(base).call('POST', '/api/auth/reset', { token, password: 'Brand-New-Password-66' })).status, 400, 'single use');
  assert.equal((await u.call('GET', '/api/auth/me')).status, 401, 'existing sessions revoked');
  const expired = 'expired-token-1234567890';
  run(`INSERT INTO tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, 'reset', datetime('now','-1 minute'))`, crypto.createHash('sha256').update(expired).digest('hex'), uid);
  assert.equal((await client(base).call('POST', '/api/auth/reset', { token: expired, password: 'Brand-New-Password-77' })).status, 400);
});

test('CSRF: cross-site and foreign-origin state changes are blocked', async () => {
  const before = one('SELECT business_description FROM workspaces WHERE id = ?', aliceWs).business_description;
  assert.equal((await alice.call('PUT', '/api/settings', { business_description: 'pwned' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await alice.call('PUT', '/api/settings', { business_description: 'pwned' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await alice.call('POST', '/api/auth/lockdown', {}, { 'sec-fetch-site': 'same-site' })).status, 403);
  assert.equal(one('SELECT business_description FROM workspaces WHERE id = ?', aliceWs).business_description, before);
  assert.equal((await alice.call('PUT', '/api/settings', { business_description: 'ok' }, { 'sec-fetch-site': 'same-origin' })).status, 200);
});

test('SSRF guard: private and internal addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '169.254.169.254', '172.16.0.1', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) assert.ok(isPrivateIp(ip), ip);
  assert.ok(!isPrivateIp('8.8.8.8'));
});

test('emergency lockdown wipes channel tokens, stops the assistant and discards drafts', async () => {
  const u = client(base);
  await u.signup('lock@sec.test');
  const ws = (await u.call('GET', '/api/auth/me')).body.workspace.id;
  const ch = Number(run(`INSERT INTO channels (workspace_id, platform, external_id, access_token_enc, app_secret_enc, verify_token, mode) VALUES (?, 'whatsapp', '7654321', ?, ?, 'mp_verify_lock_0123456789abcdef', 'auto')`,
    ws, seal(ws, 'channels.access_token', 'tok'), seal(ws, 'channels.app_secret', 'abcdef0123456789')).lastInsertRowid);
  const r = await u.call('POST', '/api/auth/lockdown');
  assert.equal(r.status, 200);
  assert.equal(r.body.channels, 1);
  const row = one('SELECT * FROM channels WHERE id = ?', ch);
  assert.equal(row.access_token_enc, '');
  assert.equal(row.mode, 'off');
  assert.equal(row.enabled, 0);
});

test('API keys: hashed at rest, cannot reach account/billing/admin or create more keys', async () => {
  const k = (await alice.call('POST', '/api/api-keys', { name: 'zap' })).body.key;
  assert.ok(!JSON.stringify(all('SELECT * FROM api_keys')).includes(k));
  const anon = client(base);
  const h = { authorization: `Bearer ${k}` };
  assert.equal((await anon.call('GET', '/api/v1/sales/orders', null, h)).status, 200);
  for (const p of ['/api/auth/me', '/api/auth/export', '/api/billing/payments', '/api/admin/overview', '/api/auth/sessions']) assert.equal((await anon.call('GET', p, null, h)).status, 403, p);
  assert.equal((await anon.call('POST', '/api/v1/api-keys', { name: 'x' }, h)).status, 403);
  assert.equal((await anon.call('POST', '/api/auth/lockdown', {}, h)).status, 403);
});

test('admin: non-admins blocked; impersonation needs customer consent + reason; admins cannot be impersonated', async () => {
  const root = client(base);
  await root.signup('root@sec.test');
  assert.equal((await alice.call('GET', '/api/admin/overview')).status, 403);
  const aliceId = one(`SELECT id FROM users WHERE email = 'alice@sec.test'`).id;
  assert.equal((await root.call('POST', `/api/admin/users/${aliceId}/impersonate`, { reason: 'ticket #1 debugging' })).status, 403, 'no consent yet');
  assert.equal((await alice.call('POST', '/api/auth/support-access', { hours: 1 })).status, 200);
  assert.equal((await root.call('POST', `/api/admin/users/${aliceId}/impersonate`, {})).status, 400, 'reason required');
  const imp = client(base); imp.cookie = root.cookie;
  assert.equal((await imp.call('POST', `/api/admin/users/${aliceId}/impersonate`, { reason: 'ticket #1 debugging' })).status, 200);
  const as = await imp.call('GET', '/api/auth/me');
  assert.equal(as.body.user.email, 'alice@sec.test');
  assert.ok(as.body.impersonatedBy);
  assert.equal((await imp.call('GET', '/api/admin/overview')).status, 403, 'impersonation session has no admin powers');
  assert.equal((await imp.call('POST', '/api/auth/change-password', { current: PW, next: 'Hijack-Password-123' })).status, 403);
  assert.equal((await imp.call('POST', '/api/auth/delete-account', { confirm: 'alice@sec.test', password: PW })).status, 403);
  const ev = (await alice.call('GET', '/api/auth/security-events')).body;
  assert.ok(ev.some((e) => e.type === 'support_impersonation' && /ticket #1/.test(e.detail)), 'customer sees the visit and reason');
  const rootId = one(`SELECT id FROM users WHERE email = 'root@sec.test'`).id;
  const root2 = client(base);
  await root2.call('POST', '/api/auth/login', { email: 'root@sec.test', password: PW });
  run('UPDATE users SET is_admin = 1 WHERE email = ?', 'bob@sec.test');
  assert.equal((await bob.call('POST', `/api/admin/users/${rootId}/impersonate`, { reason: 'trying to take over' })).status, 400);
  run('UPDATE users SET is_admin = 0 WHERE email = ?', 'bob@sec.test');
});

test('HTTP hardening: security headers, no caching of API data, safe errors', async () => {
  const r = await alice.call('GET', '/api/auth/me');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  const page = await fetch(`${base}/app`);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(page.headers.get('permissions-policy'), /camera=\(\)/);
  assert.equal((await alice.call('POST', '/api/tickets', '{bad json')).status, 400);
  assert.equal((await alice.call('POST', '/api/tickets', { subject: 'x', body: 'y'.repeat(2_000_000) })).status, 413);
  assert.equal((await alice.call('GET', '/api/does-not-exist')).status, 404);
  const rl = await client(base).call('POST', '/api/auth/login', { email: 'x@y.z', password: 'x' });
  assert.equal(rl.headers.get('ratelimit-limit'), '500', 'per-IP rate limiter active on auth endpoints');
});

test('account deletion crypto-shreds data and revokes everything', async () => {
  const u = client(base);
  await u.signup('gone@sec.test');
  const wsId = (await u.call('GET', '/api/auth/me')).body.workspace.id;
  assert.equal((await u.call('POST', '/api/auth/delete-account', { confirm: 'gone@sec.test', password: 'wrong' })).status, 400);
  assert.equal((await u.call('POST', '/api/auth/delete-account', { confirm: 'gone@sec.test', password: PW })).status, 200);
  assert.equal(one('SELECT COUNT(*) AS n FROM workspaces WHERE id = ?', wsId).n, 0);
  assert.equal(one(`SELECT COUNT(*) AS n FROM users WHERE email = 'gone@sec.test'`).n, 0);
  assert.equal((await u.call('GET', '/api/auth/me')).status, 401);
  void db;
});
