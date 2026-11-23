/**
 * M6: small per-key daily limiter (in memory; the app runs as one instance).
 * Returns true if the action is allowed and records it.
 */
const buckets = new Map<string, { day: string; count: number }>();
const MAX_BUCKETS = 50_000;
let lastPrunedDay = "";

/** Drops yesterday's counters, and never lets the map grow without bound. */
function prune(day: string) {
  if (day !== lastPrunedDay) {
    for (const [k, b] of buckets) if (b.day !== day) buckets.delete(k);
    lastPrunedDay = day;
  }
  if (buckets.size >= MAX_BUCKETS) {
    // Oldest entries first (Map keeps insertion order).
    const drop = Math.ceil(MAX_BUCKETS / 10);
    let i = 0;
    for (const k of buckets.keys()) {
      if (i++ >= drop) break;
      buckets.delete(k);
    }
  }
}

/** Current count without recording anything. */
export function dailyCount(key: string, now = new Date()): number {
  const bucket = buckets.get(key);
  return bucket && bucket.day === now.toISOString().slice(0, 10) ? bucket.count : 0;
}

export function bucketCountForTests(): number {
  return buckets.size;
}

export function allowDaily(key: string, limit: number, now = new Date()): boolean {
  const day = now.toISOString().slice(0, 10);
  prune(day);
  const bucket = buckets.get(key);
  if (!bucket || bucket.day !== day) {
    buckets.set(key, { day, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

export const PREVIEW_DAILY_LIMIT = 40;
export const TEST_EMAIL_DAILY_LIMIT = 5;
