// Connector registry.
//
// The core (extraction, matching, review) never talks to a commerce platform directly; it only calls the
// connector named by store.platform. Supporting a new platform (WooCommerce, BigCommerce, QuickBooks, Xero …)
// means writing one file that implements this interface and registering it below — nothing else changes.
//
// interface Connector {
//   id: string                      // matches stores.platform
//   label: string
//   /** All sellable items. Called on install and on "Sync catalog". */
//   fetchCatalog(store): Promise<Array<{
//     external_id: string, sku?: string, barcode?: string, title: string, variant_title?: string,
//     price?: number, inventory?: number|null }>>
//   /** Find the buyer in the platform. Return null when unknown (the order is then created without a customer). */
//   findCustomer(store, { email, company }): Promise<null | { external_id: string, name: string, company?: string, ref?: object }>
//   /** Create the order (a draft where the platform has drafts). */
//   createOrder(store, order: {
//     po_number, customer: null|{external_id, ref}, email, ship_to, note, currency,
//     lines: Array<{ external_id, sku, title, quantity, unit_price }>
//   }): Promise<{ external_id: string, name: string, url?: string }>
// }
//   getPrices?(store, customer): Promise<Map<external_id, price>>   // optional: buyer-specific (B2B) prices
import { shopify } from './shopify.js';
import { csv } from './csv.js';
import { woocommerce } from './woocommerce.js';
import { quickbooks } from './quickbooks.js';
import { xero } from './xero.js';

const connectors = new Map([shopify, csv, woocommerce, quickbooks, xero].map((c) => [c.id, c]));

export function getConnector(platform) {
  const c = connectors.get(platform);
  if (!c) throw new Error(`No connector for platform "${platform}"`);
  return c;
}

/** Tests and future plug-ins can register extra connectors at runtime. */
export function registerConnector(c) {
  for (const fn of ['fetchCatalog', 'findCustomer', 'createOrder']) {
    if (typeof c[fn] !== 'function') throw new Error(`Connector "${c.id}" is missing ${fn}()`);
  }
  connectors.set(c.id, c);
}

export const listConnectors = () => [...connectors.values()].map((c) => ({ id: c.id, label: c.label }));
