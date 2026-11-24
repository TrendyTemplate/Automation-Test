// Small persistent job queue on SQLite. Survives restarts, retries with backoff, one worker per process.
// Enough for thousands of POs a day; swap for a real queue (BullMQ, SQS) when running several app servers.
import { get, run, all } from '../db.js';

const handlers = new Map();
const MAX_ATTEMPTS = 5;

export function registerJob(type, fn) { handlers.set(type, fn); }

export function enqueue(type, { storeId = null, payload = {}, delaySec = 0 } = {}) {
  const { lastInsertRowid } = run(`INSERT INTO jobs (type, store_id, payload, run_at) VALUES (?,?,?, datetime('now', ?))`,
    type, storeId, JSON.stringify(payload), `+${Math.max(0, Math.trunc(delaySec))} seconds`);
  return Number(lastInsertRowid);
}

/** True when a job of this type for this store is already waiting (avoids piling up duplicate polls/syncs). */
export const isQueued = (type, storeId, extra = '') => Boolean(get(
  "SELECT 1 FROM jobs WHERE type = ? AND COALESCE(store_id, 0) = ? AND status IN ('queued','running') AND payload LIKE ? LIMIT 1",
  type, storeId || 0, `%${extra}%`,
));

function claim() {
  return get(`UPDATE jobs SET status = 'running', attempts = attempts + 1
    WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_at <= datetime('now') ORDER BY run_at, id LIMIT 1)
      AND status = 'queued' RETURNING *`);
}

export async function runOne() {
  const job = claim();
  if (!job) return false;
  const fn = handlers.get(job.type);
  try {
    if (!fn) throw new Error(`No handler for job type ${job.type}`);
    await fn(JSON.parse(job.payload), job);
    // Drop the payload once done: inbound emails can be large and contain personal data.
    run("UPDATE jobs SET status = 'done', payload = '{}', error = NULL WHERE id = ?", job.id);
  } catch (e) {
    const permanent = e.permanent || job.attempts >= MAX_ATTEMPTS;
    const backoff = 30 * 2 ** (job.attempts - 1); // 30s, 60s, 2m, 4m …
    run(`UPDATE jobs SET status = ?, error = ?, run_at = datetime('now', ?) ${permanent ? ", payload = '{}'" : ''} WHERE id = ?`,
      permanent ? 'failed' : 'queued', String(e.message).slice(0, 500), `+${backoff} seconds`, job.id);
    if (permanent) console.error(`[jobs] ${job.type} #${job.id} failed:`, e.message);
  }
  return true;
}

/** Run everything that is due now (tests, CLI). */
export async function drainJobs(max = 1000) {
  let n = 0;
  while (n < max && await runOne()) n += 1;
  return n;
}

let timer = null;
let busy = false;
const periodic = [];
/** Run fn every `everySec` seconds from the worker loop (used to schedule mailbox polls). */
export function every(everySec, fn) { periodic.push({ everySec, fn, last: 0 }); }

export function startWorker({ intervalMs = 2000 } = {}) {
  if (timer) return;
  // Jobs left "running" by a crash are retried.
  run("UPDATE jobs SET status = 'queued' WHERE status = 'running'");
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      for (const p of periodic) {
        if (now - p.last >= p.everySec * 1000) { p.last = now; await Promise.resolve(p.fn()).catch((e) => console.error('[jobs] periodic', e.message)); }
      }
      while (await runOne()) { /* keep going while work is due */ }
      run("DELETE FROM jobs WHERE status = 'done' AND created_at < datetime('now', '-7 days')");
    } finally { busy = false; }
  }, intervalMs);
  timer.unref?.();
}

export function stopWorker() { clearInterval(timer); timer = null; }
export const recentFailures = (storeId) => all("SELECT type, error, created_at FROM jobs WHERE store_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 10", storeId);
