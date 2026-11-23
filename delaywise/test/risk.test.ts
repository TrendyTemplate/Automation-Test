import { describe, expect, it } from "vitest";
import { assessRisk, estimateExpectedBy, shouldNotify, type RiskSettings } from "../app/lib/risk";

const settings: RiskSettings = {
  defaultTransitDays: 5,
  graceHours: 24,
  stallHours: 72,
  notifyOnStall: true,
  notifyOnDelay: true,
  notifyOnException: true,
};
const H = 3600_000;
const D = 24 * H;
const shippedAt = new Date("2026-11-02T10:00:00Z");

describe("estimateExpectedBy", () => {
  it("prefers the carrier estimate", () => {
    const est = new Date("2026-11-05T00:00:00Z");
    expect(estimateExpectedBy({ shippedAt, carrierEstimate: est, defaultTransitDays: 5, international: false })).toEqual(est);
  });
  it("converts business days to calendar days and adds international buffer", () => {
    const dom = estimateExpectedBy({ shippedAt, defaultTransitDays: 5, international: false });
    expect((dom.getTime() - shippedAt.getTime()) / D).toBe(7);
    const intl = estimateExpectedBy({ shippedAt, defaultTransitDays: 5, international: true });
    expect((intl.getTime() - shippedAt.getTime()) / D).toBe(14);
  });
});

describe("assessRisk", () => {
  const expectedBy = new Date(shippedAt.getTime() + 7 * D);

  it("is none when delivered", () => {
    const r = assessRisk({ status: "DELIVERED", shippedAt, expectedBy, lastEventAt: null }, settings, new Date(expectedBy.getTime() + 20 * D));
    expect(r.risk).toBe("none");
  });
  it("is none when on track", () => {
    const r = assessRisk({ status: "IN_TRANSIT", shippedAt, expectedBy, lastEventAt: new Date(shippedAt.getTime() + D) }, settings, new Date(shippedAt.getTime() + 2 * D));
    expect(r.risk).toBe("none");
  });
  it("flags a stall after stallHours without scans", () => {
    const r = assessRisk({ status: "IN_TRANSIT", shippedAt, expectedBy, lastEventAt: shippedAt }, settings, new Date(shippedAt.getTime() + 80 * H));
    expect(r.risk).toBe("stalled");
  });
  it("does not flag a stall without real carrier data", () => {
    const r = assessRisk({ status: "UNKNOWN", shippedAt, expectedBy, lastEventAt: null }, settings, new Date(shippedAt.getTime() + 4 * D));
    expect(r.risk).toBe("none");
  });
  it("flags delayed after expected date plus grace", () => {
    const r = assessRisk({ status: "UNKNOWN", shippedAt, expectedBy, lastEventAt: null }, settings, new Date(expectedBy.getTime() + 2 * D));
    expect(r.risk).toBe("delayed");
    expect(r.daysLate).toBe(2);
  });
  it("respects the carrier's own delay signal", () => {
    const r = assessRisk({ status: "CARRIER_DELAYED", shippedAt, expectedBy, lastEventAt: shippedAt }, settings, new Date(shippedAt.getTime() + D));
    expect(r.risk).toBe("delayed");
  });
  it("flags exceptions and failed attempts", () => {
    for (const status of ["EXCEPTION", "ATTEMPTED"] as const) {
      const r = assessRisk({ status, shippedAt, expectedBy, lastEventAt: shippedAt }, settings, new Date(shippedAt.getTime() + D));
      expect(r.risk).toBe("exception");
    }
  });
  it("flags probably lost after 10 days late", () => {
    const r = assessRisk({ status: "IN_TRANSIT", shippedAt, expectedBy, lastEventAt: shippedAt }, settings, new Date(expectedBy.getTime() + 11 * D));
    expect(r.risk).toBe("lost");
  });
  it("warns when due soon and not out for delivery", () => {
    const r = assessRisk({ status: "IN_TRANSIT", shippedAt, expectedBy, lastEventAt: new Date(expectedBy.getTime() - 20 * H) }, settings, new Date(expectedBy.getTime() - 12 * H));
    expect(r.risk).toBe("watch");
  });
});

describe("shouldNotify", () => {
  it("never notifies for none or watch", () => {
    expect(shouldNotify("none", null, settings)).toBe(false);
    expect(shouldNotify("watch", null, settings)).toBe(false);
  });
  it("notifies once per escalation", () => {
    expect(shouldNotify("stalled", null, settings)).toBe(true);
    expect(shouldNotify("stalled", "stalled", settings)).toBe(false);
    expect(shouldNotify("delayed", "stalled", settings)).toBe(true);
    expect(shouldNotify("stalled", "delayed", settings)).toBe(false);
  });
  it("respects per-kind toggles", () => {
    expect(shouldNotify("stalled", null, { ...settings, notifyOnStall: false })).toBe(false);
    expect(shouldNotify("lost", null, { ...settings, notifyOnDelay: false })).toBe(false);
    expect(shouldNotify("exception", null, { ...settings, notifyOnException: false })).toBe(false);
  });
});
