import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { audit, firstDelivery } from "../services/audit.server";
import { planFromBillingName } from "../lib/plans";
import { applyPlan } from "../services/settings.server";

/**
 * V-6: plan changes (upgrade, downgrade, cancel, frozen) take effect right
 * away instead of at the next scan. HMAC is verified by authenticate.webhook.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, webhookId, topic } = await authenticate.webhook(request);
  if (!(await firstDelivery(webhookId, shop, topic))) return new Response(); // S4
  const sub = (payload as { app_subscription?: { name?: string; status?: string } }).app_subscription;
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!sub || !settings) return new Response();

  const status = String(sub.status ?? "").toUpperCase();
  const plan = planFromBillingName(sub.name);
  if (status === "ACTIVE") {
    await applyPlan(shop, plan.id);
    await audit(shop, "Shopify", "Plan changed", plan.label);
  } else if (["CANCELLED", "DECLINED", "EXPIRED", "FROZEN"].includes(status) && settings.plan === plan.id) {
    // The subscription the shop was on has ended.
    await applyPlan(shop, "free");
    await audit(shop, "Shopify", "Plan ended", `${plan.label} → Free`);
  }
  return new Response();
};
