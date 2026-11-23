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
  return {
    kind: "order",
    orderName: order.name,
    shipped: order.displayFulfillmentStatus !== "UNFULFILLED",
    parcels: shipments.map(({ carrier, trackingNumber, trackingUrl, status, risk, expectedBy }) => ({
      carrier,
      trackingNumber,
      trackingUrl,
      status,
      risk,
      expectedBy,
    })),
    notice: notice?.text ?? null,
  };
}
