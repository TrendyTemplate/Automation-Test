import type { ActionFunctionArgs } from "react-router";
import { timingSafeEqual } from "node:crypto";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { applyRetention } from "../services/retention.server";
import { runScheduledScans } from "../services/scheduler.server";

/**
 * Hourly scan of every installed shop. Call from an external scheduler
 * (Render/Fly cron, GitHub Actions, cron-job.org):
 *
 *   curl -X POST https://YOUR_APP_URL/jobs/scan -H "Authorization: Bearer $JOB_SECRET"
 *
 * H3: the request stops starting new shops after JOB_TIME_BUDGET_MS (default
 * 50s) so it fits typical scheduler timeouts; unfinished shops go first next
 * time. Calling it more often (e.g. every 15 minutes) is safe: scans of the
 * same shop never overlap.
 */
function authorized(request: Request): boolean {
  const secret = process.env.JOB_SECRET;
  if (!secret || secret.length < 24) return false;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const shops = (
    await db.session.findMany({ where: { isOnline: false }, select: { shop: true }, distinct: ["shop"] })
  ).map((s) => s.shop);

  const { results, remaining } = await runScheduledScans({
    shops,
    adminFor: async (shop) => (await unauthenticated.admin(shop)).admin,
    budgetMs: Number(process.env.JOB_TIME_BUDGET_MS) || 50_000,
    concurrency: Number(process.env.JOB_CONCURRENCY) || 3,
  });
  const retention = await applyRetention();
  return Response.json({ shops: shops.length, processed: results.length, remaining, results, retention });
};

export const loader = () => new Response("Method Not Allowed", { status: 405 });
