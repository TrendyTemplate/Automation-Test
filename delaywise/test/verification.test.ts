import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import db from "../app/db.server";
import { recoverStuckSends, sendMessage, STUCK_SEND_MS } from "../app/services/notifier.server";
import { applyPlan } from "../app/services/settings.server";
import { ScanInProgressError, syncShop } from "../app/services/sync.server";
import type { AdminApi } from "../app/services/admin-types";

const RUN = Date.now();
const shops: string[] = [];
const shopName = (tag: string) => {
  const s = `verify-${tag}-${RUN}.myshopify.com`;
  shops.push(s);
  return s;
};
const DAY = 86_400_000;
const NOW = new Date("2026-11-20T15:00:00Z");

function admin(opts: { orders?: unknown[]; nodes?: unknown[] } = {}): AdminApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async graphql(query: string, o?: { variables?: Record<string, unknown> }) {
      const op = /(?:query|mutation) (\w+)/.exec(query)?.[1] ?? "";
      calls.push(op);
      const data: Record<string, unknown> = {
        DelaywiseShopInfo: { shop: { name: "V", contactEmail: "o@v.test", myshopifyDomain: "v", ianaTimezone: "UTC", billingAddress: { countryCodeV2: "US" } }, currentAppInstallation: { activeSubscriptions: [{ name: "Growth", status: "ACTIVE", test: true }] } },
        DelaywiseShippedOrders: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: opts.orders ?? [] } },
        DelaywiseRefreshFulfillments: { nodes: opts.nodes ?? ((o?.variables?.ids as string[]) ?? []).map(() => null) },
        DelaywiseOrderContact: { order: { id: "x", email: "buyer@v.test", customer: { id: "gid://shopify/Customer/1" } } },
        DelaywiseCreateSorryDiscount: { discountCodeBasicCreate: { codeDiscountNode: { id: "d" }, userErrors: [] } },
        DelaywiseFlowTrigger: { flowTriggerReceive: { userErrors: [] } },
        DelaywiseDiscountRedemptions: { orders: { nodes: [] } },
      };
      return new Response(JSON.stringify({ data: data[op] }));
    },
  };
}

async function seedMessage(shop: string, extra: Record<string, unknown> = {}) {
  await db.shopSettings.upsert({ where: { shop }, update: {}, create: { shop, plan: "growth" } });
  const s = await db.shipment.create({
    data: { shop, orderId: "gid://shopify/Order/9", orderName: "#9", fulfillmentId: `f-${Math.random()}`, shippedAt: NOW, status: "IN_TRANSIT", trackingNumber: "T9" },
  });
  return db.message.create({
    data: { shop, shipmentId: s.id, kind: "delayed", language: "en", subject: "S", body: "Body with SORRY-ABCDEF inside", ...extra },
  });
}

beforeAll(() => {
  delete process.env.RESEND_API_KEY;
});
afterAll(async () => {
  for (const shop of shops) {
    await db.message.deleteMany({ where: { shop } });
    await db.shipment.deleteMany({ where: { shop } });
    await db.usageMonth.deleteMany({ where: { shop } });
    await db.shopSettings.deleteMany({ where: { shop } });
  }
});

describe("verification fixes", () => {
  it("V-H1: a sent email stays 'sent' even if usage counting fails", async () => {
    const shop = shopName("h1");
    const m = await seedMessage(shop);
    const spy = vi.spyOn(db.usageMonth, "update").mockRejectedValueOnce(new Error("database is locked"));
    const result = await sendMessage(admin(), shop, m.id);
    spy.mockRestore();
    expect(result.ok).toBe(true);
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("sent");
  });

  it("V-M1: interrupted sends become visible as failed and are not auto-retried", async () => {
    const shop = shopName("m1");
    const m = await seedMessage(shop, { status: "sending", sendingSince: new Date(NOW.getTime() - STUCK_SEND_MS - 1000) });
    expect(await recoverStuckSends(shop, NOW)).toBe(1);
    const after = await db.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe("failed");
    expect(after.attempts).toBe(3);
    expect(after.error).toContain("interrupted");
  });

  it("V-4: after a downgrade, a draft with a code is not sent (and no code is created)", async () => {
    const shop = shopName("d4");
    const m = await seedMessage(shop, { discountCode: "SORRY-ABCDEF", discountPercent: 10 });
    await applyPlan(shop, "free");
    const a = admin();
    const r = await sendMessage(a, shop, m.id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("paid plan");
    expect(a.calls).not.toContain("DelaywiseCreateSorryDiscount");
    // Removing the code from the text lets it go out.
    const r2 = await sendMessage(a, shop, m.id, { body: "Body without the code, sorry for the wait." });
    expect(r2.ok).toBe(true);
  });

  it("V-6: a plan downgrade switches off paid features and returns scheduled emails to approval", async () => {
    const shop = shopName("p6");
    const m = await seedMessage(shop, { status: "scheduled", scheduledFor: NOW });
    await db.shopSettings.update({ where: { shop }, data: { mode: "autopilot", compensationEnabled: true } });
    const s = await applyPlan(shop, "free");
    expect(s.mode).toBe("approval");
    expect(s.compensationEnabled).toBe(false);
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("pending_approval");
  });

  it("sendMessage refuses another shop's message", async () => {
    const shop = shopName("mt");
    const m = await seedMessage(shop);
    const r = await sendMessage(admin(), "someone-else.myshopify.com", m.id);
    expect(r.ok).toBe(false);
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("pending_approval");
  });

  it("V-2: a scan can't release a lock it doesn't own", async () => {
    const shop = shopName("lock");
    await db.shopSettings.create({ data: { shop, scanLockUntil: new Date(Date.now() + 60_000), scanLockToken: "someone-else" } });
    await expect(syncShop(admin(), shop, NOW)).rejects.toBeInstanceOf(ScanInProgressError);
    const s = await db.shopSettings.findUniqueOrThrow({ where: { shop } });
    expect(s.scanLockToken).toBe("someone-else");
    expect(s.scanLockUntil).not.toBeNull();
  });

  it("V-H2: a parcel already long overdue at first import gets no automatic email", async () => {
    const shop = shopName("h2");
    await db.shopSettings.create({ data: { shop } });
    const order = {
      id: "gid://shopify/Order/71", legacyResourceId: "71", name: "#71", tags: [], cancelledAt: null, customerLocale: "en",
      totalPriceSet: { shopMoney: { amount: "10", currencyCode: "USD" } }, shippingAddress: { countryCodeV2: "US" },
      fulfillments: [{
        id: "gid://shopify/Fulfillment/71", status: "SUCCESS", requiresShipping: true,
        createdAt: new Date(NOW.getTime() - 30 * DAY).toISOString(), inTransitAt: null, deliveredAt: null, estimatedDeliveryAt: null,
        displayStatus: "IN_TRANSIT", trackingInfo: [{ company: "UPS", number: "T71", url: null }],
        events: { nodes: [{ status: "IN_TRANSIT", happenedAt: new Date(NOW.getTime() - 29 * DAY).toISOString() }] },
      }],
    };
    const a = admin({ orders: [order] });
    const summary = await syncShop(a, shop, NOW);
    expect(summary.newShipments).toBe(1);
    expect(summary.messagesCreated).toBe(0);
    expect(a.calls).not.toContain("DelaywiseFlowTrigger");
    const s = await db.shipment.findFirstOrThrow({ where: { shop } });
    expect(s.risk).toBe("lost");
    expect(s.riskReason).toContain("check it manually".replace("check", "Check"));
  });

  it("V-M4: a fulfillment that no longer exists is closed, not refreshed forever", async () => {
    const shop = shopName("m4");
    await db.shopSettings.create({ data: { shop } });
    const s = await db.shipment.create({
      data: { shop, orderId: "gid://shopify/Order/81", orderName: "#81", fulfillmentId: "gid://shopify/Fulfillment/81", shippedAt: new Date(NOW.getTime() - 3 * DAY), status: "IN_TRANSIT", trackingNumber: "T81" },
    });
    const summary = await syncShop(admin({ nodes: [null] }), shop, NOW);
    expect(summary.refreshed).toBe(0);
    expect((await db.shipment.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("CANCELED");
  });
});
