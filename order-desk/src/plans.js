import { get } from './db.js';

// Monthly limits count purchase orders turned into orders. Incoming POs are never dropped when a store is over
// its limit: they wait for review until the merchant upgrades or the month rolls over.
export const PLANS = {
  free: { id: 'free', name: 'Free', price: 0, orders: 5 },
  starter: { id: 'starter', name: 'Starter', price: 49, orders: 50 },
  growth: { id: 'growth', name: 'Growth', price: 129, orders: 200 },
  pro: { id: 'pro', name: 'Pro', price: 299, orders: 750 },
};

export const planOf = (store) => PLANS[store.plan] || PLANS.free;

export const ordersThisMonth = (storeId) => get(
  "SELECT COUNT(*) AS n FROM purchase_orders WHERE store_id = ? AND status = 'created' AND updated_at >= strftime('%Y-%m-01 00:00:00', 'now')",
  storeId,
).n;
