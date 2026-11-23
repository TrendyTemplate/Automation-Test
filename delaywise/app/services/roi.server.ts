import db from "../db.server";
import { gql, type AdminApi } from "./admin-types";
import { DISCOUNT_REDEMPTIONS_QUERY } from "./shopify-queries.server";

const LOOKBACK_DAYS = 60;
const BATCH = 20;

interface RedemptionOrders {
  orders: {
    nodes: {
      name: string;
      createdAt: string;
      discountCodes: string[];
      totalPriceSet: { shopMoney: { amount: string } };
    }[];
  };
}

/**
 * F11: checks whether apology discount codes we sent were used, and records
 * the order that used them. This is the "revenue recovered" number on the
 * dashboard.
 */
export async function trackRedemptions(admin: AdminApi, shop: string, now = new Date()): Promise<number> {
  const open = await db.message.findMany({
    where: {
      shop,
      status: "sent",
      discountCode: { not: null },
      discountRedeemedAt: null,
      createdAt: { gte: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000) },
    },
    select: { id: true, discountCode: true },
  });
  let found = 0;
  for (let i = 0; i < open.length; i += BATCH) {
    const batch = open.slice(i, i + BATCH);
    const query = batch.map((m) => `discount_code:${m.discountCode}`).join(" OR ");
    const data = await gql<RedemptionOrders>(admin, DISCOUNT_REDEMPTIONS_QUERY, { query });
    for (const order of data.orders.nodes) {
      const codes = order.discountCodes.map((c) => c.toUpperCase());
      const match = batch.find((m) => codes.includes(m.discountCode!.toUpperCase()));
      if (!match) continue;
      await db.message.update({
        where: { id: match.id },
        data: {
          discountRedeemedAt: new Date(order.createdAt),
          discountOrderName: order.name,
          discountOrderValue: Number(order.totalPriceSet.shopMoney.amount) || 0,
        },
      });
      found++;
    }
  }
  return found;
}

export async function roiSummary(shop: string) {
  const [sent, redeemed] = await Promise.all([
    db.message.count({ where: { shop, status: "sent" } }),
    db.message.aggregate({
      where: { shop, discountRedeemedAt: { not: null } },
      _count: { _all: true },
      _sum: { discountOrderValue: true },
    }),
  ]);
  const discountsSent = await db.message.count({ where: { shop, status: "sent", discountCode: { not: null } } });
  return {
    emailsSent: sent,
    discountsSent,
    discountsRedeemed: redeemed._count._all,
    revenueRecovered: Math.round((redeemed._sum.discountOrderValue ?? 0) * 100) / 100,
  };
}
