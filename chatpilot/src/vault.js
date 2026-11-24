// Envelope encryption per workspace. Every workspace has its own random data key (DEK), stored only
// wrapped by the master key. Channel tokens and chat messages are encrypted with the DEK + field-bound AAD.
import { one, all, run, db } from './db.js';
import { encrypt, decrypt, newDataKey, dekEncrypt, dekDecrypt, isDekCiphertext, needsRewrap } from './crypto.js';

const cache = new Map(); // wsId -> Buffer (bounded LRU)
const MAX = 500;

function dek(wsId) {
  if (!wsId) throw new Error('workspace id required for encryption');
  if (cache.has(wsId)) { const k = cache.get(wsId); cache.delete(wsId); cache.set(wsId, k); return k; }
  const row = one('SELECT dek_enc FROM workspaces WHERE id = ?', wsId);
  if (!row) throw new Error('Unknown workspace');
  let key;
  if (row.dek_enc) {
    key = Buffer.from(decrypt(row.dek_enc, `dek:${wsId}`), 'hex');
  } else {
    key = newDataKey();
    // Only set if still empty, so two concurrent first-uses can't create different keys.
    run('UPDATE workspaces SET dek_enc = ? WHERE id = ? AND dek_enc IS NULL', encrypt(key.toString('hex'), `dek:${wsId}`), wsId);
    const again = one('SELECT dek_enc FROM workspaces WHERE id = ?', wsId).dek_enc;
    key = Buffer.from(decrypt(again, `dek:${wsId}`), 'hex');
  }
  cache.set(wsId, key);
  if (cache.size > MAX) cache.delete(cache.keys().next().value);
  return key;
}
export const forgetKey = (wsId) => cache.delete(wsId);

const aad = (wsId, field) => `ws:${wsId}:${field}`;

/** Encrypt a value for a workspace field, e.g. seal(7, 'messages.text_body', body). */
export function seal(wsId, field, plain) {
  if (plain == null || plain === '') return plain ?? null;
  return dekEncrypt(dek(wsId), plain, aad(wsId, field));
}

/** Decrypt; tolerates legacy plaintext and legacy master-key ciphertexts (pre-v3 databases). */
export function open(wsId, field, value) {
  if (value == null || value === '') return value;
  if (isDekCiphertext(value)) {
    try { return dekDecrypt(dek(wsId), value, aad(wsId, field)); } catch { return '[unreadable: encryption key mismatch]'; }
  }
  if (/^(v2\.\d+\.)?[A-Za-z0-9+/]{38,}={0,2}$/.test(value) && /_enc$|password|oauth/.test(field)) {
    try { return decrypt(value); } catch { /* not legacy ciphertext */ }
  }
  return value;
}

/**
 * One-time / idempotent migration: encrypt legacy plaintext rows and move master-key ciphertexts into
 * workspace keys. Also re-wraps workspace keys and platform secrets after a master key rotation.
 * Returns counts. Safe to run repeatedly.
 */
export function migrateEncryption() {
  const counts = { rewrapped: 0, settings: 0, totp: 0 };
  db.exec('BEGIN');
  try {
    for (const w of all('SELECT id, dek_enc FROM workspaces WHERE dek_enc IS NOT NULL')) {
      if (needsRewrap(w.dek_enc)) {
        run('UPDATE workspaces SET dek_enc = ? WHERE id = ?', encrypt(decrypt(w.dek_enc, `dek:${w.id}`), `dek:${w.id}`), w.id);
        counts.rewrapped++;
      }
    }
    for (const s of all(`SELECT key, value FROM settings WHERE value LIKE 'v2.%' OR (length(value) > 40 AND value NOT LIKE '% %')`)) {
      try { const plain = decrypt(s.value); if (needsRewrap(s.value)) { run('UPDATE settings SET value = ? WHERE key = ?', encrypt(plain), s.key); counts.settings++; } } catch { /* plain setting */ }
    }
    for (const u of all('SELECT id, totp_secret_enc FROM users WHERE totp_secret_enc IS NOT NULL')) {
      if (needsRewrap(u.totp_secret_enc)) { run('UPDATE users SET totp_secret_enc = ? WHERE id = ?', encrypt(decrypt(u.totp_secret_enc)), u.id); counts.totp++; }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return counts;
}
