// "No platform" connector: for wholesalers without an online store. The catalog is uploaded as a CSV
// (sku,barcode,title,variant_title,price,inventory) and approved orders are kept in the app and exported as CSV
// (for Excel, Google Sheets or importing into accounting software).
import { all, get, run } from '../db.js';

export const csv = {
  id: 'csv',
  label: 'Spreadsheet / CSV export',

  async fetchCatalog(store) {
    // The catalog lives only in our DB for this connector (uploaded by the merchant); return it unchanged.
    return all('SELECT external_id, sku, barcode, title, variant_title, price, inventory FROM catalog_items WHERE store_id = ?', store.id);
  },

  async findCustomer() {
    return null;
  },

  async createOrder(store, order) {
    const n = (get("SELECT COUNT(*) AS n FROM purchase_orders WHERE store_id = ? AND status = 'created'", store.id).n || 0) + 1;
    return { external_id: `csv-${store.id}-${n}`, name: `#OD${String(n).padStart(4, '0')}`, url: null };
  },
};

/** Replace a csv-store's catalog from uploaded rows. */
export function importCatalogRows(storeId, rows) {
  run('DELETE FROM catalog_items WHERE store_id = ?', storeId);
  let i = 0;
  for (const r of rows) {
    if (!r.title && !r.sku) continue;
    i += 1;
    run(`INSERT INTO catalog_items (store_id, external_id, sku, barcode, title, variant_title, price, inventory, case_pack)
         VALUES (?,?,?,?,?,?,?,?,?)`,
    storeId, String(r.external_id || r.sku || `row-${i}`), r.sku || null, r.barcode || null, r.title || r.sku,
    r.variant_title || null, num(r.price), r.inventory === '' || r.inventory == null ? null : Math.trunc(num(r.inventory)),
    Math.max(1, Math.trunc(num(r.case_pack) || 1)));
  }
  run("UPDATE stores SET catalog_synced_at = datetime('now') WHERE id = ?", storeId);
  return i;
}

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
