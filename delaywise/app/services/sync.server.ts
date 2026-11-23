import db from "../db.server";
import { assessRisk, estimateExpectedBy, isAtRisk, riskRank, shouldNotify } from "../lib/risk";
import { exclusionReason, parseCarrierTransit, transitDaysFor } from "../lib/rules";
import { fromShopify, type ShipmentStatus } from "../lib/status";
import { gql, type AdminApi } from "./admin-types";
import { fireShipmentAtRisk } from "./flow.server";
import { createNotification, sendDueScheduled } from "./notifier.server";
import { trackRedemptions } from "./roi.server";
import { getSettings, getUsage, planFor, refreshShopInfo } from "./settings.server";
import { fetchResults, registerAndTrack, ship24Enabled } from "./ship24.server";
import { SHIPPED_ORDERS_QUERY } from "./shopify-queries.server";

/** Orders older than this are not watched. */
export const WINDOW_DAYS = 45;
const MAX_PAGES = 10;
/** Wait this long after shipping before paying for external tracking. */
const EXTERNAL_LOOKUP_AFTER_HOURS = 24;
const HOUR = 3_600_000;

interface OrderNode {
  id: string;
  legacyResourceId: string;
  name: string;
  tags: string[];
  cancelledAt: string | null;
  customerLocale: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  shippingAddress: { countryCodeV2: string | null } | null;
  fulfillments: {
    id: string;
    createdAt: string;
    inTransitAt: string | null;
    deliveredAt: string | null;
    estimatedDeliveryAt: string | null;
    displayStatus: string | null;
    trackingInfo: { company: string | null; number: string | null; url: string | null }[];
    events: { nodes: { status: string; happenedAt: string }[] };
  }[];
}

interface OrdersPage {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: OrderNode[];
  };
}

export interface SyncSummary {
  shipmentsSeen: number;
  newShipments: number;
  externalLookups: number;
  atRisk: number;
  messagesCreated: number;
  followUps: number;
  flowTriggers: number;
  scheduledSent: number;
  discountsRedeemed: number;
  limitReached: boolean;
}

/** F2: follow up only on recent deliveries. */
const FOLLOW_UP_WITHIN_DAYS = 3;

const toDate = (v: string | null | undefined) => (v ? new Date(v) : null);

export async function syncShop(admin: AdminApi, shop: string, now = new Date()): Promise<SyncSummary> {
  try {
    const summary = await runSync(admin, shop, now);
    await db.shopSettings.update({ where: { shop }, data: { lastScanAt: now, lastScanError: null } });
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.shopSettings.updateMany({ where: { shop }, data: { lastScanAt: now, lastScanError: message.slice(0, 300) } });
    throw error;
  }
}

async function runSync(admin: AdminApi, shop: string, now: Date): Promise<SyncSummary> {
  let settings = await getSettings(shop);
  try {
    settings = await refreshShopInfo(admin, shop);
  } catch (error) {
    console.error(`[sync] ${shop}: could not refresh shop info`, error);
  }
  const plan = planFor(settings);
  let usage = await getUsage(shop, now);

  const summary: SyncSummary = {
    shipmentsSeen: 0,
    newShipments: 0,
    externalLookups: 0,
    atRisk: 0,
    messagesCreated: 0,
    followUps: 0,
    flowTriggers: 0,
    scheduledSent: 0,
    discountsRedeemed: 0,
    limitReached: false,
  };
  const transitTable = parseCarrierTransit(settings.carrierTransitDays);

  // 1. Pull shipped orders from Shopify and upsert one row per fulfillment.
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * HOUR).toISOString().slice(0, 10);
  const search = `(fulfillment_status:shipped OR fulfillment_status:partial) AND created_at:>=${since}`;
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: OrdersPage = await gql<OrdersPage>(admin, SHIPPED_ORDERS_QUERY, { query: search, after });
    for (const order of data.orders.nodes) {
      for (const f of order.fulfillments) {
        summary.shipmentsSeen++;
        const existing = await db.shipment.findUnique({
          where: { shop_fulfillmentId: { shop, fulfillmentId: f.id } },
        });
        if (!existing && usage.shipmentsTracked >= plan.shipmentLimit) {
          summary.limitReached = true;
          continue;
        }

        const event = f.events.nodes[0];
        const shopifyStatus: ShipmentStatus = order.cancelledAt
          ? "CANCELED"
          : fromShopify(event?.status ?? f.displayStatus);
        const keepExternal =
          existing?.source === "ship24" && (shopifyStatus === "UNKNOWN" || shopifyStatus === "PRE_TRANSIT");
        const shippedAt = toDate(f.inTransitAt) ?? new Date(f.createdAt);
        const destination = order.shippingAddress?.countryCodeV2 ?? null;
        const international = Boolean(
          destination && settings.shopCountry && destination !== settings.shopCountry,
        );
        const tracking = f.trackingInfo[0];
        const carrierEstimate = toDate(f.estimatedDeliveryAt);
        const orderValue = Number(order.totalPriceSet.shopMoney.amount) || 0;
        const excludedReason = exclusionReason(
          { tags: order.tags, countryCode: destination, orderValue },
          settings,
        );

        const fields = {
          orderId: order.id,
          orderName: order.name,
          orderValue,
          excluded: excludedReason !== null,
          excludedReason,
          currency: order.totalPriceSet.shopMoney.currencyCode,
          carrier: tracking?.company ?? null,
          trackingNumber: tracking?.number ?? null,
          trackingUrl: tracking?.url ?? null,
          customerLocale: order.customerLocale,
          destinationCountry: destination,
          shippedAt,
          ...(keepExternal
            ? {}
            : {
                status: shopifyStatus,
                lastEventAt: toDate(event?.happenedAt),
                deliveredAt: toDate(f.deliveredAt),
                source: "shopify",
              }),
          expectedBy: estimateExpectedBy({
            shippedAt,
            carrierEstimate: carrierEstimate ?? (keepExternal ? existing?.expectedBy : null),
            defaultTransitDays: transitDaysFor(tracking?.company, transitTable, settings.defaultTransitDays),
            international,
          }),
        };

        if (existing) {
          await db.shipment.update({ where: { id: existing.id }, data: fields });
        } else {
          await db.shipment.create({
            data: { shop, fulfillmentId: f.id, status: shopifyStatus, ...fields },
          });
          summary.newShipments++;
          usage = await db.usageMonth.update({
            where: { id: usage.id },
            data: { shipmentsTracked: { increment: 1 } },
          });
        }
      }
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }

  // 2. Fill gaps with external tracking where Shopify has no carrier scans.
  if (ship24Enabled()) {
    const candidates = await db.shipment.findMany({
      where: {
        shop,
        trackingNumber: { not: null },
        status: { in: ["UNKNOWN", "PRE_TRANSIT", "IN_TRANSIT", "OUT_FOR_DELIVERY", "CARRIER_DELAYED", "ATTEMPTED", "EXCEPTION", "PICKUP_READY"] },
        shippedAt: { lt: new Date(now.getTime() - EXTERNAL_LOOKUP_AFTER_HOURS * HOUR) },
        OR: [{ source: "ship24" }, { status: { in: ["UNKNOWN", "PRE_TRANSIT"] } }],
      },
      take: 200,
    });
    for (const s of candidates) {
      const isNew = !s.externalTrackerId;
      if (isNew && usage.paidLookups >= plan.includedPaidLookups) continue;
      try {
        const result = isNew
          ? await registerAndTrack(s.trackingNumber!)
          : await fetchResults(s.externalTrackerId!);
        if (isNew) {
          summary.externalLookups++;
          usage = await db.usageMonth.update({
            where: { id: usage.id },
            data: { paidLookups: { increment: 1 } },
          });
        }
        if (!result) continue;
        await db.shipment.update({
          where: { id: s.id },
          data: {
            source: "ship24",
            externalTrackerId: result.trackerId ?? s.externalTrackerId,
            status: result.status,
            lastEventAt: result.lastEventAt ?? s.lastEventAt,
            deliveredAt: result.deliveredAt,
            ...(result.estimatedDelivery ? { expectedBy: result.estimatedDelivery } : {}),
          },
        });
      } catch (error) {
        console.error(`[sync] ${shop}: external tracking failed for ${s.id}`, error);
      }
    }
  }

  // 3. Re-assess risk and create customer messages where needed.
  const open = await db.shipment.findMany({
    where: { shop, status: { notIn: ["DELIVERED", "CANCELED"] } },
  });
  for (const s of open) {
    const result = assessRisk(
      {
        status: s.status as ShipmentStatus,
        shippedAt: s.shippedAt,
        expectedBy: s.expectedBy,
        lastEventAt: s.lastEventAt,
      },
      settings,
      now,
    );
    const changed = result.risk !== s.risk;
    const updated = await db.shipment.update({
      where: { id: s.id },
      data: {
        risk: result.risk,
        riskReason: result.reason,
        lastCheckedAt: now,
        ...(changed ? { riskSince: now } : {}),
      },
    });
    if (isAtRisk(result.risk)) summary.atRisk++;
    if (s.excluded) continue; // F5: shown on the dashboard, but no emails or workflows.

    // F1: start merchant workflows when a shipment becomes (more) at risk.
    if (
      settings.flowTriggerEnabled &&
      changed &&
      isAtRisk(result.risk) &&
      riskRank(result.risk) > riskRank(s.risk)
    ) {
      if (await fireShipmentAtRisk(admin, updated, result.risk, result.reason, result.daysLate)) {
        summary.flowTriggers++;
      }
    }

    if (shouldNotify(result.risk, s.notifiedRisk, settings)) {
      try {
        await createNotification({
          admin,
          shipment: updated,
          kind: result.risk,
          daysLate: result.daysLate,
          settings,
          plan,
          now,
        });
        summary.messagesCreated++;
      } catch (error) {
        console.error(`[sync] ${shop}: could not create message for ${s.id}`, error);
      }
    }
  }

  // Delivered parcels no longer carry risk.
  await db.shipment.updateMany({
    where: { shop, status: { in: ["DELIVERED", "CANCELED"] }, risk: { not: "none" } },
    data: { risk: "none", riskReason: "Delivered or canceled" },
  });

  // 4. F2: a short "it arrived" note for customers we warned about a delay.
  if (settings.deliveredFollowUp) {
    const delivered = await db.shipment.findMany({
      where: {
        shop,
        status: "DELIVERED",
        excluded: false,
        followUpSent: false,
        notifiedRisk: { not: null },
        deliveredAt: { gte: new Date(now.getTime() - FOLLOW_UP_WITHIN_DAYS * 24 * HOUR) },
        // Only if the warning actually reached the customer.
        messages: { some: { status: "sent" } },
      },
      take: 100,
    });
    for (const s of delivered) {
      try {
        await createNotification({ admin, shipment: s, kind: "delivered", daysLate: 0, settings, plan, now });
        summary.followUps++;
      } catch (error) {
        console.error(`[sync] ${shop}: follow-up failed for ${s.id}`, error);
      }
    }
  }

  // 5. F6: send autopilot emails that were waiting for the send window.
  summary.scheduledSent = await sendDueScheduled(admin, shop, now);

  // 6. F11: which apology discounts turned into orders?
  try {
    summary.discountsRedeemed = await trackRedemptions(admin, shop, now);
  } catch (error) {
    console.error(`[sync] ${shop}: redemption check failed`, error);
  }

  if (!settings.onboardingCompleted && summary.shipmentsSeen > 0) {
    await db.shopSettings.update({ where: { shop }, data: { onboardingCompleted: true } });
  }
  return summary;
}
