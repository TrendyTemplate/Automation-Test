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
