import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db from "../app/db.server";
import { syncShop } from "../app/services/sync.server";
import { setHandled } from "../app/services/notifier.server";
import type { AdminApi } from "../app/services/admin-types";

const DAY = 86_400_000;
const NOW = new Date("2026-11-20T15:00:00Z"); // 15:00 UTC: inside a 08-20 UTC window
const shops: string[] = [];

function order(n: string, tags: string[], value = "49.00") {
  return {
    id: `gid://shopify/Order/${n}`, legacyResourceId: n, name: `#${n}`, tags, cancelledAt: null, customerLocale: "en",
    totalPriceSet: { shopMoney: { amount: value, currencyCode: "USD" } }, shippingAddress: { countryCodeV2: "US" },
    fulfillments: [{
      id: `gid://shopify/Fulfillment/${n}`, status: "SUCCESS", requiresShipping: true,
      createdAt: new Date(NOW.getTime() - 10 * DAY).toISOString(), inTransitAt: null, deliveredAt: null, estimatedDeliveryAt: null,
      displayStatus: "IN_TRANSIT", trackingInfo: [{ company: "UPS", number: `T${n}`, url: `https://t.test/${n}` }],
      events: { nodes: [{ status: "IN_TRANSIT", happenedAt: new Date(NOW.getTime() - DAY).toISOString() }] },
    }],
  };
}

function admin(orders: unknown[]): AdminApi & { sentTo: number } {
  const a = {
    sentTo: 0,
    async graphql(query: string) {
      const op = /(?:query|mutation) (\w+)/.exec(query)?.[1] ?? "";
      if (op === "DelaywiseOrderContact") a.sentTo++;
      const data: Record<string, unknown> = {
        DelaywiseShopInfo: { shop: { name: "U", contactEmail: "o@u.test", myshopifyDomain: "u", ianaTimezone: "UTC", billingAddress: { countryCodeV2: "US" } }, currentAppInstallation: { activeSubscriptions: [{ name: "Growth", status: "ACTIVE", test: true }] } },
        DelaywiseShippedOrders: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: orders } },
        DelaywiseRefreshFulfillments: { nodes: [] },
        DelaywiseOrderContact: { order: { id: "x", email: "b@u.test", customer: null } },
        DelaywiseFlowTrigger: { flowTriggerReceive: { userErrors: [] } },
        DelaywiseDiscountRedemptions: { orders: { nodes: [] } },
      };
      return new Response(JSON.stringify({ data: data[op] }));
    },
  };
  return a;
}

beforeAll(() => {
  delete process.env.RESEND_API_KEY;
});
afterAll(async () => {
  for (const shop of shops) {
    await db.message.deleteMany({ where: { shop } });
    await db.shipment.deleteMany({ where: { shop } });
    await db.usageMonth.deleteMany({ where: { shop } });
    await db.auditLog.deleteMany({ where: { shop } });
    await db.shopSettings.deleteMany({ where: { shop } });
  }
});

describe("U4 VIP protection", () => {
  it("holds VIP orders for approval even on Autopilot, and sends the rest", async () => {
    const shop = `vip-${Date.now()}.myshopify.com`;
    shops.push(shop);
    await db.shopSettings.create({ data: { shop, mode: "autopilot", vipTags: "vip", vipMinOrderValue: 300 } });
    const a = admin([order("1", ["VIP"]), order("2", [], "450.00"), order("3", [])]);
    await syncShop(a, shop, NOW);
    const ships = await db.shipment.findMany({ where: { shop }, include: { messages: true }, orderBy: { orderName: "asc" } });
    expect(ships.map((s) => s.vip)).toEqual([true, true, false]);
    expect(ships[0].messages[0].status).toBe("pending_approval");
    expect(ships[1].messages[0].status).toBe("pending_approval");
    expect(ships[2].messages[0].status).toBe("sent");
    const held = await db.auditLog.count({ where: { shop, action: "VIP order held for approval" } });
    expect(held).toBe(2);
  });
});

describe("U5 mark as handled", () => {
  it("drops unsent drafts, stops new emails, and can be undone", async () => {
    const shop = `handled-${Date.now()}.myshopify.com`;
    shops.push(shop);
    await db.shopSettings.create({ data: { shop } });
    const a = admin([order("10", [])]);
    await syncShop(a, shop, NOW);
    const s = await db.shipment.findFirstOrThrow({ where: { shop }, include: { messages: true } });
    expect(s.messages[0].status).toBe("pending_approval");

    expect(await setHandled(shop, [s.id], "Staff 1", true)).toBe(1);
    const after = await db.shipment.findFirstOrThrow({ where: { shop }, include: { messages: true } });
    expect(after.handledAt).not.toBeNull();
    expect(after.messages[0].status).toBe("skipped");

    // Later escalation to "lost" sends nothing while handled.
    await syncShop(a, shop, new Date(NOW.getTime() + 20 * DAY));
    expect(await db.message.count({ where: { shop } })).toBe(1);

    await setHandled(shop, [s.id], "Staff 1", false);
    expect((await db.shipment.findUniqueOrThrow({ where: { id: s.id } })).handledAt).toBeNull();
    // Another shop can't touch it.
    expect(await setHandled("other.myshopify.com", [s.id], "x", true)).toBe(0);
  });
});

import { runQuickSetup } from "../app/services/quick-setup.server";

describe("U1 one-click setup", () => {
  it("applies the style, runs the first scan and learns carrier times", async () => {
    const shop = `setup-${Date.now()}.myshopify.com`;
    shops.push(shop);
    await db.shopSettings.create({ data: { shop, merchantDigest: false } });
    // Five delivered UPS parcels that took ~4 days teach the app UPS's real time.
    for (let i = 0; i < 5; i++) {
      await db.shipment.create({
        data: { shop, orderId: `gid://shopify/Order/9${i}`, orderName: `#9${i}`, fulfillmentId: `f9${i}`, carrier: "UPS", trackingNumber: `T9${i}`,
          shippedAt: new Date(NOW.getTime() - 10 * DAY), deliveredAt: new Date(NOW.getTime() - 6 * DAY), status: "DELIVERED" },
      });
    }
    const result = await runQuickSetup({ admin: admin([order("20", [])]), shop, preset: "proactive", autopilot: true, actor: "Staff 1" });
    expect(result.scanned).toBe(true);
    expect(result.mode).toBe("autopilot"); // Growth plan
    expect(result.learnedCarriers).toEqual(["UPS"]);
    const s = await db.shopSettings.findUniqueOrThrow({ where: { shop } });
    expect(s).toMatchObject({ preset: "proactive", stallHours: 48, graceHours: 8, merchantDigest: true, orderStatusNotice: true });
    expect(s.setupDoneAt).not.toBeNull();
    expect(JSON.parse(s.carrierTransitDays!)).toEqual({ ups: 3 });
  });
});
