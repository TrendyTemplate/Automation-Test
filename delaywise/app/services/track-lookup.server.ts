import { createHash, timingSafeEqual } from "node:crypto";
import db from "../db.server";
import { customerNotice } from "../lib/notice";
import { normalizeEmail, orderNameCandidates, type TrackLang, type TrackResult } from "../lib/tracking-page";
import { gql, type AdminApi } from "./admin-types";
import { TRACK_ORDER_LOOKUP_QUERY } from "./shopify-queries.server";

interface LookupOrder {
  id: string;
  name: string;
  email: string | null;
  customerLocale: string | null;
  displayFulfillmentStatus: string;
  cancelledAt: string | null;
  fulfillments: {
    displayStatus: string | null;
    estimatedDeliveryAt: string | null;
    trackingInfo: { company: string | null; number: string | null; url: string | null }[];
  }[];
}

const SHIPPED = new Set(["FULFILLED", "PARTIALLY_FULFILLED", "RESTOCKED"]);

/** Fulfillment display status → our status codes, for orders the app hasn't scanned. */
function fulfillmentStatus(display: string | null): string {
  switch (display) {
    case "DELIVERED":
    case "PICKED_UP":
      return "DELIVERED";
    case "OUT_FOR_DELIVERY":
      return "OUT_FOR_DELIVERY";
    case "READY_FOR_PICKUP":
      return "PICKUP_READY";
    case "ATTEMPTED_DELIVERY":
      return "ATTEMPTED";
    case "FAILURE":
    case "NOT_DELIVERED":
      return "EXCEPTION";
    case "CANCELED":
      return "CANCELED";
    case "LABEL_PRINTED":
    case "LABEL_PURCHASED":
    case "CONFIRMED":
      return "PRE_TRANSIT";
    default:
      return "IN_TRANSIT";
  }
}

function sameEmail(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * T1: the shopper proves it's their order with order number + checkout email.
 * Any mismatch gives the same "not found" answer, so the page can't be used
 * to find out which order numbers or emails exist.
 */
export async function trackOrder(args: {
  admin: AdminApi | undefined;
  shop: string;
  orderInput: string;
  emailInput: string;
  lang: TrackLang;
}): Promise<TrackResult> {
  const names = orderNameCandidates(args.orderInput);
  const email = normalizeEmail(args.emailInput);
  if (!args.admin || !names || !email) return { kind: "error", message: "notFound" };

  const q = names.map((n) => `name:"${n}"`).join(" OR ");
  const data = await gql<{ orders: { nodes: LookupOrder[] } }>(args.admin, TRACK_ORDER_LOOKUP_QUERY, { q });
  const order = data.orders.nodes.find(
    (o) => names.includes(o.name) && o.email && sameEmail(o.email.trim().toLowerCase(), email),
  );
  if (!order) return { kind: "error", message: "notFound" };

  const [settings, shipments] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop: args.shop }, select: { orderStatusNotice: true } }),
    db.shipment.findMany({
      where: { shop: args.shop, orderId: order.id },
      orderBy: { shippedAt: "asc" },
      select: {
        carrier: true,
        trackingNumber: true,
        trackingUrl: true,
        status: true,
        risk: true,
        expectedBy: true,
        excluded: true,
        handledAt: true,
        customerLocale: true,
      },
    }),
  ]);
  const notice = settings?.orderStatusNotice === false ? null : customerNotice(shipments, args.lang);
  // Orders Delaywise never scanned (older, or over the plan's limit) still show Shopify's own tracking.
  const parcels = shipments.length
    ? shipments.map(({ carrier, trackingNumber, trackingUrl, status, risk, expectedBy }) => ({
        carrier,
        trackingNumber,
        trackingUrl,
        status,
        risk,
        expectedBy,
      }))
    : (order.fulfillments ?? [])
        .filter((f) => f.displayStatus !== "CANCELED" && f.displayStatus !== "LABEL_VOIDED")
        .map((f) => ({
          carrier: f.trackingInfo[0]?.company ?? null,
          trackingNumber: f.trackingInfo[0]?.number ?? null,
          trackingUrl: f.trackingInfo[0]?.url ?? null,
          status: fulfillmentStatus(f.displayStatus),
          risk: "none",
          expectedBy: f.estimatedDeliveryAt ? new Date(f.estimatedDeliveryAt) : null,
        }));
  return {
    kind: "order",
    orderName: order.name,
    shipped: SHIPPED.has(order.displayFulfillmentStatus) || parcels.length > 0,
    canceled: Boolean(order.cancelledAt),
    parcels,
    notice: notice?.text ?? null,
  };
}
