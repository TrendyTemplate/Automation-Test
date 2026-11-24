// Read POs straight from a mailbox over IMAP (alternative to a forwarding rule).
// Only new mail is read: on first connect we start at the current end of the folder, never importing history.
import { ImapFlow } from 'imapflow';
import { all, get, run } from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { resolveMailHost } from '../net.js';
import { enqueue, isQueued } from './jobs.js';

const MAX_PER_POLL = 50;
const MAX_MESSAGE_BYTES = 30 * 1024 * 1024;

async function client({ host, port, secure, username }, password) {
  // Connect to the validated public IP while TLS still verifies the real hostname (SSRF / DNS-rebinding safe).
  const { ip, servername } = await resolveMailHost(host, port);
  return new ImapFlow({
    host: ip, port, secure: Boolean(secure), servername,
    tls: { servername, minVersion: 'TLSv1.2' },
    auth: { user: username, pass: password }, logger: false, socketTimeout: 60_000, disableAutoIdle: true,
  });
}

/** Verify credentials and folder before saving. Throws a readable message. */
export async function testMailbox(mb, password) {
  let c;
  try { c = await client(mb, password); } catch (e) { throw Object.assign(new Error(e.message), { status: 400 }); }
  try {
    await c.connect();
    await c.mailboxOpen(mb.folder || 'INBOX', { readOnly: true });
  } catch (e) {
    throw Object.assign(new Error(`Mailbox login failed: ${e.responseText || e.message}`), { status: 400 });
  } finally {
    await c.logout().catch(() => {});
  }
}

export async function addMailbox(storeId, input) {
  const mb = {
    host: String(input.host || '').trim().toLowerCase(),
    port: Number(input.port || 993),
    secure: input.secure === undefined ? Number(input.port || 993) === 993 : Boolean(input.secure),
    username: String(input.username || '').trim(),
    folder: String(input.folder || 'INBOX').trim() || 'INBOX',
  };
  const password = String(input.password || '');
  if (!mb.host || !mb.username || !password) throw Object.assign(new Error('Host, username and password are required'), { status: 400 });
  if (get('SELECT COUNT(*) AS n FROM mailboxes WHERE store_id = ?', storeId).n >= 5) throw Object.assign(new Error('Up to 5 mailboxes per store'), { status: 400 });
  await testMailbox(mb, password);
  const { lastInsertRowid } = run(`INSERT INTO mailboxes (store_id, host, port, secure, username, password_enc, folder) VALUES (?,?,?,?,?,?,?)`,
    storeId, mb.host, mb.port, mb.secure ? 1 : 0, mb.username, 'pending', mb.folder);
  const id = Number(lastInsertRowid);
  run('UPDATE mailboxes SET password_enc = ? WHERE id = ?', encrypt(password, `mailbox:${id}:password`), id);
  await pollMailbox(id); // sets the starting point
  return id;
}

export const listMailboxes = (storeId) => all(
  'SELECT id, host, port, username, folder, enabled, last_polled_at, last_error FROM mailboxes WHERE store_id = ? ORDER BY id', storeId,
);

export function removeMailbox(storeId, id) {
  return run('DELETE FROM mailboxes WHERE id = ? AND store_id = ?', id, storeId).changes > 0;
}

/** Fetch new messages and queue each one for PO extraction. */
export async function pollMailbox(id) {
  const mb = get('SELECT * FROM mailboxes WHERE id = ? AND enabled = 1', id);
  if (!mb) return 0;
  let queued = 0;
  const c = await client(mb, decrypt(mb.password_enc, `mailbox:${mb.id}:password`));
  try {
    await c.connect();
    const box = await c.mailboxOpen(mb.folder, { readOnly: true });
    const validity = String(box.uidValidity);
    if (mb.last_uid == null || mb.uid_validity !== validity) {
      // First poll (or the server reset UIDs): start from now.
      run("UPDATE mailboxes SET last_uid = ?, uid_validity = ?, last_polled_at = datetime('now'), last_error = NULL WHERE id = ?",
        Math.max(0, Number(box.uidNext) - 1), validity, mb.id);
      return 0;
    }
    let last = mb.last_uid;
    if (Number(box.uidNext) - 1 > last) {
      for await (const msg of c.fetch(`${last + 1}:*`, { uid: true, source: true, size: true }, { uid: true })) {
        if (msg.uid <= last) continue; // "n:*" always returns the newest message
        if (queued >= MAX_PER_POLL) break;
        if ((msg.size || msg.source?.length || 0) <= MAX_MESSAGE_BYTES && msg.source) {
          enqueue('ingest_email', { storeId: mb.store_id, payload: { raw: msg.source.toString('base64'), mailbox: mb.id } });
          queued += 1;
        }
        last = Math.max(last, msg.uid);
        run('UPDATE mailboxes SET last_uid = ? WHERE id = ?', last, mb.id);
      }
    }
    run("UPDATE mailboxes SET last_polled_at = datetime('now'), last_error = NULL WHERE id = ?", mb.id);
  } catch (e) {
    run("UPDATE mailboxes SET last_polled_at = datetime('now'), last_error = ? WHERE id = ?", String(e.responseText || e.message).slice(0, 300), mb.id);
    throw e;
  } finally {
    await c.logout().catch(() => {});
  }
  return queued;
}

/** Called periodically by the worker: one poll job per enabled mailbox. */
export function schedulePolls() {
  for (const mb of all('SELECT id, store_id FROM mailboxes WHERE enabled = 1')) {
    if (!isQueued('poll_mailbox', mb.store_id, `"mailboxId":${mb.id}}`)) enqueue('poll_mailbox', { storeId: mb.store_id, payload: { mailboxId: mb.id } });
  }
}
