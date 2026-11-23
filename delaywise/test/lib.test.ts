import { describe, expect, it } from "vitest";
import { fromShip24, fromShopify, hasCarrierSignal } from "../app/lib/status";
import { getPlan, overageBlocksDue, planFromBillingName, PLANS } from "../app/lib/plans";
import { carrierScorecard, revenueAtRisk } from "../app/lib/scorecard";
import { renderTemplate } from "../app/lib/templates";
import { baseLanguage, languageName } from "../app/lib/language";

describe("status mapping", () => {
  it("maps Shopify statuses", () => {
    expect(fromShopify("IN_TRANSIT")).toBe("IN_TRANSIT");
    expect(fromShopify("delayed")).toBe("CARRIER_DELAYED");
    expect(fromShopify("FULFILLED")).toBe("UNKNOWN");
    expect(fromShopify("SOMETHING_NEW")).toBe("UNKNOWN");
    expect(fromShopify(null)).toBe("UNKNOWN");
  });
  it("maps Ship24 milestones", () => {
    expect(fromShip24("out_for_delivery")).toBe("OUT_FOR_DELIVERY");
    expect(fromShip24("failed_attempt")).toBe("ATTEMPTED");
    expect(fromShip24(undefined)).toBe("UNKNOWN");
  });
  it("knows which statuses carry carrier scans", () => {
    expect(hasCarrierSignal("IN_TRANSIT")).toBe(true);
    expect(hasCarrierSignal("UNKNOWN")).toBe(false);
    expect(hasCarrierSignal("PRE_TRANSIT")).toBe(false);
  });
});

describe("plans", () => {
  it("falls back to free", () => {
    expect(getPlan(undefined).id).toBe("free");
    expect(getPlan("bogus").id).toBe("free");
    expect(planFromBillingName("Growth").id).toBe("growth");
  });
  it("computes overage blocks once", () => {
    const growth = PLANS.growth;
    expect(overageBlocksDue(growth, 900, 0)).toBe(0);
    expect(overageBlocksDue(growth, 1001, 0)).toBe(1);
    expect(overageBlocksDue(growth, 1250, 1)).toBe(2);
    expect(overageBlocksDue(growth, 1250, 3)).toBe(0);
    expect(overageBlocksDue(PLANS.free, 5000, 0)).toBe(0);
  });
});

describe("scorecard", () => {
  const exp = new Date("2026-11-10T00:00:00Z");
  const rows = [
    { carrier: "UPS", destinationCountry: "US", status: "DELIVERED", risk: "none", expectedBy: exp, deliveredAt: new Date("2026-11-09T00:00:00Z"), orderValue: 50 },
    { carrier: "UPS", destinationCountry: "US", status: "DELIVERED", risk: "none", expectedBy: exp, deliveredAt: new Date("2026-11-13T00:00:00Z"), orderValue: 20 },
    { carrier: "USPS", destinationCountry: "US", status: "IN_TRANSIT", risk: "delayed", expectedBy: exp, deliveredAt: null, orderValue: 80 },
    { carrier: null, destinationCountry: "DE", status: "EXCEPTION", risk: "exception", expectedBy: exp, deliveredAt: null, orderValue: 30.5 },
  ];
  it("scores carriers", () => {
    const ups = carrierScorecard(rows).find((s) => s.carrier === "UPS")!;
    expect(ups).toMatchObject({ shipments: 2, delivered: 2, onTime: 1, late: 1, onTimeRate: 50, avgDaysLate: 3 });
    expect(carrierScorecard(rows).find((s) => s.carrier === "Unknown carrier")!.problems).toBe(1);
  });
  it("sums revenue at risk", () => {
    expect(revenueAtRisk(rows)).toEqual({ orders: 2, value: 110.5 });
  });
});

describe("templates and language", () => {
  it("renders localized copy with discount and tracking", () => {
    const t = renderTemplate({ kind: "delayed", language: "de", orderName: "#1001", storeName: "Acme", trackingUrl: "https://t.example/1", discount: { code: "SORRY-AB12", percent: 10 } });
    expect(t.language).toBe("de");
    expect(t.subject).toContain("#1001");
    expect(t.body).toContain("https://t.example/1");
    expect(t.body).toContain("SORRY-AB12");
    expect(t.body).not.toContain("{");
  });
  it("falls back to English for unknown languages", () => {
    expect(renderTemplate({ kind: "lost", language: "xx", orderName: "#1", storeName: "Acme" }).language).toBe("en");
  });
  it("parses locales", () => {
    expect(baseLanguage("fr-CA")).toBe("fr");
    expect(baseLanguage(null)).toBe("en");
    expect(languageName("de")).toBe("German");
  });
});
