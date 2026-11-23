import type { Shipment, ShopSettings } from "@prisma/client";
import { decryptSecret } from "../lib/crypto";
import { gql, type AdminApi } from "./admin-types";
import { sendKlaviyoEvent } from "./klaviyo.server";
import { ORDER_CONTACT_QUERY } from "./shopify-queries.server";

export function klaviyoKeyFor(settings: Pick<ShopSettings, "shop" | "klaviyoEnabled" | "klaviyoApiKeyEnc">): string | null {
  if (!settings.klaviyoEnabled || !settings.klaviyoApiKeyEnc) return null;
  return decryptSecret(settings.klaviyoApiKeyEnc, settings.shop);
}

/**
 * R3: pushes a shipment event to the merchant's Klaviyo account. The
 * customer's email is read from Shopify for this call only. Never throws.
 */
export async function pushKlaviyoShipmentEvent(args: {
  admin: AdminApi;
  settings: ShopSettings;
  shipment: Shipment;
  metric: string;
  risk: string;
  reason: string;
  daysLate: number;
  now: Date;
}): Promise<boolean> {
  const key = klaviyoKeyFor(args.settings);
  if (!key) return false;
  try {
    const data = await gql<{ order: { email: string | null } | null }>(args.admin, ORDER_CONTACT_QUERY, {
      id: args.shipment.orderId,
    });
    const email = data.order?.email;
    if (!email) return false;
    await sendKlaviyoEvent(key, {
      metric: args.metric,
      email,
      uniqueId: `${args.shipment.shop}:${args.shipment.fulfillmentId}:${args.risk}`,
      time: args.now,
      properties: {
        order_name: args.shipment.orderName,
        order_value: args.shipment.orderValue,
        currency: args.shipment.currency,
        risk: args.risk,
        reason: args.reason,
        days_late: args.daysLate,
        carrier: args.shipment.carrier,
        tracking_number: args.shipment.trackingNumber,
        tracking_url: args.shipment.trackingUrl,
      },
    });
    return true;
  } catch (error) {
    console.warn(`[klaviyo] ${args.shipment.shop}: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}
