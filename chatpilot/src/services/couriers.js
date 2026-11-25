// Bangladesh couriers: book a parcel from an order in one click, keep its status in sync (webhooks + polling),
// and check a phone number's delivery history before shipping cash-on-delivery orders ("fraud check").
// Credentials are the shop's own merchant keys, encrypted per workspace.
import crypto from 'node:crypto';
import { one, all, run } from '../db.js';
import { seal, open } from '../vault.js';
import { setStatus } from './orders.js';

export const COURIERS = {
  steadfast: { label: 'Steadfast', fields: ['api_key', 'secret_key'] },
  pathao: { label: 'Pathao', fields: ['client_id', 'client_secret', 'username', 'password', 'store_id'], optional: ['sandbox'] },
  redx: { label: 'RedX', fields: ['token', 'area_id', 'area_name'], optional: ['pickup_store_id', 'sandbox'] },
  bdcourier: { label: 'BDCourier fraud check', fields: ['api_key'], checkOnly: true },
};
const URLS = {
  steadfast: () => process.env.COURIER_STEADFAST_URL || 'https://portal.packzy.com/api/v1',
  pathao: (c) => process.env.COURIER_PATHAO_URL || (c.sandbox ? 'https://courier-api-sandbox.pathao.com' : 'https://api-hermes.pathao.com'),
  redx: (c) => process.env.COURIER_REDX_URL || (c.sandbox ? 'https://sandbox.redx.com.bd/v1.0.0-beta' : 'https://openapi.redx.com.bd/v1.0.0-beta'),
  bdcourier: () => process.env.COURIER_BDCOURIER_URL || 'https://bdcourier.com/api',
};

// ---------- settings ----------
export function courierConfig(ws) {
  if (!ws.courier_json) return {};
  try { return JSON.parse(open(ws.id, 'couriers.config', ws.courier_json)) || {}; } catch { return {}; }
}
function saveConfig(wsId, cfg) { run('UPDATE workspaces SET courier_json = ? WHERE id = ?', seal(wsId, 'couriers.config', JSON.stringify(cfg)), wsId); }
export const connectedCouriers = (ws) => Object.keys(courierConfig(ws)).filter((k) => COURIERS[k] && !COURIERS[k].checkOnly);
/** Public view of the settings (never the secrets). */
export function courierStatus(ws) {
  const cfg = courierConfig(ws);
  return { connected: connectedCouriers(ws), fraudCheck: Boolean(cfg.bdcourier || cfg.steadfast), webhookToken: ws.courier_hook || null,
    couriers: Object.fromEntries(Object.entries(COURIERS).map(([k, v]) => [k, { label: v.label, connected: Boolean(cfg[k]), sandbox: Boolean(cfg[k]?.sandbox), store_id: cfg[k]?.store_id || null, area_name: cfg[k]?.area_name || null }])) };
}
export async function connectCourier(ws, name, input) {
  const def = COURIERS[name];
  if (!def) throw Object.assign(new Error('Unknown courier'), { status: 400 });
  const creds = {};
  for (const f of def.fields) {
    const v = String(input?.[f] ?? '').trim().slice(0, 300);
    if (!v && !(name === 'redx' && f === 'area_name')) throw Object.assign(new Error(`${def.label}: ${f.replace('_', ' ')} is required`), { status: 400 });
    creds[f] = v;
  }
  for (const f of def.optional || []) if (input?.[f] !== undefined && input[f] !== '') creds[f] = f === 'sandbox' ? Boolean(input[f]) : String(input[f]).slice(0, 100);
  await ADAPTERS[name].test(creds); // reject wrong keys right away
  const cfg = courierConfig(ws);
  cfg[name] = creds;
  saveConfig(ws.id, cfg);
  if (!ws.courier_hook) run('UPDATE workspaces SET courier_hook = ? WHERE id = ?', crypto.randomBytes(18).toString('hex'), ws.id); // secret part of the webhook URL
  return courierStatus(one('SELECT * FROM workspaces WHERE id = ?', ws.id));
}
export function disconnectCourier(ws, name) {
  const cfg = courierConfig(ws);
  delete cfg[name];
  saveConfig(ws.id, cfg);
}

// ---------- HTTP ----------
async function http(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.status && Number(json.status) >= 400) || json.type === 'error') {
    const msg = json.message || json.error || (json.errors && JSON.stringify(json.errors)) || `HTTP ${res.status}`;
    throw Object.assign(new Error(typeof msg === 'string' ? msg.slice(0, 300) : 'Courier error'), { status: 502 });
  }
  return json;
}
const due = (o) => Math.max(0, Math.round(((o.total || 0) - (o.paid_amount || 0)) * 100) / 100);
const itemsText = (o) => JSON.parse(o.items_json).map((l) => `${l.qty}x ${l.name}${l.variant ? ` (${l.variant})` : ''}`).join(', ').slice(0, 250);
const qty = (o) => JSON.parse(o.items_json).reduce((s, l) => s + l.qty, 0);

// ---------- adapters ----------
const pathaoTokens = new Map(); // key -> {token, exp}
async function pathaoToken(c) {
  const key = `${c.client_id}:${c.username}`;
  const t = pathaoTokens.get(key);
  if (t && t.exp > Date.now() + 60_000) return t.token;
  const out = await http(`${URLS.pathao(c)}/aladdin/api/v1/issue-token`, { method: 'POST', body: { client_id: c.client_id, client_secret: c.client_secret, username: c.username, password: c.password, grant_type: 'password' } });
  if (!out.access_token) throw Object.assign(new Error('Pathao did not return a token — check the credentials'), { status: 502 });
  pathaoTokens.set(key, { token: out.access_token, exp: Date.now() + (Number(out.expires_in) || 3600) * 1000 });
  return out.access_token;
}

export const ADAPTERS = {
  steadfast: {
    h: (c) => ({ 'Api-Key': c.api_key, 'Secret-Key': c.secret_key }),
    async test(c) { await http(`${URLS.steadfast()}/get_balance`, { headers: this.h(c) }); },
    async book(c, o) {
      const out = await http(`${URLS.steadfast()}/create_order`, { method: 'POST', headers: this.h(c), body: {
        invoice: `CP${o.workspace_id}-${o.id}`, recipient_name: o.customer_name, recipient_phone: normalizePhone(o.customer_phone), recipient_address: o.customer_address,
        cod_amount: due(o), note: o.note || '', item_description: itemsText(o) } });
      const k = out.consignment || {};
      return { consignment_id: String(k.consignment_id || ''), tracking_code: k.tracking_code || null, courier_status: k.status || 'in_review' };
    },
    async status(c, o) { const out = await http(`${URLS.steadfast()}/status_by_cid/${encodeURIComponent(o.consignment_id)}`, { headers: this.h(c) }); return out.delivery_status || 'unknown'; },
    map(s) { return /^(delivered|partial_delivered)$/.test(s) ? 'delivered' : s === 'cancelled' ? 'returned' : /approval_pending/.test(s) ? null : 'shipped'; },
    async fraud(c, phone) {
      const out = await http(`${URLS.steadfast()}/fraud_check/${encodeURIComponent(phone)}`, { headers: this.h(c) });
      return { source: 'Steadfast', total: Number(out.total_parcels) || 0, delivered: Number(out.total_delivered) || 0, returned: Number(out.total_cancelled) || 0 };
    },
  },
  pathao: {
    async test(c) { const t = await pathaoToken(c); await http(`${URLS.pathao(c)}/aladdin/api/v1/stores`, { headers: { authorization: `Bearer ${t}` } }); },
    async book(c, o) {
      const t = await pathaoToken(c);
      const out = await http(`${URLS.pathao(c)}/aladdin/api/v1/orders`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: {
        store_id: Number(c.store_id), merchant_order_id: `CP${o.workspace_id}-${o.id}`, recipient_name: o.customer_name, recipient_phone: normalizePhone(o.customer_phone),
        recipient_address: o.customer_address, delivery_type: 48, item_type: 2, item_quantity: qty(o), item_weight: 0.5, amount_to_collect: Math.round(due(o)),
        item_description: itemsText(o), special_instruction: o.note || '' } });
      const d = out.data || {};
      return { consignment_id: String(d.consignment_id || ''), tracking_code: String(d.consignment_id || ''), courier_status: d.order_status || 'Pending', fee: d.delivery_fee };
    },
    async status(c, o) { const t = await pathaoToken(c); const out = await http(`${URLS.pathao(c)}/aladdin/api/v1/orders/${encodeURIComponent(o.consignment_id)}/info`, { headers: { authorization: `Bearer ${t}` } }); return out.data?.order_status_slug || out.data?.order_status || 'unknown'; },
    map(s) { const v = String(s).toLowerCase(); return /partial|delivered/.test(v) && !/failed/.test(v) ? 'delivered' : /return/.test(v) ? 'returned' : /cancel/.test(v) ? 'cancelled' : 'shipped'; },
  },
  redx: {
    h: (c) => ({ 'API-ACCESS-TOKEN': `Bearer ${c.token}` }),
    async test(c) { await http(`${URLS.redx(c)}/areas`, { headers: this.h(c) }); },
    async book(c, o) {
      const out = await http(`${URLS.redx(c)}/parcel`, { method: 'POST', headers: this.h(c), body: {
        customer_name: o.customer_name, customer_phone: normalizePhone(o.customer_phone), delivery_area: c.area_name || '', delivery_area_id: Number(c.area_id),
        customer_address: o.customer_address, merchant_invoice_id: `CP${o.workspace_id}-${o.id}`, cash_collection_amount: String(Math.round(due(o))), parcel_weight: '500',
        value: String(Math.round(o.total)), instruction: o.note || '', ...(c.pickup_store_id ? { pickup_store_id: Number(c.pickup_store_id) } : {}) } });
      return { consignment_id: String(out.tracking_id || ''), tracking_code: String(out.tracking_id || ''), courier_status: 'ready-for-delivery' };
    },
    async status(c, o) { const out = await http(`${URLS.redx(c)}/parcel/info/${encodeURIComponent(o.consignment_id)}`, { headers: this.h(c) }); return out.parcel?.status || 'unknown'; },
    map(s) { return s === 'delivered' ? 'delivered' : /return/.test(s) ? 'returned' : 'shipped'; },
  },
  bdcourier: {
    async test(c) { await this.fraud(c, '01700000000'); },
    async fraud(c, phone) {
      const out = await http(`${URLS.bdcourier()}/courier-check?phone=${encodeURIComponent(phone)}`, { method: 'POST', headers: { authorization: `Bearer ${c.api_key}` }, body: { phone } });
      const d = out.data || out.courierData || {};
      const s = d.summary || {};
      return { source: 'BDCourier', total: Number(s.total_parcel) || 0, delivered: Number(s.success_parcel) || 0, returned: Number(s.cancelled_parcel) || 0,
        couriers: Object.entries(d).filter(([k, v]) => k !== 'summary' && v && typeof v === 'object').map(([k, v]) => ({ name: v.name || k, total: Number(v.total_parcel) || 0, delivered: Number(v.success_parcel) || 0 })) };
    },
  },
};

// ---------- booking & status ----------
export async function bookParcel(ws, order, name) {
  const cfg = courierConfig(ws);
  if (!ADAPTERS[name]?.book || !cfg[name]) throw Object.assign(new Error('Connect this courier first'), { status: 400 });
  if (order.consignment_id) throw Object.assign(new Error(`Already booked with ${COURIERS[order.courier]?.label || order.courier}`), { status: 409 });
  if (['cancelled', 'returned', 'delivered'].includes(order.status)) throw Object.assign(new Error(`Order is ${order.status}`), { status: 409 });
  if (!order.customer_phone || !order.customer_address) throw Object.assign(new Error('The order needs a phone number and an address'), { status: 400 });
  const r = await ADAPTERS[name].book(cfg[name], order);
  if (!r.consignment_id) throw Object.assign(new Error('The courier did not return a consignment id'), { status: 502 });
  run(`UPDATE orders SET courier = ?, consignment_id = ?, tracking_code = ?, courier_status = ?, courier_updated_at = datetime('now') WHERE id = ?`, name, r.consignment_id, r.tracking_code, r.courier_status, order.id);
  const fresh = one('SELECT * FROM orders WHERE id = ?', order.id);
  if (['new', 'confirmed', 'packed'].includes(fresh.status)) setStatus(fresh, 'shipped');
  return one('SELECT * FROM orders WHERE id = ?', order.id);
}

/** Apply a courier status to an order. Returns true if our order status changed. */
export async function applyCourierStatus(order, raw) {
  const mapped = ADAPTERS[order.courier]?.map(String(raw || ''));
  run(`UPDATE orders SET courier_status = ?, courier_updated_at = datetime('now') WHERE id = ?`, String(raw || '').slice(0, 60), order.id);
  if (!mapped || mapped === order.status) return false;
  const changed = setStatus(one('SELECT * FROM orders WHERE id = ?', order.id), mapped);
  if (changed) { const { notifyOrderStatus } = await import('./notifications.js'); await notifyOrderStatus(order.id).catch(() => {}); }
  return changed;
}
export async function refreshStatus(ws, order) {
  const cfg = courierConfig(ws);
  if (!order.consignment_id || !cfg[order.courier]) throw Object.assign(new Error('This order is not booked with a connected courier'), { status: 400 });
  const raw = await ADAPTERS[order.courier].status(cfg[order.courier], order);
  await applyCourierStatus(order, raw);
  return one('SELECT * FROM orders WHERE id = ?', order.id);
}
/** Worker: poll open parcels every couple of hours (webhooks make this faster when configured). */
export async function syncParcels() {
  const rows = all(`SELECT o.* FROM orders o WHERE o.consignment_id IS NOT NULL AND o.status IN ('shipped', 'packed', 'confirmed')
    AND (o.courier_updated_at IS NULL OR o.courier_updated_at < datetime('now', '-2 hours')) ORDER BY o.courier_updated_at LIMIT 50`);
  for (const o of rows) {
    const ws = one('SELECT * FROM workspaces WHERE id = ?', o.workspace_id);
    try { await refreshStatus(ws, o); } catch (e) {
      run(`UPDATE orders SET courier_updated_at = datetime('now') WHERE id = ?`, o.id); // try again later, not every tick
      console.error('[courier]', e.message);
    }
  }
  return rows.length;
}

// ---------- fraud check ----------
const BN = '০১২৩৪৫৬৭৮৯';
/** 01XXXXXXXXX from "+880 1711-000 000", "০১৭১১০০০০০০" … (non-BD numbers are returned cleaned). */
export function normalizePhone(p) {
  const d = String(p || '').replace(/[০-৯]/g, (c) => String(BN.indexOf(c))).replace(/\D/g, '');
  if (d.startsWith('8801') && d.length === 13) return d.slice(2);
  if (d.startsWith('1') && d.length === 10) return `0${d}`;
  return d;
}
/** Delivery history for a phone: this shop's own orders + Steadfast / BDCourier when connected. */
export async function fraudCheck(ws, phone) {
  const p = normalizePhone(phone);
  if (p.length < 10) throw Object.assign(new Error('Enter a valid phone number'), { status: 400 });
  const own = all(`SELECT status, customer_phone FROM orders WHERE workspace_id = ?`, ws.id).filter((o) => normalizePhone(o.customer_phone) === p);
  const sources = [];
  let total = 0; let delivered = 0; let returned = 0;
  const finished = own.filter((o) => ['delivered', 'returned', 'cancelled'].includes(o.status));
  if (finished.length) {
    sources.push('your orders');
    total += finished.length; delivered += finished.filter((o) => o.status === 'delivered').length; returned += finished.filter((o) => o.status !== 'delivered').length;
  }
  const cfg = courierConfig(ws);
  const ext = cfg.bdcourier ? await ADAPTERS.bdcourier.fraud(cfg.bdcourier, p).catch(() => null) : cfg.steadfast ? await ADAPTERS.steadfast.fraud(cfg.steadfast, p).catch(() => null) : null;
  let couriers = [];
  if (ext?.total) { sources.push(ext.source); total += ext.total; delivered += ext.delivered; returned += ext.returned; couriers = ext.couriers || []; }
  return { phone: p, total, delivered, returned, ratio: total ? Math.round((delivered / total) * 100) : null, sources, couriers, open: own.length - finished.length };
}

/** Courier webhook (Steadfast / Pathao / RedX call it when a parcel moves). The URL carries the shop's secret. */
export async function handleCourierWebhook(token, body) {
  const ws = /^[a-f0-9]{36}$/.test(String(token)) ? one('SELECT * FROM workspaces WHERE courier_hook = ?', token) : null;
  if (!ws) return { status: 404 };
  const id = body?.consignment_id ?? body?.tracking_number ?? body?.tracking_id;
  const raw = body?.status ?? body?.delivery_status ?? (body?.event ? String(body.event).replace(/^order\./, '') : null);
  if (!id || !raw) return { status: 200, ignored: true }; // tracking messages etc.
  const order = one('SELECT * FROM orders WHERE workspace_id = ? AND consignment_id = ?', ws.id, String(id));
  if (!order) return { status: 200, ignored: true };
  await applyCourierStatus(order, raw);
  return { status: 200, updated: order.id };
}
