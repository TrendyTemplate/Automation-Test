import express from 'express';
import { all, get, run } from '../db.js';
import { sha256, unsign } from '../crypto.js';
import { config } from '../config.js';
import { importCatalogRows } from '../connectors/csv.js';
import { parseCsv } from '../core/extract.js';
import { label } from '../core/match.js';
import { getStore, syncCatalog, ingestFile, ingestEmail, correctLine, approve, reject, refreshStatus, maybeAutoCreate } from '../core/pipeline.js';

export const api = express.Router();
const raw = express.raw({ type: () => true, limit: config.maxAttachmentBytes });

// ---------- inbound email (no session: the secret token in the address authenticates the store) ----------
// Point a forwarding rule or an inbound-email service (Postmark, Mailgun, SES) at POST /inbound/<token> with the raw message.
export const inbound = express.Router();
inbound.post('/inbound/:token', express.raw({ type: () => true, limit: '30mb' }), async (req, res, next) => {
  try {
    const store = get('SELECT * FROM stores WHERE inbound_token = ?', String(req.params.token));
    if (!store) return res.status(404).json({ error: 'Unknown address' });
    if (!req.body?.length) return res.status(400).json({ error: 'Empty message' });
    const ids = await ingestEmail(store, req.body);
    for (const id of ids) await maybeAutoCreate(store, id);
    res.json({ ok: true, purchase_orders: ids });
  } catch (e) { next(e); }
});

// ---------- auth: Bearer API key or signed session cookie ----------
api.use((req, res, next) => {
  let store = null;
  const auth = req.get('authorization') || '';
  if (auth.startsWith('Bearer ')) store = get('SELECT * FROM stores WHERE api_key_hash = ?', sha256(auth.slice(7).trim()));
  else {
    const id = unsign(req.cookies?.od_store);
    if (id) store = getStore(Number(id));
  }
  if (!store) return res.status(401).json({ error: 'Not signed in' });
  req.store = store;
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const poOf = (req) => get('SELECT * FROM purchase_orders WHERE id = ? AND store_id = ?', Number(req.params.id), req.store.id);

api.get('/me', (req, res) => {
  const s = req.store;
  res.json({
    id: s.id, name: s.name, platform: s.platform, shop_domain: s.shop_domain, currency: s.currency, auto_create: Boolean(s.auto_create),
    catalog_synced_at: s.catalog_synced_at,
    catalog_count: get('SELECT COUNT(*) AS n FROM catalog_items WHERE store_id = ?', s.id).n,
    inbound_url: `${config.appUrl}/inbound/${s.inbound_token}`,
  });
});

api.patch('/settings', express.json(), (req, res) => {
  if (typeof req.body?.auto_create === 'boolean') run('UPDATE stores SET auto_create = ? WHERE id = ?', req.body.auto_create ? 1 : 0, req.store.id);
  res.json({ ok: true });
});

api.get('/stats', (req, res) => {
  const id = req.store.id;
  const byStatus = Object.fromEntries(all('SELECT status, COUNT(*) AS n FROM purchase_orders WHERE store_id = ? GROUP BY status', id).map((r) => [r.status, r.n]));
  const lines = get(`SELECT COUNT(*) AS total, SUM(CASE WHEN l.corrected = 0 AND l.matched_external_id IS NOT NULL THEN 1 ELSE 0 END) AS auto
                     FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id WHERE p.store_id = ? AND p.status = 'created'`, id);
  res.json({
    by_status: byStatus,
    lines_created: lines.total || 0,
    auto_match_rate: lines.total ? Math.round((100 * (lines.auto || 0)) / lines.total) : null,
    // Conservative industry rule of thumb: ~1 minute of manual entry per line.
    minutes_saved_estimate: lines.total || 0,
    learned_codes: get('SELECT COUNT(*) AS n FROM customer_sku_map WHERE store_id = ?', id).n,
  });
});

// ---------- catalog ----------
api.post('/catalog/sync', wrap(async (req, res) => {
  if (req.store.platform === 'csv') return res.status(400).json({ error: 'Upload your catalog CSV instead' });
  res.json({ ok: true, items: await syncCatalog(req.store) });
}));

api.post('/catalog/import', express.text({ type: () => true, limit: '20mb' }), (req, res) => {
  if (req.store.platform !== 'csv') return res.status(400).json({ error: 'Catalog comes from your store; use sync' });
  const rows = parseCsv(String(req.body || ''));
  if (rows.length < 2) return res.status(400).json({ error: 'Expected a header row and at least one item' });
  const head = rows[0].map((h) => String(h).trim().toLowerCase());
  const objs = rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, String(r[i] ?? '').trim()])));
  res.json({ ok: true, items: importCatalogRows(req.store.id, objs) });
});

api.get('/catalog', (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = q
    ? all(`SELECT * FROM catalog_items WHERE store_id = ? AND (sku LIKE ? OR barcode LIKE ? OR title LIKE ? OR variant_title LIKE ?)
           ORDER BY (sku = ?) DESC, title LIMIT 25`, req.store.id, like, like, like, like, q)
    : all('SELECT * FROM catalog_items WHERE store_id = ? ORDER BY title LIMIT 25', req.store.id);
  res.json(rows.map((c) => ({ external_id: c.external_id, sku: c.sku, barcode: c.barcode, title: label(c), price: c.price, inventory: c.inventory, case_pack: c.case_pack })));
});

api.patch('/catalog/:externalId', express.json(), (req, res) => {
  const cp = Number(req.body?.case_pack);
  if (!Number.isInteger(cp) || cp < 1 || cp > 10000) return res.status(400).json({ error: 'case_pack must be a whole number ≥ 1' });
  const r = run('UPDATE catalog_items SET case_pack = ? WHERE store_id = ? AND external_id = ?', cp, req.store.id, req.params.externalId);
  if (!r.changes) return res.status(404).json({ error: 'Item not found' });
  res.json({ ok: true });
});

// ---------- purchase orders ----------
api.post('/pos', raw, wrap(async (req, res) => {
  if (!req.body?.length) return res.status(400).json({ error: 'Empty file' });
  const filename = decodeURIComponent(req.get('x-filename') || 'upload');
  const id = await ingestFile(req.store, { filename, contentType: req.get('content-type') || '', content: req.body }, { source: 'upload' });
  if (!id) return res.status(422).json({ error: 'This does not look like a purchase order' });
  await maybeAutoCreate(req.store, id);
  res.status(201).json({ id });
}));

api.get('/pos', (req, res) => {
  const status = String(req.query.status || '');
  const rows = all(`SELECT p.id, p.po_number, p.status, p.company_name, p.customer_name, p.sender_email, p.source, p.source_filename,
      p.order_name, p.order_url, p.created_at, p.flags_json,
      (SELECT COUNT(*) FROM po_lines l WHERE l.po_id = p.id) AS line_count
    FROM purchase_orders p WHERE p.store_id = ? ${status ? 'AND p.status = ?' : ''} ORDER BY p.id DESC LIMIT 200`,
  ...(status ? [req.store.id, status] : [req.store.id]));
  res.json(rows.map(({ flags_json: f, ...r }) => ({ ...r, flags: JSON.parse(f) })));
});

api.get('/pos/:id', (req, res) => {
  const po = poOf(req);
  if (!po) return res.status(404).json({ error: 'Not found' });
  const lines = all(`SELECT l.*, c.sku, c.title, c.variant_title, c.price AS catalog_price, c.inventory, c.case_pack
    FROM po_lines l LEFT JOIN catalog_items c ON c.store_id = ? AND c.external_id = l.matched_external_id WHERE l.po_id = ? ORDER BY l.line_no`, req.store.id, po.id);
  const { flags_json: f, ship_to_json: st, ...rest } = po;
  res.json({
    ...rest,
    flags: JSON.parse(f),
    ship_to: JSON.parse(st || '{}'),
    lines: lines.map(({ flags_json: lf, candidates_json: cj, ...l }) => ({
      ...l, flags: JSON.parse(lf), candidates: JSON.parse(cj), matched_label: l.title ? label(l) : null,
    })),
  });
});

api.patch('/pos/:id/lines/:lineId', express.json(), (req, res) => {
  const body = req.body || {};
  const status = correctLine(req.store, Number(req.params.id), Number(req.params.lineId), {
    external_id: 'external_id' in body ? (body.external_id || null) : undefined,
    quantity: 'quantity' in body ? body.quantity : undefined,
  });
  res.json({ ok: true, status });
});

api.post('/pos/:id/acknowledge', (req, res) => {
  // Merchant reviewed PO-level warnings (duplicate, unknown buyer, …) and wants to continue.
  const po = poOf(req);
  if (!po) return res.status(404).json({ error: 'Not found' });
  run('UPDATE purchase_orders SET flags_json = ? WHERE id = ?', JSON.stringify(JSON.parse(po.flags_json).filter((f) => f === 'unknown_customer')), po.id);
  run('UPDATE po_lines SET corrected = 1, confidence = 1 WHERE po_id = ? AND matched_external_id IS NOT NULL', po.id);
  res.json({ ok: true, status: refreshStatus(po.id) });
});

api.post('/pos/:id/approve', wrap(async (req, res) => {
  res.json({ ok: true, order: await approve(req.store, Number(req.params.id)) });
}));

api.post('/pos/:id/reject', (req, res) => {
  reject(req.store, Number(req.params.id));
  res.json({ ok: true });
});

// Created orders as CSV — for the no-platform connector, accounting import, or a Google Sheet.
api.get('/orders.csv', (req, res) => {
  const rows = all(`SELECT p.order_name, p.po_number, p.company_name, p.buyer_email, p.requested_ship_date, l.line_no, c.sku, c.title,
      c.variant_title, l.final_quantity, c.price
    FROM purchase_orders p JOIN po_lines l ON l.po_id = p.id LEFT JOIN catalog_items c ON c.store_id = p.store_id AND c.external_id = l.matched_external_id
    WHERE p.store_id = ? AND p.status = 'created' AND l.final_quantity > 0 ORDER BY p.id, l.line_no`, req.store.id);
  const head = ['order', 'po_number', 'company', 'buyer_email', 'ship_date', 'line', 'sku', 'title', 'variant', 'quantity', 'unit_price'];
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // block spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [head.join(','), ...rows.map((r) => [r.order_name, r.po_number, r.company_name, r.buyer_email, r.requested_ship_date, r.line_no,
    r.sku, r.title, r.variant_title, r.final_quantity, r.price].map(esc).join(','))].join('\n');
  res.type('text/csv').attachment('orders.csv').send(body);
});
