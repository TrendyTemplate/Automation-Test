import { fromShip24, type ShipmentStatus } from "../lib/status";

/**
 * Ship24 fallback tracking (paid, ~$0.02 per shipment on the 5k plan).
 * Used only when Shopify has no carrier scans for a shipment, and only within
 * the merchant plan's included lookups. Each shipment is registered once; later
 * checks read results for the existing tracker.
 *
 * Verify endpoint and response shapes against Ship24's current docs before launch:
 * https://docs.ship24.com
 */

const BASE = "https://api.ship24.com/public/v1";

export interface ExternalTracking {
  trackerId: string | null;
  status: ShipmentStatus;
  lastEventAt: Date | null;
  estimatedDelivery: Date | null;
  deliveredAt: Date | null;
}

export function ship24Enabled(): boolean {
  return Boolean(process.env.SHIP24_API_KEY);
}

interface Ship24Event {
  occurrenceDatetime?: string;
  datetime?: string;
  statusMilestone?: string;
}
interface Ship24Tracking {
  tracker?: { trackerId?: string };
  shipment?: {
    statusMilestone?: string;
    delivery?: { estimatedDeliveryDate?: string | null };
  };
  events?: Ship24Event[];
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseShip24Tracking(t: Ship24Tracking | undefined): ExternalTracking | null {
  if (!t) return null;
  const status = fromShip24(t.shipment?.statusMilestone);
  const events = (t.events ?? [])
    .map((e) => ({ at: parseDate(e.occurrenceDatetime ?? e.datetime), milestone: e.statusMilestone }))
    .filter((e): e is { at: Date; milestone: string | undefined } => e.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const delivered = events.find((e) => e.milestone === "delivered");
  return {
    trackerId: t.tracker?.trackerId ?? null,
    status,
    lastEventAt: events[0]?.at ?? null,
    estimatedDelivery: parseDate(t.shipment?.delivery?.estimatedDeliveryDate),
    deliveredAt: status === "DELIVERED" ? (delivered?.at ?? events[0]?.at ?? null) : null,
  };
}

async function call(path: string, init: RequestInit): Promise<Ship24Tracking | undefined> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.SHIP24_API_KEY}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Ship24 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: { trackings?: Ship24Tracking[] } };
  return json.data?.trackings?.[0];
}

/** Registers a new tracker (billable) and returns current results. */
export async function registerAndTrack(trackingNumber: string): Promise<ExternalTracking | null> {
  const t = await call("/trackers/track", {
    method: "POST",
    body: JSON.stringify({ trackingNumber }),
  });
  return parseShip24Tracking(t);
}

/** Reads results for an existing tracker (not billed again on per-shipment plans). */
export async function fetchResults(trackerId: string): Promise<ExternalTracking | null> {
  const t = await call(`/trackers/${encodeURIComponent(trackerId)}/results`, { method: "GET" });
  return parseShip24Tracking(t);
}
