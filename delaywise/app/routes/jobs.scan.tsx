import type { ActionFunctionArgs } from "react-router";
import { timingSafeEqual } from "node:crypto";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { applyRetention } from "../services/retention.server";
import { runScheduledScans, startBackgroundRun } from "../services/scheduler.server";
import { secureJson } from "../lib/security-headers";
import { allowDaily } from "../lib/rate-limit";

/**
 * Scheduled scan of every installed shop. Call from an external scheduler
 * (Render/Fly cron, GitHub Actions, cron-job.org) every 15–60 minutes:
 *
 *   curl -X POST https://YOUR_APP_URL/jobs/scan -H "Authorization: Bearer $JOB_SECRET"
 *
 * V-7: the work runs in the background and the request returns 202 at once,
 * so scheduler timeouts don't matter. One run at a time; shops are scanned
 * oldest-first until JOB_TIME_BUDGET_MS (default 10 minutes) is used. Add
 * ?wait=1 to wait for the result (debugging).
 */
function authorized(request: Request): boolean {
  const secret = process.env.JOB_SECRET;
  if (!secret || secret.length < 24) return false;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function runJob() {
  const shops = (
    await db.session.findMany({ where: { isOnline: false }, select: { shop: true }, distinct: ["shop"] })
  ).map((s) => s.shop);
  const result = await runScheduledScans({
    shops,
    adminFor: async (shop) => (await unauthenticated.admin(shop)).admin,
    budgetMs: Number(process.env.JOB_TIME_BUDGET_MS) || 10 * 60 * 1000,
    concurrency: Number(process.env.JOB_CONCURRENCY) || 3,
  });
  const retention = await applyRetention();
  const summary = { shops: shops.length, processed: result.results.length, remaining: result.remaining, retention };
  console.log(`[job] ${JSON.stringify(summary)}`);
  return { ...summary, results: result.results };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!authorized(request)) {
    // S3: slow down secret guessing; log the attempt without the secret.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!allowDaily(`job-auth-fail:${ip}`, 20)) return secureJson({ error: "Too many attempts" }, { status: 429 });
    console.warn(`[job] unauthorized call from ${ip}`);
    return secureJson({ error: "Unauthorized" }, { status: 401 });
  }
  if (new URL(request.url).searchParams.get("wait") === "1") {
    return secureJson(await runJob());
  }
  const started = startBackgroundRun(runJob);
  return secureJson({ started, alreadyRunning: !started }, { status: 202 });
};

export const loader = () => new Response("Method Not Allowed", { status: 405 });
