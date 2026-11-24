// Match PO lines to catalog items.
// Order of trust: the buyer's learned code (memory) > exact SKU > barcode > fuzzy text similarity.
// Every match carries a confidence and the reasons, so the review screen can explain itself.
import { all, get, run } from '../db.js';

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com',
  'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.ru', 'yandex.ru', 'zoho.com']);

/** Buyers are remembered per company domain (so every buyer at a retailer shares one memory), or per address for free-mail. */
export function customerKey(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return '';
  const domain = e.slice(at + 1);
  return FREE_MAIL.has(domain) ? e : `@${domain}`;
}

export const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Memory key: the buyer's code, or their description when there is no code. */
export const rawKey = (line) => (normCode(line.code) ? `c:${normCode(line.code)}` : `d:${tokens(line.description).join(' ')}`);

const STOP = new Set(['the', 'and', 'with', 'for', 'of', 'a', 'an', 'in', 'x', 'pcs', 'pc', 'ea', 'each']);
function tokens(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));
}

function similarity(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return (2 * inter) / (A.size + B.size); // Dice coefficient
}

const CASE_UNITS = /^(cs|case|cases|ctn|carton|cartons|box|boxes|bx|pack|pk|inner|master)$/i;
const DOZEN = /^(dz|doz|dozen)$/i;

/**
 * @param {number} storeId
 * @param {string} custKey
 * @param {{code, description, quantity, unit, unit_price}} line
 * @param {Array} catalog rows from catalog_items
 */
export function matchLine(storeId, custKey, line, catalog, index = buildIndex(catalog)) {
  const flags = [];
  let item = null;
  let method = 'none';
  let confidence = 0;
  let candidates = [];

  const mem = custKey ? get('SELECT external_id FROM customer_sku_map WHERE store_id = ? AND customer_key = ? AND raw_key = ?',
    storeId, custKey, rawKey(line)) : null;
  const code = normCode(line.code);

  if (mem && index.byId.get(mem.external_id)) {
    item = index.byId.get(mem.external_id); method = 'memory'; confidence = 0.99;
  } else if (code && index.bySku.get(code)?.length === 1) {
    item = index.bySku.get(code)[0]; method = 'sku'; confidence = 0.97;
  } else if (code && index.byBarcode.get(code)?.length === 1) {
    item = index.byBarcode.get(code)[0]; method = 'barcode'; confidence = 0.97;
  } else {
    if (code && (index.bySku.get(code)?.length > 1)) flags.push('duplicate_sku_in_catalog');
    const text = [line.description, line.code].filter(Boolean).join(' ');
    const scored = catalog
      .map((c) => ({ c, score: Math.max(similarity(text, `${c.title} ${c.variant_title || ''} ${c.sku || ''}`), similarity(line.description, `${c.title} ${c.variant_title || ''}`)) }))
      .filter((x) => x.score > 0.2)
      .sort((a, b) => b.score - a.score);
    candidates = scored.slice(0, 5).map((x) => ({ external_id: x.c.external_id, sku: x.c.sku, title: label(x.c), score: round(x.score) }));
    const [best, second] = scored;
    if (best && best.score >= 0.6) {
      item = best.c; method = 'fuzzy';
      const margin = best.score - (second?.score || 0);
      // Fuzzy matches never reach the auto-approve threshold on their own; a human confirms them once, then memory takes over.
      confidence = round(Math.min(0.85, best.score * 0.75 + margin * 0.5));
      if (margin < 0.1) flags.push('ambiguous_match');
    } else {
      flags.push('no_match');
    }
  }

  // Units: "3 cases" of an item sold in packs of 12 becomes 36 units.
  let finalQty = line.quantity;
  if (item && CASE_UNITS.test(line.unit || '')) {
    if (item.case_pack > 1) { finalQty = line.quantity * item.case_pack; flags.push('converted_from_case'); } else flags.push('unit_unknown_case_size');
  } else if (item && DOZEN.test(line.unit || '')) {
    finalQty = line.quantity * 12; flags.push('converted_from_dozen');
  }
  if (!Number.isInteger(finalQty)) { flags.push('fractional_quantity'); finalQty = Math.round(finalQty); }

  if (item) {
    if (line.unit_price != null && item.price != null) {
      const perUnitPo = flags.includes('converted_from_case') ? line.unit_price / item.case_pack
        : flags.includes('converted_from_dozen') ? line.unit_price / 12 : line.unit_price;
      if (Math.abs(perUnitPo - item.price) > Math.max(0.01, item.price * 0.01)) flags.push('price_mismatch');
    }
    if (item.inventory != null && item.inventory < finalQty) flags.push('low_stock');
  }

  const needsHuman = flags.some((f) => ['no_match', 'ambiguous_match', 'unit_unknown_case_size', 'fractional_quantity', 'duplicate_sku_in_catalog'].includes(f));
  if (needsHuman) confidence = Math.min(confidence, 0.5);

  return {
    matched_external_id: item?.external_id || null,
    final_quantity: finalQty,
    confidence,
    match_method: method,
    flags,
    candidates,
  };
}

export function buildIndex(catalog) {
  const byId = new Map();
  const bySku = new Map();
  const byBarcode = new Map();
  const push = (m, k, v) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const c of catalog) {
    byId.set(c.external_id, c);
    push(bySku, normCode(c.sku), c);
    push(byBarcode, normCode(c.barcode), c);
  }
  return { byId, bySku, byBarcode };
}

/** A merchant correction teaches the store: next time this buyer writes this code, use this item. */
export function remember(storeId, custKey, line, externalId) {
  if (!custKey || !externalId) return;
  run(`INSERT INTO customer_sku_map (store_id, customer_key, raw_key, external_id) VALUES (?,?,?,?)
       ON CONFLICT (store_id, customer_key, raw_key) DO UPDATE SET external_id = excluded.external_id,
         uses = CASE WHEN customer_sku_map.external_id = excluded.external_id THEN customer_sku_map.uses + 1 ELSE 1 END,
         updated_at = datetime('now')`, storeId, custKey, rawKey(line), externalId);
}

export const loadCatalog = (storeId) => all('SELECT * FROM catalog_items WHERE store_id = ?', storeId);
export const label = (c) => [c.title, c.variant_title].filter(Boolean).join(' — ');
const round = (n) => Math.round(n * 100) / 100;
