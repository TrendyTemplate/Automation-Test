import { describe, expect, it } from "vitest";
import { detectIncidents, isVip } from "../app/lib/incidents";

const NOW = new Date("2026-11-20T12:00:00Z");
const H = 3_600_000;
let n = 0;
const row = (carrier: string | null, country: string, risk = "stalled", hoursAgo = 5, extra = {}) => ({
  id: `s${n++}`, carrier, destinationCountry: country, risk, riskSince: new Date(NOW.getTime() - hoursAgo * H),
  orderValue: 10, excluded: false, handledAt: null, ...extra,
});

describe("U3 carrier incidents", () => {
  it("groups recent problems by carrier and country above the threshold", () => {
    const rows = [
      ...Array.from({ length: 6 }, () => row("UPS", "de")),
      row("ups ", "DE", "lost"),
      ...Array.from({ length: 2 }, () => row("UPS", "FR")),
      ...Array.from({ length: 5 }, () => row("DHL", "DE", "watch")),
    ];
    const incidents = detectIncidents(rows, 5, NOW);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ carrier: "UPS", country: "DE", count: 7, worstRisk: "lost", orderValue: 70 });
    expect(incidents[0].shipmentIds).toHaveLength(7);
  });
  it("ignores old, excluded, handled and carrier-less rows", () => {
    const rows = [
      ...Array.from({ length: 3 }, () => row("UPS", "DE")),
      row("UPS", "DE", "stalled", 100),
      row("UPS", "DE", "stalled", 5, { excluded: true }),
      row("UPS", "DE", "stalled", 5, { handledAt: NOW }),
      row(null, "DE"),
    ];
    expect(detectIncidents(rows, 4, NOW)).toEqual([]);
    expect(detectIncidents(rows, 3, NOW)[0].count).toBe(3);
  });
});

describe("U4 VIP orders", () => {
  it("matches tags case-insensitively or order value", () => {
    expect(isVip({ tags: ["VIP"], orderValue: 1 }, "vip, wholesale-vip", 0)).toBe(true);
    expect(isVip({ tags: [], orderValue: 500 }, "vip", 300)).toBe(true);
    expect(isVip({ tags: [], orderValue: 100 }, "vip", 300)).toBe(false);
    expect(isVip({ tags: [], orderValue: 100 }, null, 0)).toBe(false);
  });
});
