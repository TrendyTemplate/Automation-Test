// Background jobs: follow-ups for quiet buyers, lifecycle emails and data retention.
import { all, run } from '../db.js';
import { salesFollowUps } from './sales.js';
import { checkLifecycle } from './lifecycle.js';

export const workerState = { startedAt: null, lastTickAt: null, lastTickMs: 0, ticks: 0, lastError: null };
const TICK_SEC = Number(process.env.WORKER_INTERVAL_SEC || 300);

/** Delete chat messages older than each workspace's retention setting (0 = keep forever). */
export function purgeOldData() {
  for (const ws of all('SELECT id, retention_days FROM workspaces WHERE retention_days > 0')) {
    run(`DELETE FROM chat_messages WHERE workspace_id = ? AND created_at < datetime('now', ?)`, ws.id, `-${ws.retention_days} days`);
  }
  run(`DELETE FROM activity WHERE created_at < datetime('now', '-180 days')`);
  run(`DELETE FROM tokens WHERE expires_at < datetime('now')`);
}

async function tick() {
  const t0 = Date.now();
  await salesFollowUps().catch((e) => console.error('[sales-followups]', e.message));
  await checkLifecycle().catch((e) => console.error('[lifecycle]', e.message));
  if (workerState.ticks % 12 === 0) purgeOldData();
  workerState.ticks++;
  workerState.lastTickAt = new Date().toISOString();
  workerState.lastTickMs = Date.now() - t0;
}

export function startWorker() {
  let running = false;
  workerState.startedAt = new Date().toISOString();
  const loop = async () => {
    if (running) return;
    running = true;
    try { await tick(); workerState.lastError = null; } catch (e) { workerState.lastError = e.message; console.error('[worker]', e); } finally { running = false; }
  };
  setTimeout(loop, 5_000);
  const timer = setInterval(loop, TICK_SEC * 1000);
  console.log(`[worker] running every ${TICK_SEC}s`);
  return () => clearInterval(timer);
}
