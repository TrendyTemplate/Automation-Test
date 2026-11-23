import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../app/lib/crypto";
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
  requiresShipping?: boolean;
  noTracking?: boolean;
  fulfillmentStatus?: string;
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
  /** Orders the order search no longer returns (H4), still reachable by ID. */
  hidden?: FakeOrder[];
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
          data = { order: { id: options?.variables?.id, email: "buyer@example.test", customer: { id: "gid://shopify/Customer/77" } } };
          break;
        case "DelaywiseRefreshFulfillments": {
          const ids = (options?.variables?.ids ?? []) as string[];
          data = {
            nodes: ids.map((id) => {
              const o = shop.orders.find((x) => x.f.id === id) ?? shop.hidden?.find((x) => x.f.id === id);
              if (!o) return null;
              return {
                id,
                status: o.f.fulfillmentStatus ?? "SUCCESS",
                displayStatus: o.f.displayStatus,
                deliveredAt: o.f.deliveredAt,
                estimatedDeliveryAt: null,
                events: { nodes: o.f.events },
                order: { cancelledAt: null },
              };
            }),
          };
          break;
        }
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
        status: o.f.fulfillmentStatus ?? "SUCCESS",
        requiresShipping: o.f.requiresShipping ?? true,
        createdAt: o.f.createdAt,
        inTransitAt: null,
        deliveredAt: o.f.deliveredAt,
        estimatedDeliveryAt: null,
        displayStatus: o.f.displayStatus,
        trackingInfo: o.f.noTracking ? [] : [{ company: o.f.carrier, number: `TRK${o.n}`, url: `https://track.test/${o.n}` }],
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
    { n: "1001", locale: "de-DE", country: "DE", f: { id: "gid://shopify/Fulfillment/1", createdAt: ago(20), displayStatus: "IN_TRANSIT", deliveredAt: null, events: [{ status: "IN_TRANSIT", happenedAt: ago(2) }], carrier: "DHL Express" } },
    { n: "1002", locale: "en", country: "US", f: { id: "gid://shopify/Fulfillment/2", createdAt: ago(6), displayStatus: "DELIVERED", deliveredAt: ago(2), events: [{ status: "DELIVERED", happenedAt: ago(2) }], carrier: "UPS" } },
    { n: "1003", locale: "fr", country: "US", f: { id: "gid://shopify/Fulfillment/3", createdAt: ago(5), displayStatus: "IN_TRANSIT", deliveredAt: null, events: [{ status: "IN_TRANSIT", happenedAt: ago(4) }], carrier: "UPS" } },
    { n: "1004", locale: "en", country: "US", tags: ["Wholesale"], f: { id: "gid://shopify/Fulfillment/4", createdAt: ago(20), displayStatus: "IN_TRANSIT", deliveredAt: null, events: [{ status: "IN_TRANSIT", happenedAt: ago(19) }], carrier: "USPS" } },
    // H1: no carrier scans at all → never emailed, only flagged for a manual check.
    { n: "1005", locale: "en", country: "US", f: { id: "gid://shopify/Fulfillment/5", createdAt: ago(20), displayStatus: "FULFILLED", deliveredAt: null, events: [], carrier: "USPS" } },
    // H1: digital product / no tracking number → not tracked at all.
    { n: "1006", locale: "en", country: "US", f: { id: "gid://shopify/Fulfillment/6", createdAt: ago(20), displayStatus: "FULFILLED", deliveredAt: null, events: [], carrier: "", requiresShipping: false } },
    { n: "1007", locale: "en", country: "US", f: { id: "gid://shopify/Fulfillment/7", createdAt: ago(20), displayStatus: "FULFILLED", deliveredAt: null, events: [], carrier: "", noTracking: true } },
  ]);

  beforeAll(async () => {
    await db.shopSettings.create({
      data: { shop: shop.domain, compensationEnabled: true, compensationMinDaysLate: 1, excludedTags: "wholesale" },
    });
  });

  it("finds late and stalled parcels and drafts messages in the customer's language", async () => {
    const summary = await syncShop(fakeAdmin(shop), shop.domain, NOW);
    expect(summary.shipmentsSeen).toBe(5);
    expect(summary.newShipments).toBe(5);
    expect(summary.skippedNoTracking).toBe(2);

    const settings = await db.shopSettings.findUniqueOrThrow({ where: { shop: shop.domain } });
    expect(settings.plan).toBe("growth");
    expect(settings.timezone).toBe("America/New_York");
    expect(settings.digestEmail).toBe("owner@acme.test");
    expect(settings.lastScanAt?.toISOString()).toBe(NOW.toISOString()); // F12

    const late = await db.shipment.findFirstOrThrow({ where: { shop: shop.domain, orderName: "#1001" } });
    expect(late.risk).toBe("delayed");
    const stalled = await db.shipment.findFirstOrThrow({ where: { shop: shop.domain, orderName: "#1003" } });
    expect(stalled.risk).toBe("stalled");

    const untracked = await db.shipment.findFirstOrThrow({ where: { shop: shop.domain, orderName: "#1005" } });
    expect(untracked.risk).toBe("watch");
    expect(untracked.riskReason).toContain("Check this one manually");

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
    const result = await sendMessage(fakeAdmin(shop), shop.domain, message.id, { body: `${message.body}\n\nP.S. edited` });
    expect(result.ok).toBe(true);
    const sent = await db.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(sent.status).toBe("sent");
    expect(sent.body).toContain("P.S. edited");
    expect(JSON.stringify(await db.shipment.findMany({ where: { shop: shop.domain } }))).not.toContain("buyer@example.test");
  });

  it("M4: creates the discount in Shopify only when the email is sent, for that customer", async () => {
    const creates = shop.calls.filter((c) => c.op === "DelaywiseCreateSorryDiscount");
    expect(creates).toHaveLength(1); // the German email was sent above; the French one has no discount
    const input = creates[0].variables!.basicCodeDiscount as { code: string; context: unknown };
    const message = await db.message.findFirstOrThrow({ where: { shop: shop.domain, language: "de" } });
    expect(input.code).toBe(message.discountCode);
    expect(input.context).toEqual({ customers: { add: ["gid://shopify/Customer/77"] } });
    expect(message.discountCreated).toBe(true);
  });

  it("H2: a message can only be sent once, even if two requests race", async () => {
    const message = await db.message.findFirstOrThrow({ where: { shop: shop.domain, language: "fr" } });
    const [a, b] = await Promise.all([sendMessage(fakeAdmin(shop), shop.domain, message.id), sendMessage(fakeAdmin(shop), shop.domain, message.id)]);
    expect(a.ok || b.ok).toBe(true); // the loser sees "sending" or "sent", never sends again
    const contacts = shop.calls.filter((c) => c.op === "DelaywiseOrderContact" && c.variables?.id === "gid://shopify/Order/1003");
    expect(contacts).toHaveLength(1);
  });

  it("H2: a second scan can't start while one is running", async () => {
    await db.shopSettings.update({ where: { shop: shop.domain }, data: { scanLockUntil: new Date(Date.now() + 60_000) } });
    await expect(syncShop(fakeAdmin(shop), shop.domain, NOW)).rejects.toThrow(/already running/);
    await db.shopSettings.update({ where: { shop: shop.domain }, data: { scanLockUntil: null } });
  });

  it("F11: records when an apology discount turns into an order", async () => {
    const message = await db.message.findFirstOrThrow({ where: { shop: shop.domain, language: "de" } });
    shop.redeemedCodes = [message.discountCode!];
    const summary = await syncShop(fakeAdmin(shop), shop.domain, new Date(NOW.getTime() + 2 * 3_600_000));
    expect(summary.discountsRedeemed).toBe(1);
    const roi = await roiSummary(shop.domain);
    expect(roi).toMatchObject({ emailsSent: 2, discountsSent: 1, discountsRedeemed: 1, revenueRecovered: 80 });
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
    // Only customers who were actually emailed get a follow-up.
  });

  it("records monthly usage", async () => {
    const usage = await db.usageMonth.findFirstOrThrow({ where: { shop: shop.domain } });
    expect(usage.shipmentsTracked).toBe(5);
    expect(usage.messagesSent).toBe(2); // German + French; the follow-up is a draft in approval mode
  });
});

describe("autopilot, send window and carrier transit days", () => {
  const shop = newShop("Starter", [
    // Shipped 4 days ago by "Speedy": late only if Speedy promises 2 days.
    { n: "2001", locale: "es", country: "US", f: { id: "gid://shopify/Fulfillment/21", createdAt: ago(4), displayStatus: "IN_TRANSIT", deliveredAt: null, events: [{ status: "IN_TRANSIT", happenedAt: ago(1) }], carrier: "Speedy Post" } },
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

describe("R3: Klaviyo events", () => {
  const shop = newShop("Growth", [
    { n: "3001", locale: "en", country: "US", f: { id: "gid://shopify/Fulfillment/31", createdAt: ago(9), displayStatus: "IN_TRANSIT", deliveredAt: null, events: [{ status: "IN_TRANSIT", happenedAt: ago(1) }], carrier: "UPS" } },
  ]);
  const sent: { url: string; body: string; auth: string }[] = [];

  beforeAll(async () => {
    process.env.APP_ENCRYPTION_KEY = "22".repeat(32);
    await db.shopSettings.create({
      data: { shop: shop.domain, klaviyoEnabled: true, klaviyoApiKeyEnc: encryptSecret("pk_testkey0123456789abcdef", shop.domain) },
    });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, body: String(init.body), auth: String((init.headers as Record<string, string>).Authorization) });
      return new Response(null, { status: 202 });
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.APP_ENCRYPTION_KEY;
  });

  it("pushes one at-risk event with the customer's email, only on escalation", async () => {
    const first = await syncShop(fakeAdmin(shop), shop.domain, NOW);
    expect(first.klaviyoEvents).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://a.klaviyo.com/api/events");
    expect(sent[0].auth).toBe("Klaviyo-API-Key pk_testkey0123456789abcdef");
    expect(sent[0].body).toContain("buyer@example.test");
    expect(sent[0].body).toContain("Delaywise Shipment At Risk");
    const again = await syncShop(fakeAdmin(shop), shop.domain, new Date(NOW.getTime() + 3_600_000));
    expect(again.klaviyoEvents).toBe(0);
  });

  it("stores the key encrypted, never in plain text", async () => {
    const settings = await db.shopSettings.findUniqueOrThrow({ where: { shop: shop.domain } });
    expect(settings.klaviyoApiKeyEnc).not.toContain("pk_testkey");
  });
});

describe("H4 + H5: shipments outside the order search are still refreshed, and resolved drafts are dropped", () => {
  const order = { n: "4001", locale: "en", country: "US", f: { id: "gid://shopify/Fulfillment/41", createdAt: ago(9), displayStatus: "IN_TRANSIT", deliveredAt: null as string | null, events: [{ status: "IN_TRANSIT", happenedAt: ago(1) }], carrier: "UPS" } };
  const shop = newShop("Growth", [order]);

  beforeAll(async () => {
    await db.shopSettings.create({ data: { shop: shop.domain } });
  });

  it("drafts a late email, then skips it when the parcel arrives", async () => {
    await syncShop(fakeAdmin(shop), shop.domain, NOW);
    const draft = await db.message.findFirstOrThrow({ where: { shop: shop.domain } });
    expect(draft.status).toBe("pending_approval");

    // The order search no longer returns this order (big store / older order)…
    shop.hidden = [order];
    shop.orders = [];
    order.f.displayStatus = "DELIVERED";
    order.f.deliveredAt = ago(0);
    const summary = await syncShop(fakeAdmin(shop), shop.domain, new Date(NOW.getTime() + 3_600_000));
    expect(summary.refreshed).toBe(1); // …but it is re-checked by ID.
    const s = await db.shipment.findFirstOrThrow({ where: { shop: shop.domain } });
    expect(s.status).toBe("DELIVERED");
    const after = await db.message.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe("skipped");
    const send = await sendMessage(fakeAdmin(shop), shop.domain, draft.id);
    expect(send.ok).toBe(false);
  });
});
