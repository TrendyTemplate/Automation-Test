// Keeping a shop's connections alive and its data safe:
//  • every day, check each Page / Instagram / WhatsApp connection still works and still receives webhooks
//    (re-subscribe if Meta dropped it; alert the owner if the access was revoked or expired);
//  • daily database snapshots with rotation; readiness information for /health/ready.
import fs from 'node:fs';
import path from 'node:path';
import { db, one, all, run, logActivity } from '../db.js';
import { open } from '../vault.js';
import { config } from '../config.js';
import { graph, subscribePage, subscribeWaba } from './meta.js';
import { kindOf } from './graph-errors.js';

export async function checkChannel(ch) {
  const token = open(ch.workspace_id, 'channels.access_token', ch.access_token_enc);
  const set = (health, err = null) => run(`UPDATE channels SET health = ?, health_checked_at = datetime('now'), last_error = COALESCE(?, last_error) WHERE id = ?`, health, err, ch.id);
  try {
    if (ch.platform === 'whatsapp') {
      await graph(encodeURIComponent(ch.external_id), { token, params: { fields: 'id,quality_rating' } });
      if (ch.waba_id) {
        const subs = await graph(`${encodeURIComponent(ch.waba_id)}/subscribed_apps`, { token });
        if (!subs.data?.length) { await subscribeWaba(ch.waba_id, token); logActivity(ch.workspace_id, 'channel_resubscribed', { channel: ch.id }); }
      }
    } else {
      const page = ch.send_id || ch.external_id;
      await graph('me', { token, params: { fields: 'id' } });
      if (ch.platform === 'messenger') {
        const subs = await graph(`${encodeURIComponent(page)}/subscribed_apps`, { token });
        if (!subs.data?.length) { await subscribePage(page, token); logActivity(ch.workspace_id, 'channel_resubscribed', { channel: ch.id }); }
      }
    }
    set('ok');
    return 'ok';
  } catch (e) {
    const kind = kindOf(e);
    if (kind === 'token') {
      const was = ch.health;
      set('token', e.message.slice(0, 500));
      if (was !== 'token') {
        const ws = one('SELECT * FROM workspaces WHERE id = ?', ch.workspace_id);
        const { alertWorkspace } = await import('./sales.js');
        await alertWorkspace(ws, `🔌 ${ch.name || ch.platform} is disconnected: Facebook no longer accepts ChatPilot's access (password change, removed admin or expired permission). Reconnect it in Channels.`,
          { title: '🔌 Reconnect your page', body: ch.name || ch.platform, url: '#channels', tag: `token-${ch.id}` });
      }
      return 'token';
    }
    run(`UPDATE channels SET health_checked_at = datetime('now') WHERE id = ?`, ch.id); // network trouble: try again tomorrow
    return 'unknown';
  }
}

/** Worker: check connections not checked in the last day (a few per tick). */
export async function checkConnections(limit = 20) {
  const due = all(`SELECT * FROM channels WHERE enabled = 1 AND (health_checked_at IS NULL OR health_checked_at < datetime('now', '-1 day')) ORDER BY health_checked_at LIMIT ?`, limit);
  for (const ch of due) await checkChannel(ch);
  return due.length;
}

// ---------- backups ----------
export const backupDir = () => process.env.BACKUP_DIR || path.join(path.dirname(path.resolve(config.dbPath)), 'backups');
export function lastBackup() {
  try {
    const files = fs.readdirSync(backupDir()).filter((f) => /^chatpilot-\d{8}-\d{6}\.db$/.test(f)).sort();
    if (!files.length) return null;
    const f = files.at(-1);
    return { file: f, at: fs.statSync(path.join(backupDir(), f)).mtime.toISOString(), count: files.length };
  } catch { return null; }
}
/** Daily snapshot (VACUUM INTO is consistent while the app runs). Keeps the newest BACKUP_KEEP (14). */
export function backupNow({ force = false } = {}) {
  if (config.dbPath === ':memory:' && !process.env.BACKUP_DIR) return null;
  const last = lastBackup();
  if (!force && last && Date.now() - new Date(last.at).getTime() < 23 * 3600_000) return null;
  fs.mkdirSync(backupDir(), { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = path.join(backupDir(), `chatpilot-${stamp}.db`);
  if (fs.existsSync(file)) return null;
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  fs.chmodSync(file, 0o600);
  const keep = Math.max(1, Number(process.env.BACKUP_KEEP || 14));
  const files = fs.readdirSync(backupDir()).filter((f) => /^chatpilot-\d{8}-\d{6}\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(backupDir(), f));
  return file;
}

export function readiness(workerState) {
  const checks = {};
  try { one('SELECT 1 AS x'); checks.database = 'ok'; } catch (e) { checks.database = e.message; }
  const lastTick = workerState?.lastTickAt ? Date.now() - new Date(workerState.lastTickAt).getTime() : null;
  const tickSec = Number(process.env.WORKER_INTERVAL_SEC || 300);
  checks.worker = process.env.DISABLE_WORKER ? 'disabled' : lastTick == null ? (workerState?.startedAt ? 'starting' : 'not running') : lastTick < tickSec * 3000 ? 'ok' : `stalled ${Math.round(lastTick / 1000)}s`;
  const b = lastBackup();
  checks.backup = config.dbPath === ':memory:' && !process.env.BACKUP_DIR ? 'n/a' : !b ? 'none yet' : Date.now() - new Date(b.at).getTime() < 2 * 86400_000 ? 'ok' : `old (${b.at})`;
  checks.failed_webhooks = one(`SELECT COUNT(*) AS n FROM webhook_events WHERE processed_at IS NULL AND attempts >= 4`).n;
  checks.retry_queue = one(`SELECT COUNT(*) AS n FROM chat_messages WHERE status = 'failed' AND retry_at IS NOT NULL`).n;
  checks.disconnected_channels = one(`SELECT COUNT(*) AS n FROM channels WHERE enabled = 1 AND health = 'token'`).n;
  const ok = checks.database === 'ok' && !/stalled|not running/.test(checks.worker);
  return { ok, checks };
}
