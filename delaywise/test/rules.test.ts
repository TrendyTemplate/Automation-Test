import { describe, expect, it } from "vitest";
import {
  carrierTransitFromText,
  carrierTransitToText,
  exclusionReason,
  inSendWindow,
  localHour,
  nextSendTime,
  parseCarrierTransit,
  parseList,
  transitDaysFor,
} from "../app/lib/rules";

describe("F5 exclusions", () => {
  const settings = { excludedTags: "Wholesale, VIP", excludedCountries: "ca,mx", minOrderValue: 10 };
  it("parses lists", () => {
    expect(parseList(" a, B ,\n c,, ")).toEqual(["a", "b", "c"]);
  });
  it("excludes by tag, country and value", () => {
    expect(exclusionReason({ tags: ["vip"], countryCode: "US", orderValue: 50 }, settings)).toContain("vip");
    expect(exclusionReason({ tags: [], countryCode: "CA", orderValue: 50 }, settings)).toContain("CA");
    expect(exclusionReason({ tags: [], countryCode: "US", orderValue: 5 }, settings)).toContain("below");
    expect(exclusionReason({ tags: ["gift"], countryCode: "US", orderValue: 50 }, settings)).toBeNull();
  });
});

describe("F7 carrier transit days", () => {
  it("round-trips the settings text", () => {
    const json = carrierTransitFromText("USPS: 5, DHL Express = 2\nbad line, Royal Mail: 99");
    expect(parseCarrierTransit(json)).toEqual({ usps: 5, "dhl express": 2, "royal mail": 60 });
    expect(carrierTransitToText(json)).toBe("usps: 5, dhl express: 2, royal mail: 60");
    expect(carrierTransitFromText("nothing useful")).toBeNull();
  });
  it("ignores invalid JSON", () => {
    expect(parseCarrierTransit("{oops")).toEqual({});
    expect(parseCarrierTransit('{"x": -1}')).toEqual({});
  });
  it("matches carriers exactly, then partially", () => {
    const table = { usps: 5, "dhl express": 2, dhl: 4 };
    expect(transitDaysFor("USPS", table, 7)).toBe(5);
    expect(transitDaysFor("DHL Express", table, 7)).toBe(2);
    expect(transitDaysFor("DHL eCommerce", table, 7)).toBe(4);
    expect(transitDaysFor("FedEx", table, 7)).toBe(7);
    expect(transitDaysFor(null, table, 7)).toBe(7);
  });
});

describe("F6 send window", () => {
  const ny = "America/New_York";
  it("reads local hours", () => {
    expect(localHour(new Date("2026-11-20T15:00:00Z"), ny)).toBe(10);
    expect(localHour(new Date("2026-11-20T15:00:00Z"), "Not/AZone")).toBe(15);
  });
  it("checks windows, including overnight ones", () => {
    const tenAm = new Date("2026-11-20T15:00:00Z");
    const threeAm = new Date("2026-11-20T08:00:00Z");
    expect(inSendWindow(tenAm, ny, 8, 20)).toBe(true);
    expect(inSendWindow(threeAm, ny, 8, 20)).toBe(false);
    expect(inSendWindow(threeAm, ny, 22, 6)).toBe(true);
    expect(inSendWindow(threeAm, ny, 0, 0)).toBe(true);
  });
  it("finds the next allowed time", () => {
    const threeAm = new Date("2026-11-20T08:00:00Z"); // 03:00 in New York
    const next = nextSendTime(threeAm, ny, 8, 20);
    expect(next.toISOString()).toBe("2026-11-20T13:00:00.000Z"); // 08:00 New York
    const tenAm = new Date("2026-11-20T15:00:00Z");
    expect(nextSendTime(tenAm, ny, 8, 20)).toBe(tenAm);
  });
});
