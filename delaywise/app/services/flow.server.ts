import type { Shipment } from "@prisma/client";
import { gql, type AdminApi } from "./admin-types";
import { FLOW_TRIGGER_MUTATION } from "./shopify-queries.server";

/** Must match `handle` in extensions/shipment-at-risk/shopify.extension.toml. */
export const FLOW_TRIGGER_HANDLE = "shipment-at-risk";

export function flowPayload(shipment: Shipment, risk: string, reason: string, daysLate: number) {
  const orderId = Number(shipment.orderId.split("/").pop());
  return {
    order_id: orderId,
    "Risk level": risk,
    Reason: reason,
    "Days late": daysLate,
    Carrier: shipment.carrier ?? "",
    "Tracking number": shipment.trackingNumber ?? "",
    "Tracking URL": shipment.trackingUrl ?? "",
  };
}

/**
 * F1: tells Shopify Flow that a shipment became at risk, so merchants can tag
 * the order, alert Slack, open a help-desk ticket, etc. Failures never block
 * the scan (e.g. the merchant has no workflow using the trigger).
 */
export async function fireShipmentAtRisk(
  admin: AdminApi,
  shipment: Shipment,
  risk: string,
  reason: string,
  daysLate: number,
): Promise<boolean> {
  if (!Number.isFinite(Number(shipment.orderId.split("/").pop()))) return false;
  try {
    const data = await gql<{ flowTriggerReceive: { userErrors: { message: string }[] } | null }>(
      admin,
      FLOW_TRIGGER_MUTATION,
      { handle: FLOW_TRIGGER_HANDLE, payload: flowPayload(shipment, risk, reason, daysLate) },
    );
    const errors = data.flowTriggerReceive?.userErrors ?? [];
    if (errors.length) {
      console.warn(`[flow] ${shipment.shop}: ${errors.map((e) => e.message).join("; ")}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[flow] ${shipment.shop}: trigger failed`, error instanceof Error ? error.message : error);
    return false;
  }
}
