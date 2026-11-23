import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import db from "../app/db.server";
import { syncShop } from "../app/services/sync.server";
import { sendMessage } from "../app/services/notifier.server";
import { roiSummary } from "../app/services/roi.server";
import { applyRetention } from "../app/services/retention.server";
import { gql, setRetrySleepForTests, type AdminApi } from "../app/services/admin-types";

// End-to-end runs of the sync pipeline against the local SQLite database with
// a fake Shopify Admin API. No network: no ANTHROPIC/SHIP24/RESEND keys are
// set, so the template writer and the dev email logger are used.

const RUN = Date.now();
const DAY = 86_400_000;
const NOW = new Date("2026-11-20T15:00:00Z"); // 10:00 in New York

interface FakeFulfillment {
  id: string;
  createdAt: string;
  displayStatus: string;
  deliveredAt: string | null;
  events: { status: string; happenedAt: string }[];
  carrier: string;
}
interface FakeOrder {
  n: string;
  locale: string;
  country: string;
  tags?: string[];
  value?: string;
  f: FakeFulfillment;
}

interface FakeShop {
  domain: string;
  plan: string | null;
  orders: FakeOrder[];
  redeemedCodes: string[];
  calls: { op: string; variables?: Record<string, unknown> }[];
  throttleFirst?: number;
}

function fakeAdmin(shop: FakeShop): AdminApi {
  return {
    async graphql(query, options) {
      const name = /query (\w+)|mutation (\w+)/.exec(query);
      const op = name?.[1] ?? name?.[2] ?? "unknown";
      shop.calls.push({ op, variables: options?.variables });
      if (shop.throttleFirst && shop.throttleFirst > 0) {
        shop.throttleFirst--;
        return new Response(JSON.stringify({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }));
      }
      let data: unknown;
      switch (op) {
        case "DelaywiseShopInfo":
          data = {
            shop: {
              name: "Acme Socks",
              contactEmail: "owner@acme.test",
              myshopifyDomain: shop.domain,
              ianaTimezone: "America/New_York",
              billingAddress: { countryCodeV2: "US" },
            },
            currentAppInstallation: {
              activeSubscriptions: shop.plan ? [{ name: shop.plan, status: "ACTIVE", test: true }] : [],
            },
          };
          break;
        case "DelaywiseShippedOrders":
          data = {
            orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: shop.orders.map(toNode) },
          };
          break;
        case "DelaywiseCreateSorryDiscount":
          data = { discountCodeBasicCreate: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/9" }, userErrors: [] } };
          break;
        case "DelaywiseOrderContact":
          data = { order: { id: options?.variables?.id, email: "buyer@example.test" } };
          break;
        case "DelaywiseFlowTrigger":
          data = { flowTriggerReceive: { userErrors: [] } };
          break;
        case "DelaywiseDiscountRedemptions":
          data = {
            orders: {
              nodes: shop.redeemedCodes.map((code, i) => ({
                name: `#20${i}`,
                createdAt: NOW.toISOString(),
                discountCodes: [code.toLowerCase()],
                totalPriceSet: { shopMoney: { amount: "80.00" } },
              })),
            },
          };
          break;
        default:
          throw new Error(`unexpected operation ${op}`);
      }
      return new Response(JSON.stringify({ data }));
    },
  };
}

function toNode(o: FakeOrder) {
  return {
    id: `gid://shopify/Order/${o.n}`,
    legacyResourceId: o.n,
    name: `#${o.n}`,
    tags: o.tags ?? [],
    cancelledAt: null,
    customerLocale: o.locale,
    totalPriceSet: { shopMoney: { amount: o.value ?? "49.90", currencyCode: "USD" } },
    shippingAddress: { countryCodeV2: o.country },
    fulfillments: [
      {
        id: o.f.id,
        createdAt: o.f.createdAt,
        inTransitAt: null,
        deliveredAt: o.f.deliveredAt,
        estimatedDeliveryAt: null,
        displayStatus: o.f.displayStatus,
        trackingInfo: [{ company: o.f.carrier, number: `TRK${o.n}`, url: `https://track.test/${o.n}` }],
        events: { nodes: o.f.events },
      },
    ],
  };
}

const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const shops: string[] = [];

function newShop(plan: string | null, orders: FakeOrder[]): FakeShop {
  const domain = `test-${RUN}-${shops.length}.myshopify.com`;
  shops.push(domain);
  return { domain, plan, orders, redeemedCodes: [], calls: [] };
}

beforeAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.SHIP24_API_KEY;
  delete process.env.RESEND_API_KEY;
  setRetrySleepForTests(async () => {});
});

afterAll(async () => {
  for (const shop of shops) {
    await db.message.deleteMany({ where: { shop } });
    await db.shipment.deleteMany({ where: { shop } });
    await db.usageMonth.deleteMany({ where: { shop } });
    await db.shopSettings.deleteMany({ where: { shop } });
  }
  await db.$disconnect();
});

describe("core pipeline (approval mode, Growth plan)", () => {
  const shop = newShop("Growth", [
    { n: "1001", locale: "de-DE", country: "DE", f: { id: "gid://shopify/Fulfillment/1", createdAt: ago(20), displayStatus: "FULFILLED", deliveredAt: null, events: [], carrier: "DHL Express" } },
    { n: "1002", locale: "en", country: "US", f: { id: "gid://shopify/Fulfillment/2", createdAt: ago(6), displayStatus: "DELIVERED", deliveredAt: ago(2), events: [{ status: "DELIVERED", happenedAt: ago(2) }], carrier: "UPS" } },
    { n: "1003", locale: "fr", country: "US", f: { id: "gid://shopify/Fulfillment/3", createdAt: ago(5), displayStatus: "IN_TRANSIT", deliveredAt: null, events: [{ status: "IN_TRANSIT", happenedAt: ago(4) }], carrier: "UPS" } },
    { n: "1004", locale: "en", country: "US", tags: ["Wholesale"], f: { id: "gid://shopify/Fulfillment/4", createdAt: ago(20), displayStatus: "IN_TRANSIT", deliveredAt: null, events: [{ status: "IN_TRANSIT", happenedAt: ago(19) }], carrier: "USPS" } },
  ]);

  beforeAll(async () => {
    await db.shopSettings.create({
      data: { shop: shop.domain, compensationEnabled: true, compensationMinDaysLate: 1, excludedTags: "wholesale" },
    });
  });

  it("finds late and stalled parcels and drafts messages in the customer's language", async () => {
    const summary = await syncShop(fakeAdmin(shop), shop.domain, NOW);
    expect(summary.shipmentsSeen).toBe(4);
    expect(summary.newShipments).toBe(4);

    const settings = await db.shopSettings.findUniqueOrThrow({ where: { shop: shop.domain } });
    expect(settings.plan).toBe("growth");
    expect(settings.timezone).toBe("America/New_York");
    expect(settings.digestEmail).toBe("owner@acme.test");
    expect(settings.lastScanAt?.toISOString()).toBe(NOW.toISOString()); // F12

    const late = await db.shipment.findFirstOrThrow({ where: { shop: shop.domain, orderName: "#1001" } });
    expect(late.risk).toBe("delayed");
    const stalled = await db.shipment.findFirstOrThrow({ where: { shop: shop.domain, orderName: "#1003" } });
    expect(stalled.risk).toBe("stalled");

    const messages = await db.message.findMany({ where: { shop: shop.domain } });
    expect(messages).toHaveLength(2);
    const german = messages.find((m) => m.shipmentId === late.id)!;
    expect(german.language).toBe("de");
    expect(german.status).toBe("pending_approval");
    expect(german.discountCode).toMatch(/^SORRY-[0-9A-F]{6}$/);
    expect(german.body).toContain(german.discountCode!);
    expect(messages.find((m) => m.shipmentId === stalled.id)!.discountCode).toBeNull();
  });

  it("F5: excluded orders are tracked but never emailed", async () => {
    const wholesale = await db.shipment.findFirstOrThrow({ where: { shop: shop.domain, orderName: "#1004" } });
    expect(wholesale.excluded).toBe(true);
    expect(wholesale.excludedReason).toContain("wholesale");
    expect(wholesale.risk).toBe("lost"); // 13 days past a 7-day domestic estimate
    expect(await db.message.count({ where: { shipmentId: wholesale.id } })).toBe(0);
  });

  it("F1: fires the Flow trigger once per escalation, never for excluded orders", async () => {
    const flows = shop.calls.filter((c) => c.op === "DelaywiseFlowTrigger");
    expect(flows).toHaveLength(2);
    const payload = flows[0].variables!.payload as Record<string, unknown>;
    expect(payload.order_id).toBeTypeOf("number");
    expect(Object.keys(payload)).toEqual(
      expect.arrayContaining(["Risk level", "Reason", "Days late", "Carrier", "Tracking number", "Tracking URL"]),
    );
    const orderIds = flows.map((f) => (f.variables!.payload as { order_id: number }).order_id);
    expect(orderIds).not.toContain(1004);
  });

  it("does not message or trigger twice for the same problem", async () => {
    const before = shop.calls.filter((c) => c.op === "DelaywiseFlowTrigger").length;
    const summary = await syncShop(fakeAdmin(shop), shop.domain, new Date(NOW.getTime() + 3_600_000));
    expect(summary.newShipments).toBe(0);
    expect(summary.messagesCreated).toBe(0);
    expect(shop.calls.filter((c) => c.op === "DelaywiseFlowTrigger").length).toBe(before);
  });

  it("sends an approved message without storing the customer email", async () => {
    const message = await db.message.findFirstOrThrow({ where: { shop: shop.domain, language: "de" } });
    const result = await sendMessage(fakeAdmin(shop), message.id, { body: `${message.body}\n\nP.S. edited` });
    expect(result.ok).toBe(true);
    const sent = await db.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(sent.status).toBe("sent");
    expect(sent.body).toContain("P.S. edited");
    expect(JSON.stringify(await db.shipment.findMany({ where: { shop: shop.domain } }))).not.toContain("buyer@example.test");
  });

  it("F11: records when an apology discount turns into an order", async () => {
    const message = await db.message.findFirstOrThrow({ where: { shop: shop.domain, language: "de" } });
    shop.redeemedCodes = [message.discountCode!];
    const summary = await syncShop(fakeAdmin(shop), shop.domain, new Date(NOW.getTime() + 2 * 3_600_000));
    expect(summary.discountsRedeemed).toBe(1);
    const roi = await roiSummary(shop.domain);
    expect(roi).toMatchObject({ emailsSent: 1, discountsSent: 1, discountsRedeemed: 1, revenueRecovered: 80 });
  });

  it("F2: sends a follow-up after a warned-about parcel is delivered, once", async () => {
    shop.orders[0].f = {
      ...shop.orders[0].f,
      displayStatus: "DELIVERED",
      deliveredAt: new Date(NOW.getTime() + 2 * DAY).toISOString(),
      events: [{ status: "DELIVERED", happenedAt: new Date(NOW.getTime() + 2 * DAY).toISOString() }],
    };
    const at = new Date(NOW.getTime() + 2 * DAY + 3_600_000);
    const first = await syncShop(fakeAdmin(shop), shop.domain, at);
    expect(first.followUps).toBe(1);
    const followUp = await db.message.findFirstOrThrow({ where: { shop: shop.domain, kind: "delivered" } });
    expect(followUp.language).toBe("de");
    expect(followUp.discountCode).toBeNull();
    const second = await syncShop(fakeAdmin(shop), shop.domain, new Date(at.getTime() + 3_600_000));
    expect(second.followUps).toBe(0);
    // The French customer was never actually emailed (still pending), so no follow-up for them.
  });

  it("records monthly usage", async () => {
    const usage = await db.usageMonth.findFirstOrThrow({ where: { shop: shop.domain } });
    expect(usage.shipmentsTracked).toBe(4);
    expect(usage.messagesSent).toBe(1);
  });
});

describe("autopilot, send window and carrier transit days", () => {
  const shop = newShop("Starter", [
    // Shipped 4 days ago by "Speedy": late only if Speedy promises 2 days.
    { n: "2001", locale: "es", country: "US", f: { id: "gid://shopify/Fulfillment/21", createdAt: ago(4), displayStatus: "FULFILLED", deliveredAt: null, events: [], carrier: "Speedy Post" } },
  ]);

  beforeAll(async () => {
    await db.shopSettings.create({
      data: { shop: shop.domain, mode: "autopilot", sendWindowStart: 8, sendWindowEnd: 20, carrierTransitDays: JSON.stringify({ speedy: 1 }) },
    });
  });

  it("F7 + F6: uses the carrier's transit time and queues emails outside the send window", async () => {
    const threeAmNewYork = new Date("2026-11-20T08:00:00Z");
    await syncShop(fakeAdmin(shop), shop.domain, threeAmNewYork);
    const s = await db.shipment.findFirstOrThrow({ where: { shop: shop.domain } });
    expect(s.risk).toBe("delayed");
    const m = await db.message.findFirstOrThrow({ where: { shop: shop.domain } });
    expect(m.status).toBe("scheduled");
    expect(m.scheduledFor?.toISOString()).toBe("2026-11-20T13:00:00.000Z");
  });

  it("R1: the holiday buffer pushes the expected date back", async () => {
    const before = await db.shipment.findFirstOrThrow({ where: { shop: shop.domain } });
    await db.shopSettings.update({ where: { shop: shop.domain }, data: { extraTransitDays: 2 } });
    await syncShop(fakeAdmin(shop), shop.domain, new Date("2026-11-20T08:10:00Z"));
    const after = await db.shipment.findFirstOrThrow({ where: { shop: shop.domain } });
    // 1 → 3 business days: ceil(3 * 7 / 5) - ceil(1 * 7 / 5) = 5 - 2 = 3 more calendar days
    expect(after.expectedBy!.getTime() - before.expectedBy!.getTime()).toBe(3 * 86_400_000);
    await db.shopSettings.update({ where: { shop: shop.domain }, data: { extraTransitDays: 0 } });
  });

  it("F6: sends the queued email once the window opens", async () => {
    const summary = await syncShop(fakeAdmin(shop), shop.domain, new Date("2026-11-20T13:30:00Z"));
    expect(summary.scheduledSent).toBe(1);
    const m = await db.message.findFirstOrThrow({ where: { shop: shop.domain } });
    expect(m.status).toBe("sent");
  });
});

describe("F14: retries when Shopify throttles", () => {
  it("retries throttled calls and then succeeds", async () => {
    const shop = newShop(null, []);
    shop.throttleFirst = 2;
    const data = await gql<{ shop: { name: string } }>(fakeAdmin(shop), "query DelaywiseShopInfo { shop { name } }");
    expect(data.shop.name).toBe("Acme Socks");
    expect(shop.calls).toHaveLength(3);
  });

  it("gives up after repeated throttling", async () => {
    const shop = newShop(null, []);
    shop.throttleFirst = 10;
    await expect(gql(fakeAdmin(shop), "query DelaywiseShopInfo { shop { name } }")).rejects.toThrow(/THROTTLED/);
  });
});

describe("F13: retention", () => {
  beforeEach(() => undefined);
  it("deletes shipments older than 90 days", async () => {
    const shop = newShop(null, []);
    await db.shipment.create({
      data: { shop: shop.domain, orderId: "gid://shopify/Order/9", orderName: "#9", fulfillmentId: "gid://shopify/Fulfillment/9", shippedAt: new Date(NOW.getTime() - 120 * DAY) },
    });
    const result = await applyRetention(NOW);
    expect(result.shipments).toBeGreaterThanOrEqual(1);
    expect(await db.shipment.count({ where: { shop: shop.domain } })).toBe(0);
  });
});
