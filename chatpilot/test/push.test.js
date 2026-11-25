// Web Push: subscriptions, VAPID signature, RFC 8291 encryption (decrypted here like a browser would), expired subscriptions, PWA files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { client } from './helpers.js';

const got = []; let status = 201;
const pushSvc = http.createServer((req, res) => {
  const chunks = []; req.on('data', (d) => chunks.push(d));
  req.on('end', () => { got.push({ headers: req.headers, body: Buffer.concat(chunks), path: req.url }); res.statusCode = status; res.end(); });
});
await new Promise((r) => pushSvc.listen(0, '127.0.0.1', r));
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_LIMIT = '500';
process.env.WEBPUSH_TEST_HOST = `127.0.0.1:${pushSvc.address().port}`;
const { createApp } = await import('../src/server.js');
const { one } = await import('../src/db.js');
const { pushToWorkspace } = await import('../src/services/webpush.js');

// A "browser": its own key pair and auth secret.
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const sub = (path = '/sub1') => ({ endpoint: `http://${process.env.WEBPUSH_TEST_HOST}${path}`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } });
function decrypt(body) {
  const salt = body.subarray(0, 16); const idlen = body.readUInt8(20); const asPub = body.subarray(21, 21 + idlen); const ct = body.subarray(21 + idlen);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ua.computeSecret(asPub), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain.at(-1), 2, 'last-record padding delimiter');
  return JSON.parse(plain.subarray(0, -1).toString());
}

let server; let base; let c; let ws;
before(async () => {
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  c = client(base); await c.signup('push@shop.test');
  ws = (await c.call('GET', '/api/auth/me')).body.workspace.id;
});
after(() => { server.close(); pushSvc.close(); });

test('subscribe: only real push services and valid keys', async () => {
  const key = (await c.call('GET', '/api/sales/push')).body.key;
  assert.equal(Buffer.from(key, 'base64url').length, 65, 'VAPID public key is an uncompressed P-256 point');
  assert.equal((await c.call('POST', '/api/sales/push', { subscription: { ...sub(), endpoint: 'https://169.254.169.254/latest' } })).status, 400, 'no SSRF through the endpoint');
  assert.equal((await c.call('POST', '/api/sales/push', { subscription: { ...sub(), keys: { p256dh: 'x', auth: 'y' } } })).status, 400);
  const r = await c.call('POST', '/api/sales/push', { subscription: sub() });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.devices, 1);
});

test('a notification is VAPID-signed and encrypted so only the browser can read it', async () => {
  got.length = 0;
  const r = await c.call('POST', '/api/sales/push/test');
  assert.equal(r.body.delivered, 1);
  const h = got[0].headers;
  assert.equal(h['content-encoding'], 'aes128gcm');
  const [, jwt, k] = h.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  const [head, payload, sig] = jwt.split('.');
  const pub = Buffer.from(k, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${head}.${payload}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'valid ES256 signature');
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).aud, `http://${process.env.WEBPUSH_TEST_HOST}`);
  const msg = decrypt(got[0].body);
  assert.equal(msg.title, 'ChatPilot AI');
  assert.equal(msg.url, '/app#dashboard');
});

test('subscriptions the browser dropped (410) are removed', async () => {
  status = 410;
  assert.equal(await pushToWorkspace(ws, { title: 'x', body: 'y', url: '#orders' }), 0);
  assert.equal(one('SELECT COUNT(*) AS n FROM push_subscriptions').n, 0);
  status = 201;
});

test('PWA: manifest, service worker and icons are served', async () => {
  const m = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.sizes === '512x512'));
  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(await sw.text(), /addEventListener\('push'/);
  assert.equal((await fetch(`${base}/icon-192.png`)).headers.get('content-type'), 'image/png');
  assert.match(await (await fetch(`${base}/app`)).text(), /rel="manifest"/);
});
