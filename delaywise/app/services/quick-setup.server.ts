import db from "../db.server";
import { presetValues, type PresetId } from "../lib/presets";
import { suggestTransitDays } from "../lib/scorecard";
import { parseCarrierTransit } from "../lib/rules";
import type { AdminApi } from "./admin-types";
import { audit } from "./audit.server";
import { getSettings, planFor, refreshShopInfo } from "./settings.server";
import { ScanInProgressError, syncShop, type SyncSummary } from "./sync.server";

export interface QuickSetupResult {
  scanned: boolean;
  summary: SyncSummary | null;
  learnedCarriers: string[];
  mode: "approval" | "autopilot";
}

/**
 * U1: one click from install to working app. Applies the chosen style and
 * sending mode with recommended defaults (daily summary, arrival follow-ups,
 * order-page notice), runs the first scan, and learns real delivery times
 * from the store's own history.
 */
export async function runQuickSetup(args: {
  admin: AdminApi;
  shop: string;
  preset: PresetId;
  autopilot: boolean;
  actor: string;
}): Promise<QuickSetupResult> {
  // The plan decides whether Autopilot is allowed: ask Shopify first.
  const settings = await refreshShopInfo(args.admin, args.shop).catch(() => getSettings(args.shop));
  const plan = planFor(settings);
  const mode = args.autopilot && plan.autopilot ? "autopilot" : "approval";

  await db.shopSettings.update({
    where: { shop: args.shop },
    data: {
      ...presetValues(args.preset),
      preset: args.preset,
      mode,
      merchantDigest: true,
      deliveredFollowUp: true,
      orderStatusNotice: true,
      flowTriggerEnabled: true,
      setupDoneAt: new Date(),
    },
  });

  let summary: SyncSummary | null = null;
  try {
    summary = await syncShop(args.admin, args.shop);
  } catch (error) {
    if (!(error instanceof ScanInProgressError)) console.error(`[setup] ${args.shop}: first scan failed`, error);
  }

  // Learn per-carrier delivery times from deliveries we now know about.
  const rows = await db.shipment.findMany({
    where: { shop: args.shop, status: "DELIVERED" },
    select: { carrier: true, status: true, shippedAt: true, deliveredAt: true },
  });
  const learned = suggestTransitDays(rows);
  if (learned.length) {
    const table = parseCarrierTransit((await getSettings(args.shop)).carrierTransitDays);
    for (const l of learned) table[l.carrier.toLowerCase()] = l.suggestedBusinessDays;
    await db.shopSettings.update({ where: { shop: args.shop }, data: { carrierTransitDays: JSON.stringify(table) } });
  }

  await audit(
    args.shop,
    args.actor,
    "Quick setup completed",
    `${args.preset}, ${mode}${learned.length ? `, learned ${learned.map((l) => l.carrier).join(", ")}` : ""}`,
  );
  return { scanned: summary !== null, summary, learnedCarriers: learned.map((l) => l.carrier), mode };
}
