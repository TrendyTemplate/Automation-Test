export type PlanId = "free" | "starter" | "growth" | "pro";

export interface Plan {
  id: PlanId;
  /** Name used with the Shopify Billing API. Must stay stable once live. */
  billingName: string;
  label: string;
  priceUsd: number;
  /** Shipments the app watches per calendar month. */
  shipmentLimit: number;
  /** Paid third-party tracking lookups included per month. */
  includedPaidLookups: number;
  autopilot: boolean;
  compensation: boolean;
}

/** Charged per 100 paid lookups above the included amount (our cost ≈ $2.00). */
export const OVERAGE_PER_100_USD = 2.5;
/** Maximum usage charges per 30-day cycle, shown to the merchant at approval. */
export const USAGE_CAP_USD = 50;
export const TRIAL_DAYS = 7;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    billingName: "Free",
    label: "Free",
    priceUsd: 0,
    shipmentLimit: 50,
    includedPaidLookups: 0,
    autopilot: false,
    compensation: false,
  },
  starter: {
    id: "starter",
    billingName: "Starter",
    label: "Starter",
    priceUsd: 19,
    shipmentLimit: 500,
    includedPaidLookups: 300,
    autopilot: true,
    compensation: true,
  },
  growth: {
    id: "growth",
    billingName: "Growth",
    label: "Growth",
    priceUsd: 39,
    shipmentLimit: 2000,
    includedPaidLookups: 1000,
    autopilot: true,
    compensation: true,
  },
  pro: {
    id: "pro",
    billingName: "Pro",
    label: "Pro",
    priceUsd: 79,
    shipmentLimit: 5000,
    includedPaidLookups: 2500,
    autopilot: true,
    compensation: true,
  },
};

export const PAID_PLAN_IDS: PlanId[] = ["starter", "growth", "pro"];

export function getPlan(id: string | null | undefined): Plan {
  return PLANS[(id as PlanId) ?? "free"] ?? PLANS.free;
}

export function planFromBillingName(name: string | null | undefined): Plan {
  const match = Object.values(PLANS).find((p) => p.billingName === name);
  return match ?? PLANS.free;
}

/**
 * How many whole blocks of 100 overage lookups should be charged, given
 * what was already billed this month. Returns 0 when nothing new is due.
 */
export function overageBlocksDue(
  plan: Plan,
  paidLookups: number,
  alreadyBilledBlocks: number,
): number {
  if (plan.priceUsd === 0) return 0;
  const over = Math.max(0, paidLookups - plan.includedPaidLookups);
  const blocks = Math.ceil(over / 100);
  return Math.max(0, blocks - alreadyBilledBlocks);
}

export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}
