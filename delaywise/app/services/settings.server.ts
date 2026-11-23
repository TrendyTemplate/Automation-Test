import type { ShopSettings } from "@prisma/client";
import db from "../db.server";
import { getPlan, monthKey, planFromBillingName, type Plan } from "../lib/plans";
import { gql, type AdminApi } from "./admin-types";
import { SHOP_INFO_QUERY } from "./shopify-queries.server";

export async function getSettings(shop: string): Promise<ShopSettings> {
  return db.shopSettings.upsert({ where: { shop }, update: {}, create: { shop } });
}

export function planFor(settings: Pick<ShopSettings, "plan">): Plan {
  return getPlan(settings.plan);
}

interface ShopInfo {
  shop: {
    name: string;
    contactEmail: string;
    myshopifyDomain: string;
    ianaTimezone: string;
    billingAddress: { countryCodeV2: string | null };
  };
  currentAppInstallation: {
    activeSubscriptions: { name: string; status: string; test: boolean }[];
  };
}

/**
 * Pulls the store name, country, contact email and the active plan from
 * Shopify. Plans are managed by Shopify App Pricing (Partner Dashboard),
 * so the active subscription name is the source of truth for the plan.
 */
export async function refreshShopInfo(admin: AdminApi, shop: string): Promise<ShopSettings> {
  const current = await getSettings(shop);
  const data = await gql<ShopInfo>(admin, SHOP_INFO_QUERY);
  const active = data.currentAppInstallation.activeSubscriptions.find(
    (s) => s.status === "ACTIVE",
  );
  const plan = planFromBillingName(active?.name);
  if (active && plan.id === "free" && active.name !== "Free") {
    // M10: a paid subscription whose name doesn't match a plan means the
    // Partner Dashboard plan names drifted. Don't silently downgrade quietly.
    console.error(`[plans] ${shop}: unknown subscription name "${active.name}"; treating as Free`);
  }
  // L1: contact emails are seeded once (first scan); after that, an empty
  // field means the merchant cleared it on purpose.
  const firstRun = current.lastScanAt === null;
  await db.shopSettings.update({
    where: { shop },
    data: {
      shopName: data.shop.name,
      shopCountry: data.shop.billingAddress.countryCodeV2 ?? current.shopCountry,
      ...(firstRun
        ? {
            replyToEmail: current.replyToEmail ?? data.shop.contactEmail,
            digestEmail: current.digestEmail ?? data.shop.contactEmail,
          }
        : {}),
      timezone: data.shop.ianaTimezone || current.timezone,
    },
  });
  return applyPlan(shop, plan.id);
}

/**
 * Sets the shop's plan and switches off paid-only features it doesn't
 * include (M10). Used by the scan and by the app_subscriptions/update webhook.
 */
export async function applyPlan(shop: string, planId: string): Promise<ShopSettings> {
  const plan = getPlan(planId);
  const updated = await db.shopSettings.update({
    where: { shop },
    data: {
      plan: plan.id,
      ...(plan.autopilot ? {} : { mode: "approval" }),
      ...(plan.compensation ? {} : { compensationEnabled: false }),
    },
  });
  if (!plan.autopilot) {
    await db.message.updateMany({
      where: { shop, status: "scheduled" },
      data: { status: "pending_approval", scheduledFor: null },
    });
  }
  return updated;
}

export async function getUsage(shop: string, now = new Date()) {
  const month = monthKey(now);
  return db.usageMonth.upsert({
    where: { shop_month: { shop, month } },
    update: {},
    create: { shop, month },
  });
}

/** Removes everything we hold for a shop (shop/redact). */
export async function deleteShopData(shop: string): Promise<void> {
  await db.$transaction([
    db.message.deleteMany({ where: { shop } }),
    db.shipment.deleteMany({ where: { shop } }),
    db.usageMonth.deleteMany({ where: { shop } }),
    db.redactedOrder.deleteMany({ where: { shop } }),
    db.shopSettings.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);
}
