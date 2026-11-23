import { describe, expect, it } from "vitest";
import { suggestTransitDays } from "../app/lib/scorecard";

const D = 86_400_000;
const shipped = new Date("2026-11-01T00:00:00Z");
const row = (carrier: string, days: number, status = "DELIVERED") => ({
  carrier,
  status,
  shippedAt: shipped,
  deliveredAt: new Date(shipped.getTime() + days * D),
});

describe("R2 transit day suggestions", () => {
  it("uses the 80th percentile in business days and needs 5 deliveries", () => {
    const rows = [
      ...[3, 4, 4, 5, 6, 7, 7, 8, 9, 14].map((d) => row("USPS", d)),
      ...[2, 2, 3].map((d) => row("DHL", d)),
      row("USPS", 3, "IN_TRANSIT"),
    ];
    const s = suggestTransitDays(rows);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ carrier: "USPS", deliveries: 10, medianDays: 6 });
    // 80th percentile = 8 calendar days → ceil(8 * 5 / 7) = 6 business days
    expect(s[0].suggestedBusinessDays).toBe(6);
  });
  it("ignores bad data", () => {
    expect(suggestTransitDays([row("X", -1), row("X", 90), { ...row("", 3) }])).toEqual([]);
  });
});
