import { afterAll, describe, expect, it } from "vitest";
import db from "../app/db.server";
import { runScheduledScans } from "../app/services/scheduler.server";
import type { AdminApi } from "../app/services/admin-types";

const RUN = Date.now();
const shops = [0, 1, 2, 3].map((i) => `sched-${RUN}-${i}.myshopify.com`);
const emptyShopify: AdminApi = {
  async graphql(query) {
    const op = /query (\w+)/.exec(query)?.[1];
    const data =
      op === "DelaywiseShopInfo"
        ? { shop: { name: "S", contactEmail: "o@s.test", myshopifyDomain: "s", ianaTimezone: "UTC", billingAddress: { countryCodeV2: "US" } }, currentAppInstallation: { activeSubscriptions: [] } }
        : op === "DelaywiseShippedOrders"
          ? { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } }
          : op === "DelaywiseRefreshFulfillments"
            ? { nodes: [] }
            : { orders: { nodes: [] } };
    return new Response(JSON.stringify({ data }));
  },
};

afterAll(async () => {
  await db.shopSettings.deleteMany({ where: { shop: { in: shops } } });
  await db.usageMonth.deleteMany({ where: { shop: { in: shops } } });
});

describe("H3 scheduled scans", () => {
  it("scans the longest-waiting shops first and skips locked ones", async () => {
    await db.shopSettings.create({ data: { shop: shops[0], lastScanAt: new Date("2026-11-20T10:00:00Z") } });
    await db.shopSettings.create({ data: { shop: shops[1], lastScanAt: new Date("2026-11-20T08:00:00Z") } });
    await db.shopSettings.create({ data: { shop: shops[2], scanLockUntil: new Date(Date.now() + 60_000) } });
    const order: string[] = [];
    const { results, remaining } = await runScheduledScans({
      shops: [shops[0], shops[1], shops[2]],
      adminFor: async (shop) => {
        order.push(shop);
        return emptyShopify;
      },
      budgetMs: 60_000,
      concurrency: 1,
    });
    expect(remaining).toBe(0);
    expect(order).toEqual([shops[2], shops[1], shops[0]]); // never scanned, then oldest
    expect(results.find((r) => r.shop === shops[2])?.status).toBe("skipped");
    expect(results.filter((r) => r.status === "ok")).toHaveLength(2);
  });

  it("stops starting new shops when the time budget is used up", async () => {
    let t = 0;
    const { results, remaining } = await runScheduledScans({
      shops: [shops[3], shops[0], shops[1]],
      adminFor: async () => {
        t += 40_000;
        return emptyShopify;
      },
      budgetMs: 50_000,
      concurrency: 1,
      now: () => t,
    });
    expect(results).toHaveLength(2);
    expect(remaining).toBe(1);
  });
});
