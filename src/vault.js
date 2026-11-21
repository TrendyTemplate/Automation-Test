// Envelope encryption per workspace. Every workspace has its own random data key (DEK), stored only
// wrapped by the master key. Credentials and email content are encrypted with the DEK + field-bound AAD.
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

/** Decrypt the encrypted columns of message rows in place. */
export function openMessage(m) {
  if (!m) return m;
  if ('text_body' in m) m.text_body = open(m.workspace_id, 'messages.text_body', m.text_body);
  if ('original_body' in m) m.original_body = open(m.workspace_id, 'messages.text_body', m.original_body);
  return m;
}
export function openReply(r) {
  if (!r) return r;
  if ('body' in r) r.body = open(r.workspace_id, 'replies.body', r.body);
  if ('ai_original' in r) r.ai_original = open(r.workspace_id, 'replies.ai_original', r.ai_original);
  if ('original_body' in r) r.original_body = open(r.workspace_id, 'messages.text_body', r.original_body);
  return r;
}

/**
 * One-time / idempotent migration: encrypt legacy plaintext rows and move master-key ciphertexts into
 * workspace keys. Also re-wraps workspace keys and platform secrets after a master key rotation.
 * Returns counts. Safe to run repeatedly.
 */
export function migrateEncryption() {
  const counts = { mailboxes: 0, messages: 0, replies: 0, corrections: 0, rewrapped: 0, settings: 0, totp: 0 };
  db.exec('BEGIN');
  try {
    for (const w of all('SELECT id, dek_enc FROM workspaces WHERE dek_enc IS NOT NULL')) {
      if (needsRewrap(w.dek_enc)) {
        run('UPDATE workspaces SET dek_enc = ? WHERE id = ?', encrypt(decrypt(w.dek_enc, `dek:${w.id}`), `dek:${w.id}`), w.id);
        counts.rewrapped++;
      }
    }
    for (const mb of all('SELECT id, workspace_id, password_enc, oauth_refresh_enc, oauth_access_enc FROM mailboxes')) {
      const upd = {};
      for (const [col, field] of [['password_enc', 'mailboxes.password'], ['oauth_refresh_enc', 'mailboxes.oauth_refresh'], ['oauth_access_enc', 'mailboxes.oauth_access']]) {
        if (mb[col] && !isDekCiphertext(mb[col])) {
          let plain;
          try { plain = decrypt(mb[col]); } catch { plain = null; }
          upd[col] = plain ? seal(mb.workspace_id, field, plain) : (col === 'password_enc' ? '' : null);
        }
      }
      if (Object.keys(upd).length) {
        run(`UPDATE mailboxes SET ${Object.keys(upd).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(upd), mb.id);
        counts.mailboxes++;
      }
    }
    for (const m of all(`SELECT id, workspace_id, text_body FROM messages WHERE text_body IS NOT NULL AND text_body != '' AND text_body NOT LIKE 'e3.%'`)) {
      run('UPDATE messages SET text_body = ? WHERE id = ?', seal(m.workspace_id, 'messages.text_body', m.text_body), m.id);
      counts.messages++;
    }
    for (const r of all(`SELECT id, workspace_id, body, ai_original FROM replies WHERE body NOT LIKE 'e3.%' OR (ai_original IS NOT NULL AND ai_original NOT LIKE 'e3.%')`)) {
      run('UPDATE replies SET body = ?, ai_original = ? WHERE id = ?',
        isDekCiphertext(r.body) ? r.body : seal(r.workspace_id, 'replies.body', r.body),
        r.ai_original == null || isDekCiphertext(r.ai_original) ? r.ai_original : seal(r.workspace_id, 'replies.ai_original', r.ai_original), r.id);
      counts.replies++;
    }
    for (const c of all(`SELECT id, workspace_id, ai_draft, final_text FROM corrections WHERE ai_draft NOT LIKE 'e3.%'`)) {
      run('UPDATE corrections SET ai_draft = ?, final_text = ? WHERE id = ?',
        seal(c.workspace_id, 'corrections.ai_draft', c.ai_draft), seal(c.workspace_id, 'corrections.final_text', c.final_text), c.id);
      counts.corrections++;
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
