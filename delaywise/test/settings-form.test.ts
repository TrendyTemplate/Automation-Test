import { describe, expect, it } from "vitest";
import { PLANS } from "../app/lib/plans";
import { parseSettingsForm } from "../app/lib/settings-form";

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};

describe("settings form", () => {
  it("clamps numbers and cleans text", () => {
    const s = parseSettingsForm(
      form({
        tone: "evil",
        brandName: "  Acme  ",
        defaultTransitDays: "500",
        graceHours: "-4",
        stallHours: "abc",
        replyToEmail: "not-an-email",
        digestEmail: "owner@acme.test",
        brandInstructions: "x".repeat(900),
        excludedCountries: "ca, mx",
        minOrderValue: "-5",
        sendWindowStart: "30",
        carrierTransit: "USPS: 5",
      }),
      PLANS.growth,
    );
    expect(s.tone).toBe("friendly");
    expect(s.brandName).toBe("Acme");
    expect(s.defaultTransitDays).toBe(30);
    expect(s.graceHours).toBe(0);
    expect(s.stallHours).toBe(72);
    expect(s.replyToEmail).toBeNull();
    expect(s.digestEmail).toBe("owner@acme.test");
    expect(s.brandInstructions).toHaveLength(500);
    expect(s.excludedCountries).toBe("CA, MX");
    expect(s.minOrderValue).toBe(0);
    expect(s.sendWindowStart).toBe(23);
    expect(JSON.parse(s.carrierTransitDays!)).toEqual({ usps: 5 });
  });

  it("keeps paid features off on the free plan", () => {
    const s = parseSettingsForm(form({ mode: "autopilot", compensationEnabled: "true" }), PLANS.free);
    expect(s.mode).toBe("approval");
    expect(s.compensationEnabled).toBe(false);
    const paid = parseSettingsForm(form({ mode: "autopilot", compensationEnabled: "true" }), PLANS.starter);
    expect(paid.mode).toBe("autopilot");
    expect(paid.compensationEnabled).toBe(true);
  });
});
