import { afterAll, describe, expect, it } from "vitest";
import db from "../app/db.server";
import { buildDigest, localDateKey, shouldSendDigest } from "../app/lib/digest";
import { maybeSendDigest } from "../app/services/digest.server";

const base = {
  storeName: "Acme",
  appUrl: "https://admin.shopify.com/store/acme/apps/delaywise",
  pendingApprovals: 0,
  sentYesterday: 2,
};
const ship = (orderName: string, risk: string, orderValue = 10) => ({
  orderName,
  risk,
  reason: "Past the expected delivery date",
  carrier: "UPS",
  orderValue,
  currency: "USD",
});

describe("F3 digest builder", () => {
  it("skips empty days", () => {
    expect(shouldSendDigest({ ...base, atRisk: [] })).toBe(false);
    expect(shouldSendDigest({ ...base, atRisk: [], pendingApprovals: 1 })).toBe(true);
  });
  it("orders by severity and totals value", () => {
    const d = buildDigest({ ...base, atRisk: [ship("#1", "stalled", 5), ship("#2", "lost", 20)], pendingApprovals: 3 });
    expect(d.subject).toBe("2 order(s) at risk today, Acme");
    expect(d.text).toContain("1 probably lost, 1 stalled");
    expect(d.text).toContain("worth 25.00 USD");
    expect(d.text).toContain("3 customer email(s) are waiting");
    expect(d.text.indexOf("#2")).toBeLessThan(d.text.indexOf("#1"));
  });
  it("U3: calls out carrier incidents", () => {
    const d = buildDigest({ ...base, atRisk: [ship("#1", "stalled")], incidents: [{ carrier: "UPS", country: "DE", count: 7 }] });
    expect(d.text).toContain("Possible carrier incident: UPS → DE, 7 parcels");
  });
  it("caps the list at 15", () => {
    const many = Array.from({ length: 20 }, (_, i) => ship(`#${i}`, "delayed"));
    expect(buildDigest({ ...base, atRisk: many }).text).toContain("…and 5 more.");
  });
  it("uses local dates", () => {
    const lateEveningUtc = new Date("2026-11-21T03:00:00Z");
    expect(localDateKey(lateEveningUtc, "America/New_York")).toBe("2026-11-20");
  });
});

describe("F3 digest sending", () => {
  const shop = `digest-${Date.now()}.myshopify.com`;
  afterAll(async () => {
    await db.shipment.deleteMany({ where: { shop } });
    await db.shopSettings.deleteMany({ where: { shop } });
  });

  it("sends once per local day after the send window opens", async () => {
    delete process.env.RESEND_API_KEY;
    await db.shopSettings.create({ data: { shop, digestEmail: "owner@acme.test", timezone: "America/New_York" } });
    await db.shipment.create({
      data: { shop, orderId: "gid://shopify/Order/1", orderName: "#1", fulfillmentId: "f1", shippedAt: new Date(), status: "IN_TRANSIT", risk: "delayed" },
    });
    expect(await maybeSendDigest(shop, new Date("2026-11-20T10:00:00Z"))).toBe(false); // 05:00 local
    expect(await maybeSendDigest(shop, new Date("2026-11-20T14:00:00Z"))).toBe(true); // 09:00 local
    expect(await maybeSendDigest(shop, new Date("2026-11-20T20:00:00Z"))).toBe(false); // same local day
    expect(await maybeSendDigest(shop, new Date("2026-11-21T14:00:00Z"))).toBe(true); // next day
  });
});
