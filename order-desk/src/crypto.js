// AES-256-GCM for secrets at rest (platform access tokens), HMAC helpers for sessions and webhooks.
import crypto from 'node:crypto';
import { config } from './config.js';

const key = Buffer.from(config.encryptionKey, 'hex');

/** Encrypt a string. `aad` binds the ciphertext to its purpose (e.g. "store:3:token"). */
export function encrypt(plain, aad = '') {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decrypt(payload, aad = '') {
  if (!payload) return null;
  const buf = Buffer.from(payload, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('hex');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const hmacHex = (secret, s) => crypto.createHmac('sha256', secret).update(String(s)).digest('hex');
export const hmacBase64 = (secret, s) => crypto.createHmac('sha256', secret).update(s).digest('base64');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Signed value "payload.signature" for cookies. */
export const sign = (value) => `${value}.${hmacHex(config.sessionSecret, value)}`;
export function unsign(signed) {
  const s = String(signed || '');
  const i = s.lastIndexOf('.');
  if (i < 1) return null;
  const value = s.slice(0, i);
  return safeEqual(s.slice(i + 1), hmacHex(config.sessionSecret, value)) ? value : null;
}
