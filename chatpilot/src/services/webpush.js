// Web Push (RFC 8030 / 8291 / 8292) with no extra dependency: VAPID-signed, aes128gcm-encrypted notifications
// to the browsers / installed phone apps of a shop's team ("New order", "Customer needs a human").
import crypto from 'node:crypto';
import { one, all, run } from '../db.js';
import { getSetting, setSetting } from '../settings.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

// Only real browser push services: a subscription endpoint can't be used to make the server call anything else.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/,
  /\.notify\.windows\.com$/, /^push\.services\.mozilla\.com$/];
export function allowedEndpoint(url) {
  try {
    const u = new URL(url);
    if (process.env.WEBPUSH_TEST_HOST && u.host === process.env.WEBPUSH_TEST_HOST) return true; // tests only
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

/** The platform's VAPID key pair, created on first use. */
export function vapidKeys() {
  let pub = getSetting('vapid_public'); let priv = getSetting('vapid_private');
  if (!pub || !priv) {
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    pub = b64u(ecdh.getPublicKey()); priv = b64u(ecdh.getPrivateKey());
    setSetting('vapid_public', pub); setSetting('vapid_private', priv);
  }
  return { pub, priv };
}

function vapidHeader(endpoint) {
  const { pub, priv } = vapidKeys();
  const raw = unb64u(pub);
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: priv, x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) }, format: 'jwk' });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: `mailto:${getSetting('support_email') || 'push@chatpilot.invalid'}` }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`;
}

/** RFC 8291 message encryption (aes128gcm content coding). */
export function encrypt(payload, p256dh, authSecret) {
  const uaPub = unb64u(p256dh); const auth = unb64u(authSecret);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header.writeUInt8(65, 20);
  return Buffer.concat([header, asPub, body]);
}

export function subscribe(userId, wsId, sub, userAgent = '') {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || ''); const auth = String(sub?.keys?.auth || '');
  if (!allowedEndpoint(endpoint)) throw Object.assign(new Error('Unsupported push service'), { status: 400 });
  if (unb64u(p256dh).length !== 65 || unb64u(auth).length !== 16) throw Object.assign(new Error('Invalid subscription keys'), { status: 400 });
  run(`INSERT INTO push_subscriptions (user_id, workspace_id, endpoint, p256dh, auth, user_agent) VALUES (?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, workspace_id = excluded.workspace_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  userId, wsId, endpoint.slice(0, 1000), p256dh, auth, String(userAgent).slice(0, 200));
}
export function unsubscribe(userId, endpoint) { run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', userId, String(endpoint || '')); }

async function sendOne(s, payload) {
  const res = await fetch(s.endpoint, {
    method: 'POST',
    headers: { authorization: vapidHeader(s.endpoint), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'high' },
    body: encrypt(JSON.stringify(payload), s.p256dh, s.auth), signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404 || res.status === 410) run('DELETE FROM push_subscriptions WHERE id = ?', s.id); // the browser unsubscribed
  return res.status;
}

/** Notify a shop's team (or one person). Never throws. payload: { title, body, url, tag } — no customer message text. */
export async function pushToWorkspace(wsId, payload, { userId = null } = {}) {
  const subs = all(`SELECT s.* FROM push_subscriptions s JOIN workspace_members m ON m.user_id = s.user_id AND m.workspace_id = s.workspace_id
    WHERE s.workspace_id = ? ${userId ? 'AND s.user_id = ?' : ''}`, ...(userId ? [wsId, userId] : [wsId]));
  const url = payload.url?.startsWith('/') ? payload.url : `/app${payload.url || ''}`;
  const results = await Promise.allSettled(subs.map((s) => sendOne(s, { ...payload, url, icon: '/icon-192.png', badge: '/favicon.svg' })));
  return results.filter((r) => r.status === 'fulfilled' && r.value < 300).length;
}

export const pushPublicKey = () => vapidKeys().pub;
export const pushCount = (userId) => one('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', userId).n;
