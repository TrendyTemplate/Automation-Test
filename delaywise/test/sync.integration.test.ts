import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db from "../app/db.server";
import { syncShop } from "../app/services/sync.server";
import { sendMessage } from "../app/services/notifier.server";
import type { AdminApi } from "../app/services/admin-types";

// End-to-end run of the sync pipeline against the local SQLite database with a
// fake Shopify Admin API. No network: no ANTHROPIC/SHIP24/RESEND keys are set,
// so the template writer and the dev email logger are used.

const SHOP = `test-${Date.now()}.myshopify.com`;
const NOW = new Date("2026-11-20T12:00:00Z");
const DAY = 86_400_000;
const calls: string[] = [];

function fakeAdmin(planName: string | null): AdminApi {
  return {
    async graphql(query, options) {
      const name = /query (\w+)|mutation (\w+)/.exec(query);
      const op = name?.[1] ?? name?.[2] ?? "unknown";
      calls.push(op);
      let data: unknown;
      switch (op) {
        case "DelaywiseShopInfo":
          data = {
            shop: { name: "Acme Socks", contactEmail: "help@acme.test", myshopifyDomain: SHOP, billingAddress: { countryCodeV2: "US" } },
            currentAppInstallation: {
              activeSubscriptions: planName ? [{ name: planName, status: "ACTIVE", test: true }] : [],
            },
          };
          break;
        case "DelaywiseShippedOrders":
          data = {
            orders: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                order("1001", "de-DE", "DE", {
                  id: "gid://shopify/Fulfillment/1",
                  createdAt: new Date(NOW.getTime() - 20 * DAY).toISOString(),
                  displayStatus: "FULFILLED",
                  deliveredAt: null,
                  events: [],
                }),
                order("1002", "en", "US", {
                  id: "gid://shopify/Fulfillment/2",
                  createdAt: new Date(NOW.getTime() - 6 * DAY).toISOString(),
                  displayStatus: "DELIVERED",
                  deliveredAt: new Date(NOW.getTime() - 2 * DAY).toISOString(),
                  events: [{ status: "DELIVERED", happenedAt: new Date(NOW.getTime() - 2 * DAY).toISOString() }],
                }),
                order("1003", "fr", "US", {
                  id: "gid://shopify/Fulfillment/3",
                  createdAt: new Date(NOW.getTime() - 5 * DAY).toISOString(),
                  displayStatus: "IN_TRANSIT",
                  deliveredAt: null,
                  events: [{ status: "IN_TRANSIT", happenedAt: new Date(NOW.getTime() - 4 * DAY).toISOString() }],
                }),
              ],
            },
          };
          break;
        case "DelaywiseCreateSorryDiscount":
          expect(options?.variables).toBeDefined();
          data = { discountCodeBasicCreate: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/9" }, userErrors: [] } };
          break;
        case "DelaywiseOrderContact":
          data = { order: { id: options?.variables?.id, email: "buyer@example.test" } };
          break;
        default:
          throw new Error(`unexpected operation ${op}`);
      }
      return new Response(JSON.stringify({ data }));
    },
  };
}

function order(
  n: string,
  locale: string,
  country: string,
  f: { id: string; createdAt: string; displayStatus: string; deliveredAt: string | null; events: { status: string; happenedAt: string }[] },
) {
  return {
    id: `gid://shopify/Order/${n}`,
    name: `#${n}`,
    customerLocale: locale,
    totalPriceSet: { shopMoney: { amount: "49.90", currencyCode: "USD" } },
    shippingAddress: { countryCodeV2: country },
    fulfillments: [
      {
        id: f.id,
        createdAt: f.createdAt,
        inTransitAt: null,
        deliveredAt: f.deliveredAt,
        estimatedDeliveryAt: null,
        displayStatus: f.displayStatus,
        trackingInfo: [{ company: n === "1003" ? "UPS" : "DHL Express", number: `TRK${n}`, url: `https://track.test/${n}` }],
        events: { nodes: f.events },
      },
    ],
  };
}

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.SHIP24_API_KEY;
  delete process.env.RESEND_API_KEY;
  await db.shopSettings.create({
    data: { shop: SHOP, compensationEnabled: true, compensationMinDaysLate: 1 },
  });
});

afterAll(async () => {
  await db.message.deleteMany({ where: { shop: SHOP } });
  await db.shipment.deleteMany({ where: { shop: SHOP } });
  await db.usageMonth.deleteMany({ where: { shop: SHOP } });
  await db.shopSettings.deleteMany({ where: { shop: SHOP } });
  await db.$disconnect();
});

describe("syncShop", () => {
  it("finds late and stalled parcels and drafts messages in the customer's language", async () => {
    const summary = await syncShop(fakeAdmin("Growth"), SHOP, NOW);
    expect(summary.shipmentsSeen).toBe(3);
    expect(summary.newShipments).toBe(3);

    const settings = await db.shopSettings.findUniqueOrThrow({ where: { shop: SHOP } });
    expect(settings.plan).toBe("growth");
    expect(settings.shopName).toBe("Acme Socks");

    const late = await db.shipment.findFirstOrThrow({ where: { shop: SHOP, orderName: "#1001" } });
    // International order (US → DE), no carrier data, 20 days after shipping → delayed.
    expect(late.risk).toBe("delayed");
    const stalled = await db.shipment.findFirstOrThrow({ where: { shop: SHOP, orderName: "#1003" } });
    expect(stalled.risk).toBe("stalled");
    const delivered = await db.shipment.findFirstOrThrow({ where: { shop: SHOP, orderName: "#1002" } });
    expect(delivered.risk).toBe("none");

    const messages = await db.message.findMany({ where: { shop: SHOP }, orderBy: { createdAt: "asc" } });
    expect(messages).toHaveLength(2);
    const german = messages.find((m) => m.shipmentId === late.id)!;
    expect(german.language).toBe("de");
    expect(german.status).toBe("pending_approval");
    expect(german.discountCode).toMatch(/^SORRY-[0-9A-F]{6}$/);
    expect(german.body).toContain(german.discountCode!);
    const french = messages.find((m) => m.shipmentId === stalled.id)!;
    expect(french.language).toBe("fr");
    expect(french.discountCode).toBeNull(); // no discount for a stall
  });

  it("does not message the same customer twice for the same problem", async () => {
    const summary = await syncShop(fakeAdmin("Growth"), SHOP, new Date(NOW.getTime() + 3_600_000));
    expect(summary.newShipments).toBe(0);
    expect(summary.messagesCreated).toBe(0);
  });

  it("sends an approved message without storing the customer email", async () => {
    const message = await db.message.findFirstOrThrow({ where: { shop: SHOP, language: "de" } });
    const result = await sendMessage(fakeAdmin("Growth"), message.id, { body: `${message.body}\n\nP.S. edited` });
    expect(result.ok).toBe(true);
    const sent = await db.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(sent.status).toBe("sent");
    expect(sent.body).toContain("P.S. edited");
    const everything = JSON.stringify(await db.shipment.findMany({ where: { shop: SHOP } }));
    expect(everything).not.toContain("buyer@example.test");
  });

  it("records monthly usage", async () => {
    const usage = await db.usageMonth.findFirstOrThrow({ where: { shop: SHOP } });
    expect(usage.shipmentsTracked).toBe(3);
    expect(usage.messagesSent).toBe(1);
  });
});
