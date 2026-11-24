// Shopify App Bridge session tokens (JWT, HS256, signed with the app's API secret).
// Used when the app runs embedded in Shopify admin, where third-party cookies are not available.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { safeEqual } from '../crypto.js';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** Returns the shop domain (e.g. "acme.myshopify.com") or null when the token is not valid. */
export function verifySessionToken(token, now = Math.floor(Date.now() / 1000)) {
  if (!config.shopify.apiSecret || !config.shopify.apiKey) return null;
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch { return null; }
  if (header.alg !== 'HS256') return null;
  const expected = b64url(crypto.createHmac('sha256', config.shopify.apiSecret).update(`${h}.${p}`).digest());
  if (!safeEqual(expected, sig)) return null;
  const leeway = 10;
  if (typeof payload.exp !== 'number' || payload.exp < now - leeway) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now + leeway) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(config.shopify.apiKey)) return null;
  let dest;
  let iss;
  try { dest = new URL(payload.dest).hostname; iss = new URL(payload.iss).hostname; } catch { return null; }
  if (dest !== iss || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(dest)) return null;
  return dest;
}

/** Test helper: sign a token the way Shopify does. */
export function signSessionToken(shop, { exp = Math.floor(Date.now() / 1000) + 60, aud = config.shopify.apiKey } = {}) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify({ iss: `https://${shop}/admin`, dest: `https://${shop}`, aud, sub: '1', exp, nbf: exp - 120, iat: exp - 60, jti: crypto.randomUUID() }));
  return `${h}.${p}.${b64url(crypto.createHmac('sha256', config.shopify.apiSecret).update(`${h}.${p}`).digest())}`;
}
