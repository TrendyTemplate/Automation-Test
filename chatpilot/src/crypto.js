// Cryptography primitives.
//
// Layout (defense in depth, see docs/SECURITY.md):
//   master key ring (env)  ──wraps──▶  per-workspace data keys (DEK, random 256-bit)  ──encrypt──▶  credentials + email content
// * AES-256-GCM everywhere, random 96-bit IV, authenticated with "additional data" (AAD) that binds each ciphertext
//   to its purpose (e.g. "ws:12:mailboxes.password"), so a ciphertext copied into another row/column fails to decrypt.
// * Master keys are versioned ("v2.<version>.<payload>") so they can be rotated without downtime.
// * Deleting a workspace deletes its wrapped DEK → everything it encrypted becomes unreadable ("crypto-shredding").
import crypto from 'node:crypto';
import { config } from './config.js';

const ring = new Map(); // version -> Buffer
ring.set(config.encryptionKeyVersion, Buffer.from(config.encryptionKey, 'hex'));
for (const [v, hex] of config.oldEncryptionKeys) if (!ring.has(v)) ring.set(v, Buffer.from(hex, 'hex'));
const currentVersion = config.encryptionKeyVersion;

function gcmEncrypt(key, plain, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

function gcmDecrypt(key, payload, aad) {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < 28) throw new Error('Ciphertext too short');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

/** Encrypt with the current master key. Output: v2.<keyVersion>.<base64(iv|tag|ct)> */
export function encrypt(plain, aad = '') {
  if (plain == null) return null;
  return `v2.${currentVersion}.${gcmEncrypt(ring.get(currentVersion), plain, aad)}`;
}

/** Decrypt a master-key ciphertext (current or any old version; also legacy v1 format without prefix). */
export function decrypt(payload, aad = '') {
  if (!payload) return null;
  const m = /^v2\.(\d+)\.(.+)$/s.exec(payload);
  if (m) {
    const key = ring.get(Number(m[1]));
    if (!key) throw new Error(`Encryption key version ${m[1]} is not configured`);
    return gcmDecrypt(key, m[2], aad);
  }
  return gcmDecrypt(ring.get(currentVersion), payload); // legacy (v1, no AAD)
}

export const needsRewrap = (payload) => Boolean(payload) && !String(payload).startsWith(`v2.${currentVersion}.`);
export const keyVersion = () => currentVersion;

// ---- Data keys (per workspace) ----
export const newDataKey = () => crypto.randomBytes(32);
export const dekEncrypt = (dek, plain, aad) => `e3.${gcmEncrypt(dek, plain, aad)}`;
export const dekDecrypt = (dek, payload, aad) => gcmDecrypt(dek, payload.slice(3), aad);
export const isDekCiphertext = (s) => typeof s === 'string' && s.startsWith('e3.');

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('hex');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const hmac = (key, s) => crypto.createHmac('sha256', key).update(String(s)).digest('hex');
export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
