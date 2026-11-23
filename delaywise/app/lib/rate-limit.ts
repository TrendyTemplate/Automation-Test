/**
 * M6: small per-key daily limiter (in memory; the app runs as one instance).
 * Returns true if the action is allowed and records it.
 */
const buckets = new Map<string, { day: string; count: number }>();

export function allowDaily(key: string, limit: number, now = new Date()): boolean {
  const day = now.toISOString().slice(0, 10);
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
