import db from "../db.server";
import { customerNotice, type CustomerNotice } from "../lib/notice";
import { gql, type AdminApi } from "./admin-types";
import { ORDER_CONTACT_QUERY } from "./shopify-queries.server";

/** "gid://shopify/Customer/123" or "123" → "123". */
export function numericId(id: string | null | undefined): string | null {
  const m = /(\d+)$/.exec(String(id ?? ""));
  return m ? m[1] : null;
}

/**
 * R4: the notice for a logged-in customer looking at one of their orders.
 * Returns null unless the order is this shop's, the customer owns it, the
 * merchant has the feature on, and a parcel is confirmed at risk.
 */
export async function noticeForCustomer(args: {
  admin: AdminApi;
  shop: string;
  orderId: string;
  customerId: string | null | undefined;
  viewerLanguage: string | null | undefined;
}): Promise<CustomerNotice | null> {
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(args.orderId) || !args.customerId) return null;

  const settings = await db.shopSettings.findUnique({ where: { shop: args.shop } });
  if (!settings?.orderStatusNotice) return null;

  const shipments = await db.shipment.findMany({
    where: { shop: args.shop, orderId: args.orderId },
    select: { risk: true, status: true, excluded: true, trackingUrl: true, customerLocale: true },
  });
  const notice = customerNotice(shipments, args.viewerLanguage);
  if (!notice) return null;

  // Only the order's own customer may see it.
  const data = await gql<{ order: { customer: { id: string } | null } | null }>(args.admin, ORDER_CONTACT_QUERY, {
    id: args.orderId,
  });
  const owner = numericId(data.order?.customer?.id);
  if (!owner || owner !== numericId(args.customerId)) return null;
  return notice;
}
