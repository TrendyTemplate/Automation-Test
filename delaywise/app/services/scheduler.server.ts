import db from "../db.server";
import type { AdminApi } from "./admin-types";
import { maybeSendDigest } from "./digest.server";
import { ScanInProgressError, syncShop } from "./sync.server";

/**
 * H3: the hourly job works through shops oldest-scan-first, a few at a time,
 * and stops starting new shops when its time budget runs out. Shops it didn't
 * reach are first in line next run. Shops already being scanned are skipped.
 */
export interface JobResult {
  shop: string;
  status: "ok" | "skipped" | "error";
  atRisk?: number;
  messages?: number;
  error?: string;
}

export async function runScheduledScans(args: {
  shops: string[];
  adminFor: (shop: string) => Promise<AdminApi>;
  budgetMs: number;
  concurrency: number;
  now?: () => number;
}): Promise<{ results: JobResult[]; remaining: number }> {
  const clock = args.now ?? Date.now;
  const deadline = clock() + args.budgetMs;
  const scans = await db.shopSettings.findMany({
    where: { shop: { in: args.shops } },
    select: { shop: true, lastScanAt: true },
  });
  const last = new Map(scans.map((s) => [s.shop, s.lastScanAt?.getTime() ?? 0]));
  const queue = [...args.shops].sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0));
  const results: JobResult[] = [];

  const worker = async () => {
    while (queue.length && clock() < deadline) {
      const shop = queue.shift()!;
      try {
        const admin = await args.adminFor(shop);
        const summary = await syncShop(admin, shop, new Date(), { deadline });
        await maybeSendDigest(shop).catch((error) => console.error(`[digest] ${shop}`, error));
        results.push({ shop, status: "ok", atRisk: summary.atRisk, messages: summary.messagesCreated });
      } catch (error) {
        if (error instanceof ScanInProgressError) {
          results.push({ shop, status: "skipped", error: error.message });
        } else {
          results.push({ shop, status: "error", error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, worker));
  return { results, remaining: queue.length };
}

/** One background run at a time per server process. */
let running: Promise<unknown> | null = null;

export function jobIsRunning(): boolean {
  return running !== null;
}

/**
 * V-7: starts the scheduled work in the background and returns immediately,
 * so the scheduler's HTTP request never times out. Returns false if a run is
 * already in progress.
 */
export function startBackgroundRun(work: () => Promise<unknown>): boolean {
  if (running) return false;
  running = work()
    .catch((error) => console.error("[job] background run failed", error))
    .finally(() => {
      running = null;
    });
  return true;
}
