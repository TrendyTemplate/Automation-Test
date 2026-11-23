import { describe, expect, it } from "vitest";
import { customerNotice } from "../app/lib/notice";

const ship = (risk: string, extra: Partial<Parameters<typeof customerNotice>[0][number]> = {}) => ({
  risk,
  status: "IN_TRANSIT",
  excluded: false,
  trackingUrl: `https://t.test/${risk}`,
  customerLocale: "de",
  ...extra,
});

describe("R4 order-status notice", () => {
  it("shows nothing when every parcel is fine, unverified, excluded or delivered", () => {
    expect(customerNotice([ship("none"), ship("watch")], "en")).toBeNull();
    expect(customerNotice([ship("delayed", { excluded: true })], "en")).toBeNull();
    expect(customerNotice([ship("delayed", { status: "DELIVERED" })], "en")).toBeNull();
  });
  it("picks the most serious parcel and the viewer's language", () => {
    const n = customerNotice([ship("stalled"), ship("lost")], "fr-CA")!;
    expect(n.kind).toBe("lost");
    expect(n.language).toBe("fr");
    expect(n.trackingUrl).toBe("https://t.test/lost");
    expect(n.text.length).toBeGreaterThan(20);
  });
  it("falls back to the order's language, then English", () => {
    expect(customerNotice([ship("delayed")], null)!.language).toBe("de");
    expect(customerNotice([ship("delayed")], "ja")!.language).toBe("en");
  });
});

import db from "../app/db.server";
import { noticeForCustomer, numericId } from "../app/services/order-notice.server";
import type { AdminApi } from "../app/services/admin-types";
import { afterAll } from "vitest";

describe("R4 noticeForCustomer", () => {
  const shop = `notice-${Date.now()}.myshopify.com`;
  const orderId = "gid://shopify/Order/555";
  const admin = (customerId: string): AdminApi => ({
    async graphql() {
      return new Response(JSON.stringify({ data: { order: { id: orderId, email: "x@y.test", customer: { id: customerId } } } }));
    },
  });
  afterAll(async () => {
    await db.shipment.deleteMany({ where: { shop } });
    await db.shopSettings.deleteMany({ where: { shop } });
  });

  it("normalizes ids", () => {
    expect(numericId("gid://shopify/Customer/77")).toBe("77");
    expect(numericId("77")).toBe("77");
    expect(numericId(undefined)).toBeNull();
  });

  it("shows the notice only to the order's customer, and only when switched on", async () => {
    await db.shopSettings.create({ data: { shop } });
    await db.shipment.create({
      data: { shop, orderId, orderName: "#555", fulfillmentId: "f555", shippedAt: new Date(), status: "IN_TRANSIT", risk: "delayed", trackingUrl: "https://t.test/555" },
    });
    const args = { shop, orderId, viewerLanguage: "es" };
    expect((await noticeForCustomer({ ...args, admin: admin("gid://shopify/Customer/77"), customerId: "gid://shopify/Customer/77" }))?.language).toBe("es");
    expect(await noticeForCustomer({ ...args, admin: admin("gid://shopify/Customer/77"), customerId: "gid://shopify/Customer/78" })).toBeNull();
    expect(await noticeForCustomer({ ...args, orderId: "not-an-id", admin: admin("77"), customerId: "77" })).toBeNull();
    await db.shopSettings.update({ where: { shop }, data: { orderStatusNotice: false } });
    expect(await noticeForCustomer({ ...args, admin: admin("77"), customerId: "77" })).toBeNull();
  });
});
