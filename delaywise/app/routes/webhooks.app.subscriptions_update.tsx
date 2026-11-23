import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { planFromBillingName } from "../lib/plans";
import { applyPlan } from "../services/settings.server";

/**
 * V-6: plan changes (upgrade, downgrade, cancel, frozen) take effect right
 * away instead of at the next scan. HMAC is verified by authenticate.webhook.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const sub = (payload as { app_subscription?: { name?: string; status?: string } }).app_subscription;
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!sub || !settings) return new Response();

  const status = String(sub.status ?? "").toUpperCase();
  const plan = planFromBillingName(sub.name);
  if (status === "ACTIVE") {
    await applyPlan(shop, plan.id);
  } else if (["CANCELLED", "DECLINED", "EXPIRED", "FROZEN"].includes(status) && settings.plan === plan.id) {
    // The subscription the shop was on has ended.
    await applyPlan(shop, "free");
  }
  return new Response();
};
