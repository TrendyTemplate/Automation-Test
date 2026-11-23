/**
 * One internal vocabulary for shipment status, whatever the data source.
 */
export type ShipmentStatus =
  | "PRE_TRANSIT"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "ATTEMPTED"
  | "PICKUP_READY"
  | "CARRIER_DELAYED"
  | "EXCEPTION"
  | "CANCELED"
  | "UNKNOWN";

const SHOPIFY_MAP: Record<string, ShipmentStatus> = {
  LABEL_PRINTED: "PRE_TRANSIT",
  LABEL_PURCHASED: "PRE_TRANSIT",
  CONFIRMED: "PRE_TRANSIT",
  SUBMITTED: "PRE_TRANSIT",
  CARRIER_PICKED_UP: "IN_TRANSIT",
  // M8: PICKED_UP means the customer collected a local-pickup order (final).
  // The carrier collecting a parcel is CARRIER_PICKED_UP.
  PICKED_UP: "DELIVERED",
  IN_TRANSIT: "IN_TRANSIT",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  ATTEMPTED_DELIVERY: "ATTEMPTED",
  READY_FOR_PICKUP: "PICKUP_READY",
  DELAYED: "CARRIER_DELAYED",
  FAILURE: "EXCEPTION",
  NOT_DELIVERED: "EXCEPTION",
  BUYER_ACTION_REQUIRED: "EXCEPTION",
  CANCELED: "CANCELED",
  LABEL_VOIDED: "CANCELED",
  // "FULFILLED" / "MARKED_AS_FULFILLED" carry no carrier information.
  FULFILLED: "UNKNOWN",
  MARKED_AS_FULFILLED: "UNKNOWN",
};

/** Map Shopify's FulfillmentDisplayStatus or FulfillmentEventStatus. */
export function fromShopify(value: string | null | undefined): ShipmentStatus {
  if (!value) return "UNKNOWN";
  return SHOPIFY_MAP[value.toUpperCase()] ?? "UNKNOWN";
}

const SHIP24_MAP: Record<string, ShipmentStatus> = {
  pending: "PRE_TRANSIT",
  info_received: "PRE_TRANSIT",
  in_transit: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY",
  failed_attempt: "ATTEMPTED",
  available_for_pickup: "PICKUP_READY",
  delivered: "DELIVERED",
  exception: "EXCEPTION",
};

/** Map Ship24's `statusMilestone`. */
export function fromShip24(value: string | null | undefined): ShipmentStatus {
  if (!value) return "UNKNOWN";
  return SHIP24_MAP[value.toLowerCase()] ?? "UNKNOWN";
}

/**
 * M8: one status for a fulfillment. Cancelled/failed fulfillments and orders are
 * final, a delivery timestamp wins, then the newest carrier event, then the
 * display status.
 */
export function resolveFulfillmentStatus(f: {
  orderCancelled: boolean;
  fulfillmentStatus: string | null | undefined;
  deliveredAt: string | null | undefined;
  latestEventStatus: string | null | undefined;
  displayStatus: string | null | undefined;
}): ShipmentStatus {
  if (f.orderCancelled) return "CANCELED";
  if (["CANCELLED", "FAILURE", "ERROR"].includes((f.fulfillmentStatus ?? "").toUpperCase())) return "CANCELED";
  if (f.deliveredAt) return "DELIVERED";
  const fromDisplay = fromShopify(f.displayStatus);
  if (fromDisplay === "DELIVERED" || fromDisplay === "CANCELED") return fromDisplay;
  return fromShopify(f.latestEventStatus ?? f.displayStatus);
}

/** True when the status came from real carrier scans (not just "fulfilled"). */
export function hasCarrierSignal(status: ShipmentStatus): boolean {
  return status !== "UNKNOWN" && status !== "PRE_TRANSIT";
}

export function isFinal(status: ShipmentStatus): boolean {
  return status === "DELIVERED" || status === "CANCELED";
}

export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  PRE_TRANSIT: "Label created",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  ATTEMPTED: "Delivery attempted",
  PICKUP_READY: "Ready for pickup",
  CARRIER_DELAYED: "Delayed by carrier",
  EXCEPTION: "Carrier exception",
  CANCELED: "Canceled",
  UNKNOWN: "No carrier data yet",
};
