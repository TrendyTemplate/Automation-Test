import db from "../db.server";
import { assessRisk, estimateExpectedBy, isAtRisk, LOST_AFTER_DAYS, riskRank, shouldNotify } from "../lib/risk";
import { exclusionReason, parseCarrierTransit, transitDaysFor } from "../lib/rules";
import { hasCarrierSignal, isFinal, resolveFulfillmentStatus, type ShipmentStatus } from "../lib/status";
import { gql, type AdminApi } from "./admin-types";
import { fireShipmentAtRisk } from "./flow.server";
import { pushKlaviyoShipmentEvent } from "./klaviyo-events.server";
import { KLAVIYO_METRICS } from "./klaviyo.server";
import { randomUUID } from "node:crypto";
import { createNotification, recoverStuckSends, sendDueScheduled, skipResolvedMessages } from "./notifier.server";
import { trackRedemptions } from "./roi.server";
import { getSettings, getUsage, planFor, refreshShopInfo } from "./settings.server";
import { fetchResults, registerAndTrack, ship24Enabled } from "./ship24.server";
import { REFRESH_FULFILLMENTS_QUERY, SHIPPED_ORDERS_QUERY } from "./shopify-queries.server";

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
    status: string;
    requiresShipping: boolean;
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
  klaviyoEvents: number;
  refreshed: number;
  skippedNoTracking: number;
  limitReached: boolean;
}

/** H2: how long a scan may hold the shop's lock before another can take over. */
export const SCAN_LOCK_MS = 15 * 60 * 1000;

export class ScanInProgressError extends Error {
  constructor() {
    super("A scan is already running for this store. Try again in a minute.");
  }
}

interface RefreshNode {
  id?: string;
  status: string;
  displayStatus: string | null;
  deliveredAt: string | null;
  estimatedDeliveryAt: string | null;
  events: { nodes: { status: string; happenedAt: string }[] };
  order: { cancelledAt: string | null } | null;
}

const OVERDUE_NOTE = "Already long overdue when Delaywise first saw it. Check it manually; no automatic emails.";

/** F2: follow up only on recent deliveries. */
const FOLLOW_UP_WITHIN_DAYS = 3;

const toDate = (v: string | null | undefined) => (v ? new Date(v) : null);

export interface SyncOptions {
  /** V-7: wall-clock time (ms) after which no new AI drafts or sends start. */
  deadline?: number;
}

/** V-7: bounded work per scan; anything left is picked up next scan. */
export const MAX_NEW_DRAFTS_PER_SCAN = 25;
const MAX_REFRESH_BATCHES = 20;
const DEFAULT_SCAN_BUDGET_MS = 4 * 60 * 1000;

export async function syncShop(
  admin: AdminApi,
  shop: string,
  now = new Date(),
  options: SyncOptions = {},
): Promise<SyncSummary> {
  // H2: take the shop's lease (or fail fast) so scans never overlap.
  // V-2: the lease carries a token, so only its owner can renew or release it.
  await getSettings(shop);
  const token = randomUUID();
  const clock = new Date();
  const lock = await db.shopSettings.updateMany({
    where: { shop, OR: [{ scanLockUntil: null }, { scanLockUntil: { lt: clock } }] },
    data: { scanLockUntil: new Date(clock.getTime() + SCAN_LOCK_MS), scanLockToken: token },
  });
  if (lock.count !== 1) throw new ScanInProgressError();
  const renew = async () => {
    const r = await db.shopSettings.updateMany({
      where: { shop, scanLockToken: token },
      data: { scanLockUntil: new Date(Date.now() + SCAN_LOCK_MS) },
    });
    if (r.count !== 1) throw new ScanInProgressError();
  };
  const deadline = options.deadline ?? Date.now() + DEFAULT_SCAN_BUDGET_MS;

  try {
    const summary = await runSync(admin, shop, now, { renew, deadline });
    await db.shopSettings.update({ where: { shop }, data: { lastScanAt: now, lastScanError: null } });
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.shopSettings.updateMany({ where: { shop }, data: { lastScanAt: now, lastScanError: message.slice(0, 300) } });
    throw error;
  } finally {
    await db.shopSettings.updateMany({
      where: { shop, scanLockToken: token },
      data: { scanLockUntil: null, scanLockToken: null },
    });
  }
}

async function runSync(
  admin: AdminApi,
  shop: string,
  now: Date,
  ctl: { renew: () => Promise<void>; deadline: number },
): Promise<SyncSummary> {
  // V-M1: sends interrupted by a crash or redeploy become visible again.
  await recoverStuckSends(shop, now);
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
    klaviyoEvents: 0,
    refreshed: 0,
    skippedNoTracking: 0,
    limitReached: false,
  };
  const redacted = new Set(
    (await db.redactedOrder.findMany({ where: { shop }, select: { orderId: true } })).map((r) => r.orderId),
  );
  const seen = new Set<string>();
  const transitTable = parseCarrierTransit(settings.carrierTransitDays);

  // 1. Pull shipped orders from Shopify and upsert one row per fulfillment.
  const windowStart = now.getTime() - WINDOW_DAYS * 24 * HOUR;
  const since = new Date(windowStart).toISOString().slice(0, 10);
  // L9: updated_at, so pre-orders placed long ago but shipped recently are included.
  const search = `(fulfillment_status:shipped OR fulfillment_status:partial) AND updated_at:>=${since}`;
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: OrdersPage = await gql<OrdersPage>(admin, SHIPPED_ORDERS_QUERY, { query: search, after });
    for (const order of data.orders.nodes) {
      if (redacted.has(order.id)) continue; // M7
      for (const f of order.fulfillments) {
        // H1: digital, local-delivery and untracked fulfillments can't be followed.
        if (!f.requiresShipping || !f.trackingInfo[0]?.number) {
          summary.skippedNoTracking++;
          continue;
        }
        seen.add(f.id);
        summary.shipmentsSeen++;
        const existing = await db.shipment.findUnique({
          where: { shop_fulfillmentId: { shop, fulfillmentId: f.id } },
        });
        if (!existing && usage.shipmentsTracked >= plan.shipmentLimit) {
          summary.limitReached = true;
          continue;
        }

        const event = f.events.nodes[0];
        const shopifyStatus: ShipmentStatus = resolveFulfillmentStatus({
          orderCancelled: Boolean(order.cancelledAt),
          fulfillmentStatus: f.status,
          deliveredAt: f.deliveredAt,
          latestEventStatus: event?.status,
          displayStatus: f.displayStatus,
        });
        const keepExternal =
          existing?.source === "ship24" && (shopifyStatus === "UNKNOWN" || shopifyStatus === "PRE_TRANSIT");
        const shippedAt = toDate(f.inTransitAt) ?? new Date(f.createdAt);
        // V-H2: an old order touched recently (tag, refund) is not a new shipment.
        if (!existing && shippedAt.getTime() < windowStart) {
          summary.skippedNoTracking++;
          continue;
        }
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
            defaultTransitDays:
              transitDaysFor(tracking?.company, transitTable, settings.defaultTransitDays) +
              settings.extraTransitDays,
            international,
          }),
        };

        if (existing) {
          await db.shipment.update({ where: { id: existing.id }, data: fields });
        } else {
          // V-H2: a parcel already far past "probably lost" when we first see it
          // gets no automatic emails or workflows; the merchant checks it.
          const alreadyLost = now.getTime() - fields.expectedBy.getTime() > LOST_AFTER_DAYS * 24 * HOUR;
          await db.shipment.create({
            data: {
              shop,
              fulfillmentId: f.id,
              status: shopifyStatus,
              ...fields,
              ...(alreadyLost && hasCarrierSignal(shopifyStatus) && !isFinal(shopifyStatus)
                ? {
                    risk: "lost",
                    notifiedRisk: "lost",
                    importedOverdue: true,
                    riskSince: now,
                    riskReason: OVERDUE_NOTE,
                  }
                : {}),
            },
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

  await ctl.renew();

  // 1b. H4 + V-M3: every open tracked shipment the order search didn't return
  // (big stores, old orders, Ship24-tracked rows) is re-checked by ID, so a
  // delivery or cancellation is never missed. Oldest-checked first, bounded.
  const stale = await db.shipment.findMany({
    where: { shop, status: { notIn: ["DELIVERED", "CANCELED"] }, trackingNumber: { not: null } },
    select: { id: true, fulfillmentId: true, deliveredAt: true, source: true },
    orderBy: { lastCheckedAt: "asc" },
  });
  const toRefresh = stale.filter((s) => !seen.has(s.fulfillmentId)).slice(0, MAX_REFRESH_BATCHES * 50);
  for (let i = 0; i < toRefresh.length; i += 50) {
    const batch = toRefresh.slice(i, i + 50);
    let nodes: (RefreshNode | null)[];
    try {
      // V-M4: one bad batch must not stop the rest of the scan.
      nodes = (
        await gql<{ nodes: (RefreshNode | null)[] }>(admin, REFRESH_FULFILLMENTS_QUERY, {
          ids: batch.map((b) => b.fulfillmentId),
        })
      ).nodes;
    } catch (error) {
      console.error(`[sync] ${shop}: refresh batch failed`, error);
      continue;
    }
    for (const [index, node] of nodes.entries()) {
      const row = batch[index];
      if (!row) continue;
      if (!node) {
        // The fulfillment no longer exists (deleted / order removed).
        await db.shipment.update({
          where: { id: row.id },
          data: { status: "CANCELED", riskReason: "Fulfillment no longer exists in Shopify", lastCheckedAt: now },
        });
        continue;
      }
      const event = node.events.nodes[0];
      const status = resolveFulfillmentStatus({
        orderCancelled: Boolean(node.order?.cancelledAt),
        fulfillmentStatus: node.status,
        deliveredAt: node.deliveredAt,
        latestEventStatus: event?.status,
        displayStatus: node.displayStatus,
      });
      // Ship24-tracked rows keep their external status unless Shopify knows more.
      if (row.source === "ship24" && !isFinal(status) && !hasCarrierSignal(status)) continue;
      await db.shipment.update({
        where: { id: row.id },
        data: {
          status,
          ...(row.source === "ship24" ? {} : { lastEventAt: toDate(event?.happenedAt) }),
          deliveredAt: toDate(node.deliveredAt) ?? row.deliveredAt,
          ...(node.estimatedDeliveryAt ? { expectedBy: new Date(node.estimatedDeliveryAt) } : {}),
        },
      });
      summary.refreshed++;
    }
  }
  await ctl.renew();

  // 2. Fill gaps with external tracking where Shopify has no carrier scans.
  if (ship24Enabled()) {
    // V-M3: existing trackers (free to re-read) oldest-checked first, then new
    // registrations only up to the plan's remaining quota.
    const open = { notIn: ["DELIVERED", "CANCELED"] };
    const existingTrackers = await db.shipment.findMany({
      where: { shop, externalTrackerId: { not: null }, status: open },
      orderBy: { lastCheckedAt: "asc" },
      take: 200,
    });
    const quotaLeft = Math.max(0, plan.includedPaidLookups - usage.paidLookups);
    const newTrackers = quotaLeft
      ? await db.shipment.findMany({
          where: {
            shop,
            externalTrackerId: null,
            trackingNumber: { not: null },
            status: { in: ["UNKNOWN", "PRE_TRANSIT"] },
            shippedAt: { lt: new Date(now.getTime() - EXTERNAL_LOOKUP_AFTER_HOURS * HOUR) },
          },
          orderBy: { shippedAt: "desc" },
          take: Math.min(quotaLeft, 200),
        })
      : [];
    const candidates = [...existingTrackers, ...newTrackers];
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
            lastCheckedAt: now,
            ...(result.estimatedDelivery ? { expectedBy: result.estimatedDelivery } : {}),
          },
        });
      } catch (error) {
        console.error(`[sync] ${shop}: external tracking failed for ${s.id}`, error);
      }
    }
  }

  await ctl.renew();

  // 3. Re-assess risk and create customer messages where needed.
  // V-1: rows without a tracking number (imported by older versions) are ignored.
  let draftsLeft = MAX_NEW_DRAFTS_PER_SCAN;
  const open = await db.shipment.findMany({
    where: { shop, status: { notIn: ["DELIVERED", "CANCELED"] }, trackingNumber: { not: null } },
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
        riskReason: s.importedOverdue ? OVERDUE_NOTE : result.reason,
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
    // R3: same moment, pushed to the merchant's Klaviyo account if connected.
    if (settings.klaviyoEnabled && changed && isAtRisk(result.risk) && riskRank(result.risk) > riskRank(s.risk)) {
      const pushed = await pushKlaviyoShipmentEvent({
        admin,
        settings,
        shipment: updated,
        metric: KLAVIYO_METRICS.atRisk,
        risk: result.risk,
        reason: result.reason,
        daysLate: result.daysLate,
        now,
      });
      if (pushed) summary.klaviyoEvents++;
    }

    // V-7: drafting calls the AI (and may send). Stop starting new ones when
    // the scan's budget is used; the rest are drafted next scan.
    if (shouldNotify(result.risk, s.notifiedRisk, settings) && draftsLeft > 0 && Date.now() < ctl.deadline) {
      draftsLeft--;
      try {
        const created = await createNotification({
          admin,
          shipment: updated,
          kind: result.risk,
          daysLate: result.daysLate,
          settings,
          plan,
          now,
        });
        if (created) summary.messagesCreated++;
      } catch (error) {
        console.error(`[sync] ${shop}: could not create message for ${s.id}`, error);
      }
    }
  }

  // Delivered parcels no longer carry risk, and H5: their unsent drafts are dropped.
  await db.shipment.updateMany({
    where: { shop, status: { in: ["DELIVERED", "CANCELED"] }, risk: { not: "none" } },
    data: { risk: "none", riskReason: "Delivered or canceled" },
  });
  await skipResolvedMessages(shop);

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
      if (draftsLeft <= 0 || Date.now() >= ctl.deadline) break;
      draftsLeft--;
      try {
        const created = await createNotification({ admin, shipment: s, kind: "delivered", daysLate: 0, settings, plan, now });
        if (!created) continue;
        summary.followUps++;
        if (
          await pushKlaviyoShipmentEvent({
            admin,
            settings,
            shipment: s,
            metric: KLAVIYO_METRICS.delivered,
            risk: "delivered",
            reason: "Delivered after a delay",
            daysLate: 0,
            now,
          })
        ) {
          summary.klaviyoEvents++;
        }
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
