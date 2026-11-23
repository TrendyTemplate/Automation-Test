import type { ShipmentStatus } from "./status";
import { hasCarrierSignal, isFinal } from "./status";

export type Risk = "none" | "watch" | "stalled" | "delayed" | "exception" | "lost";

/** Message kinds the customer can be told about. */
export type NotifiableRisk = Extract<Risk, "stalled" | "delayed" | "exception" | "lost">;

/** Everything a customer email can be about, including the F2 follow-up. */
export type MessageKind = NotifiableRisk | "delivered";

const RANK: Record<Risk, number> = {
  none: 0,
  watch: 1,
  stalled: 2,
  delayed: 3,
  exception: 4,
  lost: 5,
};

export function riskRank(risk: string | null | undefined): number {
  return RANK[(risk as Risk) ?? "none"] ?? 0;
}

export interface RiskSettings {
  defaultTransitDays: number;
  graceHours: number;
  stallHours: number;
  notifyOnStall: boolean;
  notifyOnDelay: boolean;
  notifyOnException: boolean;
}

export interface RiskInput {
  status: ShipmentStatus;
  shippedAt: Date;
  expectedBy: Date | null;
  lastEventAt: Date | null;
}

export interface RiskResult {
  risk: Risk;
  reason: string;
  /** Whole days past the expected date (0 if not late). */
  daysLate: number;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Not delivered this many days after the expected date → probably lost. */
export const LOST_AFTER_DAYS = 10;
/** Extra calendar days added for cross-border shipments. */
export const INTERNATIONAL_EXTRA_DAYS = 5;

/**
 * Expected delivery date. Uses the carrier/Shopify estimate when present,
 * otherwise shippedAt + transit days (business days converted to calendar days).
 */
export function estimateExpectedBy(args: {
  shippedAt: Date;
  carrierEstimate?: Date | null;
  defaultTransitDays: number;
  international: boolean;
}): Date {
  if (args.carrierEstimate) return args.carrierEstimate;
  const businessDays =
    args.defaultTransitDays + (args.international ? INTERNATIONAL_EXTRA_DAYS : 0);
  const calendarDays = Math.ceil((businessDays * 7) / 5);
  return new Date(args.shippedAt.getTime() + calendarDays * DAY);
}

export function assessRisk(
  input: RiskInput,
  settings: RiskSettings,
  now: Date,
): RiskResult {
  const { status } = input;
  if (isFinal(status)) return { risk: "none", reason: "Delivered or canceled", daysLate: 0 };

  const expected = input.expectedBy;
  const msLate = expected ? now.getTime() - expected.getTime() : 0;
  const daysLate = msLate > 0 ? Math.floor(msLate / DAY) : 0;

  if (expected && msLate > LOST_AFTER_DAYS * DAY && hasCarrierSignal(status)) {
    return {
      risk: "lost",
      reason: `Not delivered ${daysLate} days after the expected date`,
      daysLate,
    };
  }

  if (status === "EXCEPTION" || status === "ATTEMPTED") {
    return {
      risk: "exception",
      reason:
        status === "ATTEMPTED"
          ? "Carrier attempted delivery but could not complete it"
          : "Carrier reported a problem with this parcel",
      daysLate,
    };
  }

  // H1: without real carrier scans we cannot tell a late parcel from a
  // delivered one (or a digital / untracked order). Never tell the customer
  // it is late or lost; flag it for the merchant to check instead.
  if (!hasCarrierSignal(status)) {
    if (expected && msLate > settings.graceHours * HOUR) {
      return {
        risk: "watch",
        reason: "Past the expected date, but the carrier has sent no tracking updates. Check this one manually.",
        daysLate,
      };
    }
    if (expected && expected.getTime() - now.getTime() < DAY) {
      return { risk: "watch", reason: "Due within a day; no carrier tracking updates yet", daysLate };
    }
    return { risk: "none", reason: "Waiting for carrier tracking updates", daysLate };
  }

  if (status === "CARRIER_DELAYED") {
    return { risk: "delayed", reason: "Carrier marked this parcel as delayed", daysLate };
  }

  if (expected && msLate > settings.graceHours * HOUR) {
    return {
      risk: "delayed",
      reason: `Past the expected delivery date by ${Math.max(1, daysLate)} day(s)`,
      daysLate,
    };
  }

  // Stall detection only makes sense with real carrier scans.
  if (hasCarrierSignal(status) && status !== "PICKUP_READY") {
    const last = (input.lastEventAt ?? input.shippedAt).getTime();
    const quietHours = (now.getTime() - last) / HOUR;
    if (quietHours > settings.stallHours) {
      return {
        risk: "stalled",
        reason: `No carrier scan for ${Math.floor(quietHours)} hours`,
        daysLate,
      };
    }
  }

  if (expected && status !== "OUT_FOR_DELIVERY" && expected.getTime() - now.getTime() < DAY) {
    return { risk: "watch", reason: "Due within a day and not out for delivery yet", daysLate };
  }

  return { risk: "none", reason: "On track", daysLate };
}

/**
 * Should the customer get a message now? Only when the risk is notifiable,
 * enabled in settings, and worse than anything they were already told.
 */
export function shouldNotify(
  risk: Risk,
  alreadyNotified: string | null | undefined,
  settings: RiskSettings,
): risk is NotifiableRisk {
  if (risk === "none" || risk === "watch") return false;
  if (risk === "stalled" && !settings.notifyOnStall) return false;
  if ((risk === "delayed" || risk === "lost") && !settings.notifyOnDelay) return false;
  if (risk === "exception" && !settings.notifyOnException) return false;
  return riskRank(risk) > riskRank(alreadyNotified);
}

export function isAtRisk(risk: string): boolean {
  return riskRank(risk) >= RANK.stalled;
}
