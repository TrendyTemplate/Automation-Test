import { riskRank } from "./risk";

/**
 * U3: carrier incident detection. When several parcels with the same carrier
 * to the same country run into trouble at the same time (a strike, weather,
 * a hub outage), they are one incident, not N separate problems.
 */
export interface IncidentInput {
  id: string;
  carrier: string | null;
  destinationCountry: string | null;
  risk: string;
  riskSince: Date | null;
  orderValue: number;
  excluded: boolean;
  handledAt: Date | null;
}

export interface Incident {
  key: string;
  carrier: string;
  country: string;
  count: number;
  orderValue: number;
  worstRisk: string;
  since: Date;
  shipmentIds: string[];
}

/** Problems that started within this window count towards one incident. */
export const INCIDENT_WINDOW_HOURS = 72;
const COUNTED = new Set(["stalled", "delayed", "exception", "lost"]);

export function detectIncidents(rows: IncidentInput[], threshold: number, now: Date): Incident[] {
  const since = now.getTime() - INCIDENT_WINDOW_HOURS * 3_600_000;
  const groups = new Map<string, IncidentInput[]>();
  for (const r of rows) {
    if (!COUNTED.has(r.risk) || r.excluded || r.handledAt || !r.riskSince || r.riskSince.getTime() < since) continue;
    const carrier = r.carrier?.trim();
    if (!carrier) continue;
    const key = `${carrier.toLowerCase()}|${(r.destinationCountry ?? "??").toUpperCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const incidents: Incident[] = [];
  for (const [key, list] of groups) {
    if (list.length < Math.max(2, threshold)) continue;
    incidents.push({
      key,
      carrier: list[0].carrier!.trim(),
      country: (list[0].destinationCountry ?? "??").toUpperCase(),
      count: list.length,
      orderValue: Math.round(list.reduce((s, r) => s + r.orderValue, 0) * 100) / 100,
      worstRisk: list.reduce((w, r) => (riskRank(r.risk) > riskRank(w) ? r.risk : w), "none"),
      since: new Date(Math.min(...list.map((r) => r.riskSince!.getTime()))),
      shipmentIds: list.map((r) => r.id),
    });
  }
  return incidents.sort((a, b) => b.count - a.count);
}

/** U4: VIP = tagged as VIP, or order value at/above the merchant's threshold. */
export function isVip(order: { tags: string[]; orderValue: number }, vipTags: string | null, vipMinOrderValue: number): boolean {
  const wanted = (vipTags ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length && order.tags.some((t) => wanted.includes(t.trim().toLowerCase()))) return true;
  return vipMinOrderValue > 0 && order.orderValue >= vipMinOrderValue;
}
