import type { ActionFunctionArgs } from "react-router";
import { timingSafeEqual } from "node:crypto";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { syncShop } from "../services/sync.server";
import { applyRetention } from "../services/retention.server";
import { maybeSendDigest } from "../services/digest.server";

/**
 * Hourly scan of every installed shop. Call from an external scheduler
 * (Render/Fly cron, GitHub Actions, cron-job.org):
 *
 *   curl -X POST https://YOUR_APP_URL/jobs/scan -H "Authorization: Bearer $JOB_SECRET"
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

  const shops = await db.session.findMany({
    where: { isOnline: false },
    select: { shop: true },
    distinct: ["shop"],
  });

  const results: { shop: string; ok: boolean; atRisk?: number; messages?: number; error?: string }[] = [];
  for (const { shop } of shops) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const summary = await syncShop(admin, shop);
      await maybeSendDigest(shop).catch((error) => console.error(`[digest] ${shop}`, error));
      results.push({ shop, ok: true, atRisk: summary.atRisk, messages: summary.messagesCreated });
    } catch (error) {
      results.push({ shop, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const retention = await applyRetention();
  return Response.json({ shops: results.length, results, retention });
};

export const loader = () => new Response("Method Not Allowed", { status: 405 });
