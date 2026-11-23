import { isAtRisk } from "./risk";

export interface ScoreInput {
  carrier: string | null;
  destinationCountry: string | null;
  status: string;
  risk: string;
  expectedBy: Date | null;
  deliveredAt: Date | null;
  orderValue: number;
}

export interface CarrierScore {
  carrier: string;
  shipments: number;
  delivered: number;
  onTime: number;
  late: number;
  problems: number;
  /** On-time share of delivered parcels, 0–100, or null with no deliveries. */
  onTimeRate: number | null;
  avgDaysLate: number | null;
}

const DAY = 24 * 60 * 60 * 1000;

export function carrierScorecard(rows: ScoreInput[], graceHours = 24): CarrierScore[] {
  const groups = new Map<string, ScoreInput[]>();
  for (const row of rows) {
    const key = row.carrier?.trim() || "Unknown carrier";
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const scores: CarrierScore[] = [];
  for (const [carrier, list] of groups) {
    let delivered = 0;
    let onTime = 0;
    let late = 0;
    let lateDays = 0;
    let problems = 0;
    for (const r of list) {
      if (r.risk === "exception" || r.risk === "lost") problems++;
      if (r.status !== "DELIVERED" || !r.deliveredAt) continue;
      delivered++;
      if (!r.expectedBy) {
        onTime++;
        continue;
      }
      const diff = r.deliveredAt.getTime() - r.expectedBy.getTime();
      if (diff <= graceHours * 60 * 60 * 1000) {
        onTime++;
      } else {
        late++;
        lateDays += diff / DAY;
      }
    }
    scores.push({
      carrier,
      shipments: list.length,
      delivered,
      onTime,
      late,
      problems,
      onTimeRate: delivered ? Math.round((onTime / delivered) * 1000) / 10 : null,
      avgDaysLate: late ? Math.round((lateDays / late) * 10) / 10 : null,
    });
  }
  return scores.sort((a, b) => b.shipments - a.shipments);
}

export function revenueAtRisk(rows: ScoreInput[]): { orders: number; value: number } {
  let orders = 0;
  let value = 0;
  for (const r of rows) {
    if (isAtRisk(r.risk)) {
      orders++;
      value += r.orderValue;
    }
  }
  return { orders, value: Math.round(value * 100) / 100 };
}

export interface TransitInput {
  carrier: string | null;
  status: string;
  shippedAt: Date;
  deliveredAt: Date | null;
}

export interface TransitSuggestion {
  carrier: string;
  deliveries: number;
  /** Median calendar days from shipping to delivery. */
  medianDays: number;
  /** Business days that cover 80% of deliveries: a safe promise. */
  suggestedBusinessDays: number;
}

/** Minimum deliveries before we trust a carrier's numbers. */
export const MIN_DELIVERIES_FOR_SUGGESTION = 5;

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/**
 * R2: learns real delivery times per carrier from this store's own deliveries
 * and suggests transit days (80th percentile, in business days).
 */
export function suggestTransitDays(rows: TransitInput[]): TransitSuggestion[] {
  const byCarrier = new Map<string, number[]>();
  for (const r of rows) {
    if (r.status !== "DELIVERED" || !r.deliveredAt || !r.carrier?.trim()) continue;
    const days = (r.deliveredAt.getTime() - r.shippedAt.getTime()) / 86_400_000;
    if (days <= 0 || days > 60) continue;
    const key = r.carrier.trim();
    byCarrier.set(key, [...(byCarrier.get(key) ?? []), days]);
  }
  const out: TransitSuggestion[] = [];
  for (const [carrier, days] of byCarrier) {
    if (days.length < MIN_DELIVERIES_FOR_SUGGESTION) continue;
    const sorted = [...days].sort((a, b) => a - b);
    const p80Calendar = percentile(sorted, 0.8);
    out.push({
      carrier,
      deliveries: days.length,
      medianDays: Math.round(percentile(sorted, 0.5) * 10) / 10,
      suggestedBusinessDays: Math.max(1, Math.min(60, Math.ceil((p80Calendar * 5) / 7))),
    });
  }
  return out.sort((a, b) => b.deliveries - a.deliveries);
}
