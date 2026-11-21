import { all, one, run, logActivity } from '../db.js';
import { config } from '../config.js';
import { effectivePlan } from '../plans.js';
import { fetchNewMessages } from './mail.js';
import { storeMessage, processMessage } from './processor.js';

const busy = new Set();

export async function syncMailbox(mailboxId) {
  if (busy.has(mailboxId)) return { skipped: true };
  busy.add(mailboxId);
  try {
    const mb = one('SELECT * FROM mailboxes WHERE id = ?', mailboxId);
    if (!mb || !mb.enabled) return { skipped: true };
    const ws = one('SELECT * FROM workspaces WHERE id = ?', mb.workspace_id);
    if (effectivePlan(ws).key === 'expired') return { skipped: true, reason: 'subscription inactive' };

    const { messages, lastUid, uidValidity } = await fetchNewMessages(mb);
    const ids = [];
    for (const m of messages) {
      const id = storeMessage(mb, m);
      if (id) ids.push(id);
    }
    run(`UPDATE mailboxes SET last_uid=?, uid_validity=?, last_sync_at=datetime('now'), last_error=NULL WHERE id=?`,
      lastUid, uidValidity ?? mb.uid_validity, mb.id);
    for (const id of ids) await processMessage(id);
    return { fetched: messages.length, stored: ids.length };
  } catch (e) {
    run(`UPDATE mailboxes SET last_error=?, last_sync_at=datetime('now') WHERE id=?`, e.message, mailboxId);
    const mb = one('SELECT workspace_id FROM mailboxes WHERE id = ?', mailboxId);
    if (mb) logActivity(mb.workspace_id, 'sync_error', { mailbox: mailboxId, error: e.message });
    return { error: e.message };
  } finally {
    busy.delete(mailboxId);
  }
}

async function tick() {
  const boxes = all('SELECT id FROM mailboxes WHERE enabled = 1');
  // Small concurrency pool so one slow IMAP server doesn't stall everyone.
  const queue = [...boxes];
  const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
    while (queue.length) await syncMailbox(queue.shift().id);
  });
  await Promise.all(workers);
}

export function startWorker() {
  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    try { await tick(); } catch (e) { console.error('[worker]', e); } finally { running = false; }
  };
  setTimeout(loop, 5_000);
  const timer = setInterval(loop, config.syncIntervalSec * 1000);
  console.log(`[worker] syncing every ${config.syncIntervalSec}s`);
  return () => clearInterval(timer);
}
