// Product import from a website shop: WooCommerce (REST API keys) or Shopify (Admin API access token).
// Products are matched by their store id (or SKU) so re-syncing updates prices / stock instead of duplicating.
// The connection is kept (encrypted) and re-synced daily by the worker.
import { one, all, run, logActivity } from '../db.js';
import { seal, open } from '../vault.js';
import { effectivePlan } from '../plans.js';

const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
const num = (v) => (v === '' || v == null ? null : Number(v));

async function getJson(url, headers) {
  const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(30_000) });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.message || j?.errors || `HTTP ${res.status}`);
  return { json: j, link: res.headers.get('link') || '' };
}

async function wooProducts(c) {
  const base = c.url.replace(/\/$/, '');
  const auth = { authorization: `Basic ${Buffer.from(`${c.key}:${c.secret}`).toString('base64')}` };
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const { json } = await getJson(`${base}/wp-json/wc/v3/products?per_page=100&status=publish&page=${page}`, auth);
    if (!Array.isArray(json) || !json.length) break;
    for (const p of json) {
      out.push({ ref: `woo:${p.id}`, name: p.name, sku: p.sku || null, price: num(p.price) ?? num(p.regular_price) ?? 0, stock: p.manage_stock ? num(p.stock_quantity) : (p.stock_status === 'outofstock' ? 0 : null),
        image: (p.images || [])[0]?.src || null, description: strip(p.short_description || p.description),
        variants: (p.attributes || []).filter((a) => a.variation || a.visible).map((a) => `${a.name}: ${(a.options || []).join(', ')}`).join('; ') || null, variantStock: null });
    }
    if (json.length < 100) break;
  }
  return out;
}

async function shopifyProducts(c) {
  const shop = c.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const base = process.env.SHOPIFY_BASE_URL || `https://${shop}`;
  let url = `${base}/admin/api/2025-01/products.json?limit=250&status=active`;
  const out = [];
  for (let i = 0; i < 20 && url; i++) {
    const { json, link } = await getJson(url, { 'x-shopify-access-token': c.secret });
    for (const p of json.products || []) {
      const vs = p.variants || [];
      const tracked = vs.some((v) => v.inventory_management);
      const multi = vs.length > 1;
      out.push({ ref: `shopify:${p.id}`, name: p.title, sku: vs[0]?.sku || null, price: num(vs[0]?.price) ?? 0, image: p.image?.src || p.images?.[0]?.src || null, description: strip(p.body_html),
        variants: (p.options || []).filter((o) => o.name !== 'Title').map((o) => `${o.name}: ${(o.values || []).join(', ')}`).join('; ') || null,
        stock: tracked ? vs.reduce((a, v) => a + Math.max(0, Number(v.inventory_quantity) || 0), 0) : null,
        variantStock: tracked && multi ? Object.fromEntries(vs.map((v) => [String(v.title).slice(0, 60), Math.max(0, Number(v.inventory_quantity) || 0)])) : null });
    }
    url = (link.match(/<([^>]+)>;\s*rel="next"/) || [])[1] || null;
  }
  return out;
}

export function syncSettings(ws) {
  try { const c = JSON.parse(ws.store_sync || '{}'); return { source: c.source || '', url: c.url || '', last_sync: c.last_sync || null, last_result: c.last_result || null }; } catch { return { source: '' }; }
}

/** Import / update products. b = { source: 'woocommerce'|'shopify', url, key, secret } (or stored config). */
export async function syncProducts(ws, b = null) {
  let c;
  if (b) {
    if (!['woocommerce', 'shopify'].includes(b.source)) throw Object.assign(new Error('Choose WooCommerce or Shopify'), { status: 400 });
    const url = String(b.url || '').trim();
    if (!/^https:\/\/[^/\s]+/.test(url) && !(b.source === 'shopify' && /^[a-z0-9-]+\.myshopify\.com$/i.test(url))) throw Object.assign(new Error('Enter your shop address, e.g. https://myshop.com or myshop.myshopify.com'), { status: 400 });
    if (!b.secret || (b.source === 'woocommerce' && !b.key)) throw Object.assign(new Error(b.source === 'woocommerce' ? 'Enter the consumer key and secret (WooCommerce → Settings → Advanced → REST API)' : 'Enter the Admin API access token'), { status: 400 });
    c = { source: b.source, url, key: String(b.key || '').trim(), secret: String(b.secret).trim() };
  } else {
    const s = JSON.parse(ws.store_sync || '{}');
    if (!s.source) return null;
    c = { ...s, ...JSON.parse(open(ws.id, 'store.secret', s.enc)) };
  }
  let items;
  try { items = c.source === 'woocommerce' ? await wooProducts(c) : await shopifyProducts(c); } catch (e) { throw Object.assign(new Error(`${c.source === 'woocommerce' ? 'WooCommerce' : 'Shopify'} refused: ${e.message}`), { status: 400 }); }
  const limit = effectivePlan(ws).products;
  let added = 0; let updated = 0; let skipped = 0;
  for (const p of items) {
    if (!p.name) continue;
    const ex = one('SELECT id FROM products WHERE workspace_id = ? AND external_ref = ?', ws.id, p.ref) || (p.sku ? one('SELECT id FROM products WHERE workspace_id = ? AND sku = ?', ws.id, p.sku) : null);
    const vs = p.variantStock ? JSON.stringify(p.variantStock) : null;
    if (ex) {
      run('UPDATE products SET name=?, sku=COALESCE(?, sku), price=?, stock=?, variant_stock=?, image_url=COALESCE(?, image_url), description=COALESCE(NULLIF(?, \'\'), description), variants=COALESCE(?, variants), external_ref=? WHERE id=?',
        p.name.slice(0, 200), p.sku, p.price, p.stock, vs, /^https:\/\//.test(p.image || '') ? p.image : null, p.description, p.variants, p.ref, ex.id);
      updated++;
    } else if (one('SELECT COUNT(*) AS n FROM products WHERE workspace_id = ?', ws.id).n < limit) {
      run(`INSERT INTO products (workspace_id, name, sku, price, currency, stock, variant_stock, image_url, description, variants, external_ref) VALUES (?,?,?,?, 'BDT', ?,?,?,?,?,?)`,
        ws.id, p.name.slice(0, 200), p.sku, p.price, p.stock, vs, /^https:\/\//.test(p.image || '') ? p.image : null, p.description || null, p.variants, p.ref);
      added++;
    } else skipped++;
  }
  const result = { found: items.length, added, updated, skipped };
  run('UPDATE workspaces SET store_sync = ? WHERE id = ?', JSON.stringify({ source: c.source, url: c.url, enc: seal(ws.id, 'store.secret', JSON.stringify({ key: c.key, secret: c.secret })),
    last_sync: new Date().toISOString(), last_result: result }), ws.id);
  logActivity(ws.id, 'catalog_sync', { detail: JSON.stringify(result) });
  return result;
}

/** Worker: re-sync connected stores once a day. */
export async function syncStores() {
  for (const ws of all(`SELECT * FROM workspaces WHERE store_sync IS NOT NULL AND (json_extract(store_sync, '$.last_sync') IS NULL OR json_extract(store_sync, '$.last_sync') < ?)`,
    new Date(Date.now() - 23 * 3600_000).toISOString())) {
    await syncProducts(ws).catch((e) => logActivity(ws.id, 'send_failed', { error: `Product sync: ${e.message}` }));
  }
}
