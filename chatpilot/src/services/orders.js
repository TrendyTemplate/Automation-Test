// Orders: catalog pricing, delivery zones (e.g. inside / outside Dhaka), totals, stock and status changes.
// Every amount is computed here from the shop's own settings — never taken from the AI.
import { one, all, run, tx, logActivity } from '../db.js';

export const STATUSES = ['new', 'confirmed', 'packed', 'shipped', 'delivered', 'returned', 'cancelled'];
export const PAYMENT = ['unpaid', 'advance', 'paid', 'refunded'];
const RESTOCK = new Set(['cancelled', 'returned']);

export const DEFAULT_ZONES = [
  { name: 'Inside Dhaka', charge: 70, match: 'dhaka, ঢাকা, mirpur, uttara, dhanmondi, gulshan, banani, mohammadpur, badda, motijheel' },
  { name: 'Outside Dhaka', charge: 130, match: '' },
];
/** The shop's delivery settings: zones (first keyword match wins, last zone = everywhere else) + free delivery threshold. */
export function deliverySettings(ws) {
  let d = null;
  try { d = ws?.delivery_json ? JSON.parse(ws.delivery_json) : null; } catch { d = null; }
  return { zones: Array.isArray(d?.zones) ? d.zones : DEFAULT_ZONES, free_over: Number(d?.free_over) || 0, enabled: d?.enabled !== false };
}
export function validateDelivery(input) {
  const zones = (Array.isArray(input?.zones) ? input.zones : []).slice(0, 12).map((z) => ({
    name: String(z.name || '').trim().slice(0, 60), charge: Number(z.charge), match: String(z.match || '').slice(0, 500),
  }));
  for (const z of zones) if (!z.name || !(z.charge >= 0 && z.charge < 100000)) throw new Error('Each delivery zone needs a name and a charge (0 or more)');
  const free = Number(input?.free_over) || 0;
  if (free < 0) throw new Error('Free-delivery amount must be 0 or more');
  return { enabled: input?.enabled !== false, zones, free_over: free };
}
export function deliveryText(ws) {
  const d = deliverySettings(ws);
  if (!d.enabled || !d.zones.length) return '';
  return `Delivery charges (added automatically to every order):\n${d.zones.map((z) => `- ${z.name}: ${z.charge}`).join('\n')}${d.free_over ? `\n- Free delivery for orders of ${d.free_over} or more` : ''}`;
}

/** Which zone an address falls into. The AI may suggest a zone name; keywords in the address are the fallback. */
export function pickZone(ws, address, suggested = '') {
  const d = deliverySettings(ws);
  if (!d.enabled || !d.zones.length) return null;
  const byName = d.zones.find((z) => suggested && z.name.toLowerCase() === String(suggested).toLowerCase());
  if (byName) return byName;
  const a = String(address || '').toLowerCase();
  if (a) {
    for (const z of d.zones) {
      const keys = z.match.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
      if (keys.some((k) => a.includes(k))) return z;
    }
  }
  return a ? d.zones[d.zones.length - 1] : null;
}

const r2 = (n) => Math.round(n * 100) / 100;
/** Price an order from catalog prices + delivery zone. */
export function priceOrder(wsId, items, { address = '', zone = '', discount = 0 } = {}) {
  const ws = one('SELECT * FROM workspaces WHERE id = ?', wsId);
  const problems = [];
  const lines = [];
  for (const it of (items || []).slice(0, 30)) {
    const p = one('SELECT * FROM products WHERE id = ? AND workspace_id = ? AND active = 1', Number(it.product_id), wsId);
    const qty = Math.round(Number(it.qty));
    if (!p) { problems.push(`unknown product id ${it.product_id}`); continue; }
    if (!(qty >= 1 && qty <= 1000)) { problems.push(`invalid quantity for ${p.name}`); continue; }
    if (p.stock != null && p.stock < qty) { problems.push(`${p.name}: only ${Math.max(0, p.stock)} in stock`); continue; }
    lines.push({ product_id: p.id, name: p.name, sku: p.sku || '', qty, price: p.price, variant: String(it.variant || '').slice(0, 100), currency: p.currency });
  }
  if (new Set(lines.map((l) => l.currency)).size > 1) problems.push('items use different currencies');
  const subtotal = r2(lines.reduce((s, l) => s + l.price * l.qty, 0));
  const z = lines.length ? pickZone(ws, address, zone) : null;
  const d = deliverySettings(ws);
  const delivery = z ? (d.free_over && subtotal >= d.free_over ? 0 : Number(z.charge) || 0) : 0;
  const disc = Math.max(0, Math.min(subtotal, Number(discount) || 0));
  return { lines, subtotal, delivery: { zone: z?.name || null, charge: delivery }, discount: disc, total: r2(subtotal + delivery - disc), currency: lines[0]?.currency || 'BDT', problems };
}

const money = (n, cur) => `${cur} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
export function orderSummary(priced, o = {}) {
  const rows = priced.lines.map((l) => `• ${l.name}${l.variant ? ` (${l.variant})` : ''} × ${l.qty} = ${money(l.price * l.qty, l.currency)}`);
  return [...rows,
    `Subtotal: ${money(priced.subtotal, priced.currency)}`,
    priced.delivery?.zone ? `Delivery (${priced.delivery.zone}): ${priced.delivery.charge ? money(priced.delivery.charge, priced.currency) : 'free'}` : '',
    priced.discount ? `Discount: -${money(priced.discount, priced.currency)}` : '',
    `Total: ${money(priced.total, priced.currency)}`,
    [o.customer_name, o.phone, o.address].filter(Boolean).join(', ')].filter(Boolean).join('\n');
}

/** Create an order (from chat or by hand). Reduces stock. Returns the order id. */
export function createOrder(wsId, { conversationId = null, priced, name, phone, address, note = '', source = 'chat', paymentStatus = 'unpaid', paidAmount = 0, paymentMethod = null }) {
  return tx(() => {
    const id = Number(run(`INSERT INTO orders (workspace_id, conversation_id, items_json, subtotal, delivery_zone, delivery_charge, discount, total, currency,
      customer_name, customer_phone, customer_address, note, source, payment_status, paid_amount, payment_method) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    wsId, conversationId, JSON.stringify(priced.lines), priced.subtotal, priced.delivery?.zone || null, priced.delivery?.charge || 0, priced.discount || 0, priced.total, priced.currency,
    name, phone, address, String(note || '').slice(0, 500), source, PAYMENT.includes(paymentStatus) ? paymentStatus : 'unpaid', Number(paidAmount) || 0, paymentMethod).lastInsertRowid);
    for (const l of priced.lines) run('UPDATE products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL', l.qty, l.product_id);
    return id;
  });
}

/** Change status; cancelling/returning puts the items back in stock (once). */
export function setStatus(order, status) {
  if (!STATUSES.includes(status)) throw new Error('Invalid status');
  if (order.status === status) return false;
  tx(() => {
    const items = JSON.parse(order.items_json);
    if (RESTOCK.has(status) && !RESTOCK.has(order.status)) for (const l of items) run('UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL', l.qty, l.product_id);
    if (!RESTOCK.has(status) && RESTOCK.has(order.status)) for (const l of items) run('UPDATE products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL', l.qty, l.product_id);
    run(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`, status, order.id);
  });
  logActivity(order.workspace_id, 'order_status', { order: order.id, conversation: order.conversation_id, status });
  return true;
}

/** Replace an order's items/address/zone/discount (recomputes totals and stock). */
export function editOrder(order, { items, address, zone, discount }) {
  const oldItems = JSON.parse(order.items_json);
  return tx(() => {
    for (const l of oldItems) run('UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL', l.qty, l.product_id); // release first
    const priced = priceOrder(order.workspace_id, items ?? oldItems, { address: address ?? order.customer_address, zone: zone !== undefined ? zone : (address !== undefined ? '' : order.delivery_zone), /* a new address picks its zone again */ discount: discount ?? order.discount });
    if (priced.problems.length || !priced.lines.length) throw Object.assign(new Error(priced.problems.join('; ') || 'An order needs at least one product'), { status: 400 });
    for (const l of priced.lines) run('UPDATE products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL', l.qty, l.product_id);
    run(`UPDATE orders SET items_json = ?, subtotal = ?, delivery_zone = ?, delivery_charge = ?, discount = ?, total = ?, currency = ?, updated_at = datetime('now') WHERE id = ?`,
      JSON.stringify(priced.lines), priced.subtotal, priced.delivery.zone, priced.delivery.charge, priced.discount, priced.total, priced.currency, order.id);
    return priced;
  });
}
void all;
