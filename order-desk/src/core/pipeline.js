// The platform-neutral flow: file → extract → find buyer → match lines → save for review → (approve) → connector.createOrder
import { simpleParser } from 'mailparser';
import { all, get, run, tx } from '../db.js';
import { getConnector } from '../connectors/index.js';
import { extractPo, kindOf } from './extract.js';
import { matchLine, buildIndex, loadCatalog, customerKey, remember, label } from './match.js';
import { config } from '../config.js';

export const getStore = (id) => get('SELECT * FROM stores WHERE id = ?', id);

/** Pull the catalog from the platform into our DB (keeps merchant-edited case_pack values). */
export async function syncCatalog(store) {
  const items = await getConnector(store.platform).fetchCatalog(store);
  tx(() => {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.external_id);
      run(`INSERT INTO catalog_items (store_id, external_id, sku, barcode, title, variant_title, price, inventory)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT (store_id, external_id) DO UPDATE SET sku = excluded.sku, barcode = excluded.barcode, title = excluded.title,
             variant_title = excluded.variant_title, price = excluded.price, inventory = excluded.inventory`,
      store.id, it.external_id, it.sku ?? null, it.barcode ?? null, it.title, it.variant_title ?? null, it.price ?? null, it.inventory ?? null);
    }
    for (const row of all('SELECT external_id FROM catalog_items WHERE store_id = ?', store.id)) {
      if (!seen.has(row.external_id)) run('DELETE FROM catalog_items WHERE store_id = ? AND external_id = ?', store.id, row.external_id);
    }
    run("UPDATE stores SET catalog_synced_at = datetime('now') WHERE id = ?", store.id);
  });
  return items.length;
}

/**
 * Process one PO document.
 * @returns {Promise<number|null>} purchase order id, or null when the document is not an order
 */
export async function ingestFile(store, file, { source = 'upload', senderEmail = '', emailText = '' } = {}) {
  const po = await extractPo(file);
  if (!po.is_purchase_order) return null;

  const buyerEmail = po.buyer.email || senderEmail;
  const custKey = customerKey(buyerEmail);
  let customer = null;
  const flags = [];
  try {
    customer = await getConnector(store.platform).findCustomer(store, { email: buyerEmail, company: po.buyer.company });
  } catch (e) {
    flags.push('customer_lookup_failed');
  }
  if (!customer) flags.push('unknown_customer');

  if (po.po_number && get(`SELECT id FROM purchase_orders WHERE store_id = ? AND po_number = ? AND COALESCE(customer_key,'') = ?
      AND status != 'rejected'`, store.id, po.po_number, custKey)) {
    flags.push('duplicate_po');
  }
  if (/ignore (all|previous)|disregard|system prompt|instructions/i.test(`${po.notes} ${emailText}`)) flags.push('suspicious_instructions');

  const catalog = loadCatalog(store.id);
  if (!catalog.length) flags.push('catalog_empty');
  const index = buildIndex(catalog);

  return tx(() => {
    const { lastInsertRowid: poId } = run(`INSERT INTO purchase_orders (store_id, source, source_filename, sender_email, buyer_email, customer_key,
        customer_external_id, customer_name, company_name, po_number, po_date, requested_ship_date, currency, ship_to_json, notes, flags_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    store.id, source, file.filename || null, senderEmail || null, buyerEmail || null, custKey || null, customer?.external_id || null,
    customer?.name || po.buyer.name || null, customer?.company || po.buyer.company || null, po.po_number || null, po.po_date || null,
    po.requested_ship_date || null, po.currency || store.currency, JSON.stringify(po.ship_to), po.notes || null, JSON.stringify(flags));

    po.lines.forEach((line, i) => {
      const m = matchLine(store.id, custKey, line, catalog, index);
      run(`INSERT INTO po_lines (po_id, line_no, raw_code, raw_description, quantity, unit, unit_price, matched_external_id,
           final_quantity, confidence, match_method, flags_json, candidates_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      poId, i + 1, line.code || null, line.description || null, line.quantity, line.unit || null, line.unit_price,
      m.matched_external_id, m.final_quantity, m.confidence, m.match_method, JSON.stringify(m.flags), JSON.stringify(m.candidates));
    });
    refreshStatus(Number(poId));
    return Number(poId);
  });
}

/** Parse a raw email (RFC 822) and ingest every PO-looking attachment, or the body when there are none. */
export async function ingestEmail(store, raw) {
  const mail = await simpleParser(raw);
  const sender = mail.from?.value?.[0]?.address || '';
  const subject = mail.subject || '';
  const ids = [];
  // Skip small inline images (logos, signatures); keep PDFs, spreadsheets and real photos of orders.
  const files = (mail.attachments || []).filter((a) => {
    const kind = kindOf(a.filename, a.contentType);
    if (!kind || kind === 'text') return false;
    return !(kind === 'image' && (a.contentDisposition === 'inline' || (a.size || 0) < 15000));
  });
  for (const a of files.slice(0, 5)) {
    const id = await ingestFile(store, { filename: a.filename, contentType: a.contentType, content: a.content },
      { source: 'email', senderEmail: sender, emailText: mail.text || '' });
    if (id) ids.push(id);
  }
  if (!ids.length && (mail.text || '').trim()) {
    const id = await ingestFile(store, { filename: 'email.txt', contentType: 'text/plain', content: `Subject: ${subject}\n\n${mail.text}` },
      { source: 'email', senderEmail: sender });
    if (id) ids.push(id);
  }
  return ids;
}

/** Status is derived: ready only when every line is matched with high confidence and nothing needs a human. */
export function refreshStatus(poId) {
  const po = get('SELECT * FROM purchase_orders WHERE id = ?', poId);
  if (['created', 'rejected'].includes(po.status)) return po.status;
  const lines = all('SELECT * FROM po_lines WHERE po_id = ?', poId);
  const poFlags = JSON.parse(po.flags_json);
  const blocking = ['duplicate_po', 'suspicious_instructions', 'catalog_empty'];
  const ok = lines.length > 0
    && lines.every((l) => l.matched_external_id && l.final_quantity > 0 && (l.corrected || l.confidence >= config.autoMatchConfidence)
      && !JSON.parse(l.flags_json).some((f) => ['price_mismatch', 'low_stock'].includes(f) && !l.corrected))
    && !poFlags.some((f) => blocking.includes(f));
  const status = ok ? 'ready' : 'needs_review';
  run("UPDATE purchase_orders SET status = ?, updated_at = datetime('now') WHERE id = ?", status, poId);
  return status;
}

/** Merchant fixes a line. Teaches the buyer memory when the item changes. */
export function correctLine(store, poId, lineId, { external_id, quantity }) {
  const po = get('SELECT * FROM purchase_orders WHERE id = ? AND store_id = ?', poId, store.id);
  if (!po) throw httpError(404, 'Purchase order not found');
  if (['created', 'rejected'].includes(po.status)) throw httpError(409, 'This purchase order is closed');
  const line = get('SELECT * FROM po_lines WHERE id = ? AND po_id = ?', lineId, poId);
  if (!line) throw httpError(404, 'Line not found');
  let item = null;
  if (external_id !== undefined) {
    item = external_id ? get('SELECT * FROM catalog_items WHERE store_id = ? AND external_id = ?', store.id, external_id) : null;
    if (external_id && !item) throw httpError(400, 'Unknown catalog item');
  }
  const qty = quantity === undefined ? line.final_quantity : Number(quantity);
  if (!Number.isInteger(qty) || qty < 0 || qty > 1e6) throw httpError(400, 'Quantity must be a whole number');
  const newId = external_id === undefined ? line.matched_external_id : (item?.external_id || null);
  run(`UPDATE po_lines SET matched_external_id = ?, final_quantity = ?, corrected = 1, match_method = CASE WHEN ? THEN 'manual' ELSE match_method END,
       confidence = CASE WHEN ? IS NULL THEN 0 ELSE 1 END WHERE id = ?`,
  newId, qty, external_id !== undefined ? 1 : 0, newId, lineId);
  if (external_id !== undefined && newId) remember(store.id, po.customer_key, { code: line.raw_code, description: line.raw_description }, newId);
  return refreshStatus(poId);
}

/** Approve: create the order on the platform. Lines with quantity 0 or no item are skipped only if the merchant zeroed them. */
export async function approve(store, poId) {
  const po = get('SELECT * FROM purchase_orders WHERE id = ? AND store_id = ?', poId, store.id);
  if (!po) throw httpError(404, 'Purchase order not found');
  if (po.status === 'created') throw httpError(409, 'Order already created');
  if (po.status === 'rejected') throw httpError(409, 'This purchase order was rejected');
  const lines = all('SELECT l.*, c.sku, c.title, c.variant_title, c.price FROM po_lines l LEFT JOIN catalog_items c ON c.store_id = ? AND c.external_id = l.matched_external_id WHERE l.po_id = ? ORDER BY l.line_no', store.id, poId);
  const open = lines.filter((l) => l.final_quantity > 0 && !l.matched_external_id);
  if (open.length) throw httpError(400, `Line ${open[0].line_no} has no product. Pick one or set its quantity to 0.`);
  const orderLines = lines.filter((l) => l.final_quantity > 0);
  if (!orderLines.length) throw httpError(400, 'Nothing to order');

  // Claim the PO first so two clicks can't create two orders.
  const claimed = run("UPDATE purchase_orders SET status = 'creating', updated_at = datetime('now') WHERE id = ? AND status IN ('ready','needs_review','failed')", poId);
  if (!claimed.changes) throw httpError(409, 'Order is already being created');

  const connector = getConnector(store.platform);
  try {
    // Re-check the buyer at approval time in case they were added to the platform after the PO arrived.
    let customer = null;
    if (po.buyer_email) {
      customer = await connector.findCustomer(store, { email: po.buyer_email, company: po.company_name }).catch(() => null);
    }
    const note = [
      po.po_number && `PO ${po.po_number}`,
      po.requested_ship_date && `Requested ship date: ${po.requested_ship_date}`,
      po.notes,
      'Created by AI Order Desk',
    ].filter(Boolean).join('\n');
    const result = await connector.createOrder(store, {
      po_number: po.po_number,
      customer,
      email: po.buyer_email,
      ship_to: JSON.parse(po.ship_to_json || '{}'),
      note,
      currency: po.currency,
      lines: orderLines.map((l) => ({ external_id: l.matched_external_id, sku: l.sku, title: label(l), quantity: l.final_quantity, unit_price: l.price })),
    });
    // Approved lines confirm what the buyer meant: strengthen memory for every matched line.
    for (const l of orderLines) remember(store.id, po.customer_key, { code: l.raw_code, description: l.raw_description }, l.matched_external_id);
    run(`UPDATE purchase_orders SET status = 'created', order_external_id = ?, order_name = ?, order_url = ?, error = NULL,
         updated_at = datetime('now') WHERE id = ?`, result.external_id, result.name, result.url || null, poId);
    return result;
  } catch (e) {
    run("UPDATE purchase_orders SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?", String(e.message).slice(0, 500), poId);
    throw httpError(502, e.message);
  }
}

export function reject(store, poId) {
  const r = run("UPDATE purchase_orders SET status = 'rejected', updated_at = datetime('now') WHERE id = ? AND store_id = ? AND status NOT IN ('created','creating')", poId, store.id);
  if (!r.changes) throw httpError(409, 'Cannot reject this purchase order');
}

/** Auto-create when the store allows it and the PO is fully certain. */
export async function maybeAutoCreate(store, poId) {
  if (!store.auto_create) return null;
  const po = get('SELECT status FROM purchase_orders WHERE id = ?', poId);
  if (po?.status !== 'ready') return null;
  return approve(store, poId).catch(() => null);
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
