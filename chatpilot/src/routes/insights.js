// Customers (CRM built from chats + orders) and analytics (speed, automation, conversion, revenue by page / ad / product).
import { Router } from 'express';
import { one, all, run, audit } from '../db.js';
import { requireRole } from '../auth.js';
import { normalizePhone } from '../services/couriers.js';

const r = Router();
const wsId = (req) => req.workspace.id;
const int = (v) => Number.parseInt(v, 10);

/** One row per customer (phone number); customers who never gave a phone are grouped by chat. */
function customers(id) {
  const orders = all('SELECT id, customer_name, customer_phone, customer_address, total, currency, status, created_at, conversation_id FROM orders WHERE workspace_id = ?', id);
  const convs = all(`SELECT v.id, v.customer_name, v.customer_phone, v.customer_address, v.lead_score, v.last_inbound_at, v.labels, c.platform FROM conversations v JOIN channels c ON c.id = v.channel_id
    WHERE v.workspace_id = ? AND v.kind = 'message'`, id);
  const map = new Map();
  const get = (key, seed) => { if (!map.has(key)) map.set(key, { key, name: '', phone: '', address: '', platforms: new Set(), conversations: [], orders: 0, delivered: 0, returned: 0, spent: 0, open: 0, currency: 'BDT', last: '', lead: 0, labels: new Set(), ...seed }); return map.get(key); };
  for (const v of convs) {
    const ph = normalizePhone(v.customer_phone);
    const c = get(ph.length >= 10 ? `p:${ph}` : `c:${v.id}`, {});
    c.name ||= v.customer_name || ''; c.phone ||= ph.length >= 10 ? ph : ''; c.address ||= v.customer_address || '';
    c.platforms.add(v.platform); c.conversations.push(v.id); c.lead = Math.max(c.lead, v.lead_score || 0);
    for (const l of (v.labels || '').split(',').filter(Boolean)) c.labels.add(l);
    if ((v.last_inbound_at || '') > c.last) c.last = v.last_inbound_at;
  }
  for (const o of orders) {
    const ph = normalizePhone(o.customer_phone);
    const c = get(ph.length >= 10 ? `p:${ph}` : (o.conversation_id ? `c:${o.conversation_id}` : `o:${o.id}`), {});
    c.name ||= o.customer_name || ''; c.phone ||= ph; c.address ||= o.customer_address || ''; c.currency = o.currency;
    c.orders++;
    if (o.status === 'delivered') { c.delivered++; c.spent += o.total; }
    else if (['returned', 'cancelled'].includes(o.status)) c.returned++;
    else c.open++;
    if (o.created_at > c.last) c.last = o.created_at;
  }
  return [...map.values()].map((c) => ({ ...c, platforms: [...c.platforms], labels: [...c.labels], spent: Math.round(c.spent * 100) / 100,
    ratio: c.delivered + c.returned ? Math.round((c.delivered / (c.delivered + c.returned)) * 100) : null }));
}

r.get('/customers', (req, res) => {
  let list = customers(wsId(req));
  const q = String(req.query.q || '').toLowerCase().trim();
  if (q) list = list.filter((c) => `${c.name} ${c.phone} ${c.address} ${c.labels.join(' ')}`.toLowerCase().includes(q));
  if (req.query.segment === 'buyers') list = list.filter((c) => c.delivered > 0);
  if (req.query.segment === 'repeat') list = list.filter((c) => c.delivered > 1);
  if (req.query.segment === 'leads') list = list.filter((c) => !c.orders && c.lead >= 50);
  if (req.query.segment === 'risky') list = list.filter((c) => c.ratio !== null && c.ratio < 50);
  const sort = { spent: (a, b) => b.spent - a.spent, orders: (a, b) => b.orders - a.orders }[req.query.sort] || ((a, b) => String(b.last).localeCompare(String(a.last)));
  res.json(list.sort(sort).slice(0, 1000));
});
r.get('/customers.csv', (req, res) => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
  res.type('text/csv').attachment('customers.csv').send(['name,phone,address,channels,orders,delivered,returned,spent,currency,labels,last_seen',
    ...customers(wsId(req)).map((c) => [c.name, c.phone, c.address, c.platforms.join(' '), c.orders, c.delivered, c.returned, c.spent, c.currency, c.labels.join(' '), c.last].map(q).join(','))].join('\n'));
});

r.get('/analytics', (req, res) => {
  const id = wsId(req);
  const days = Math.max(1, Math.min(365, int(req.query.days) || 30));
  const since = `-${days} days`;
  const n = (sql, ...p) => one(sql, ...p)?.n || 0;
  const msgs = one(`SELECT SUM(direction = 'in') AS inbound, SUM(direction = 'out' AND status = 'sent') AS sent,
      SUM(direction = 'out' AND status = 'sent' AND source = 'ai' AND sent_by IS NULL) AS ai_auto, SUM(direction = 'out' AND status = 'sent' AND source = 'ai' AND sent_by IS NOT NULL) AS ai_approved,
      SUM(direction = 'out' AND status = 'sent' AND source IN ('human', 'human_app')) AS human
    FROM chat_messages WHERE workspace_id = ? AND created_at > datetime('now', ?)`, id, since);
  const convs = n(`SELECT COUNT(*) AS n FROM conversations WHERE workspace_id = ? AND kind = 'message' AND created_at > datetime('now', ?)`, id, since);
  const converted = n(`SELECT COUNT(DISTINCT o.conversation_id) AS n FROM orders o JOIN conversations v ON v.id = o.conversation_id WHERE o.workspace_id = ? AND v.created_at > datetime('now', ?)`, id, since);
  // First response: time from a conversation's first customer message to the first message we sent.
  const frt = all(`SELECT (julianday(MIN(CASE WHEN m.direction = 'out' AND m.status = 'sent' THEN m.created_at END)) - julianday(MIN(CASE WHEN m.direction = 'in' THEN m.created_at END))) * 86400 AS s
    FROM chat_messages m JOIN conversations v ON v.id = m.conversation_id WHERE v.workspace_id = ? AND v.created_at > datetime('now', ?) GROUP BY v.id`, id, since).map((x) => x.s).filter((x) => x != null && x >= 0).sort((a, b) => a - b);
  const median = frt.length ? Math.round(frt[Math.floor(frt.length / 2)]) : null;
  const orders = one(`SELECT COUNT(*) AS n, SUM(status NOT IN ('cancelled', 'returned')) AS kept, SUM(CASE WHEN status NOT IN ('cancelled', 'returned') THEN total ELSE 0 END) AS value,
      SUM(CASE WHEN status = 'delivered' THEN total ELSE 0 END) AS delivered_value, SUM(status = 'delivered') AS delivered, SUM(status IN ('returned', 'cancelled')) AS lost, MAX(currency) AS currency
    FROM orders WHERE workspace_id = ? AND created_at > datetime('now', ?)`, id, since);
  const byPage = all(`SELECT c.id, c.name, c.platform, COUNT(DISTINCT v.id) AS chats, COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(CASE WHEN o.status NOT IN ('cancelled', 'returned') THEN o.total END), 0) AS value
    FROM channels c LEFT JOIN conversations v ON v.channel_id = c.id AND v.created_at > datetime('now', ?) LEFT JOIN orders o ON o.conversation_id = v.id
    WHERE c.workspace_id = ? GROUP BY c.id ORDER BY value DESC`, since, id);
  const byAd = all(`SELECT json_extract(v.referral_json, '$.ad_id') AS ad_id, MAX(json_extract(v.referral_json, '$.ad_title')) AS ad_title, COUNT(DISTINCT v.id) AS chats, COUNT(DISTINCT o.id) AS orders,
      COALESCE(SUM(CASE WHEN o.status NOT IN ('cancelled', 'returned') THEN o.total END), 0) AS value
    FROM conversations v LEFT JOIN orders o ON o.conversation_id = v.id WHERE v.workspace_id = ? AND v.referral_json IS NOT NULL AND v.created_at > datetime('now', ?)
    GROUP BY ad_id ORDER BY value DESC LIMIT 20`, id, since);
  const products = {};
  for (const o of all(`SELECT items_json FROM orders WHERE workspace_id = ? AND status NOT IN ('cancelled', 'returned') AND created_at > datetime('now', ?)`, id, since)) {
    for (const l of JSON.parse(o.items_json)) { products[l.name] ||= { name: l.name, qty: 0, value: 0 }; products[l.name].qty += l.qty; products[l.name].value += l.qty * l.price; }
  }
  const daily = all(`SELECT d.day, (SELECT COUNT(*) FROM chat_messages m WHERE m.workspace_id = ? AND m.direction = 'in' AND substr(m.created_at, 1, 10) = d.day) AS messages,
      (SELECT COUNT(*) FROM orders o WHERE o.workspace_id = ? AND substr(o.created_at, 1, 10) = d.day) AS orders
    FROM (SELECT DISTINCT substr(created_at, 1, 10) AS day FROM chat_messages WHERE workspace_id = ? AND created_at > datetime('now', ?)
          UNION SELECT DISTINCT substr(created_at, 1, 10) FROM orders WHERE workspace_id = ? AND created_at > datetime('now', ?)) d ORDER BY d.day`, id, id, id, since, id, since);
  // Team: what each person did (typed replies, AI drafts they approved, chats they own and the orders from them).
  const team = all(`SELECT u.id, COALESCE(NULLIF(u.name, ''), u.email) AS name,
      (SELECT COUNT(*) FROM chat_messages m WHERE m.workspace_id = w.workspace_id AND m.sent_by = u.id AND m.status = 'sent' AND m.source = 'human' AND m.created_at > datetime('now', ?)) AS typed,
      (SELECT COUNT(*) FROM chat_messages m WHERE m.workspace_id = w.workspace_id AND m.sent_by = u.id AND m.status = 'sent' AND m.source = 'ai' AND m.created_at > datetime('now', ?)) AS approved,
      (SELECT COUNT(*) FROM conversations v WHERE v.workspace_id = w.workspace_id AND v.assigned_to = u.id) AS assigned,
      (SELECT COUNT(*) FROM orders o JOIN conversations v ON v.id = o.conversation_id WHERE o.workspace_id = w.workspace_id AND v.assigned_to = u.id AND o.created_at > datetime('now', ?)) AS orders
    FROM workspace_members w JOIN users u ON u.id = w.user_id WHERE w.workspace_id = ? ORDER BY typed + approved DESC`, since, since, since, id);
  const waBilling = all(`SELECT m.billing AS category, COUNT(*) AS n FROM chat_messages m JOIN conversations v ON v.id = m.conversation_id JOIN channels c ON c.id = v.channel_id
    WHERE m.workspace_id = ? AND c.platform = 'whatsapp' AND m.billing IS NOT NULL AND m.created_at > datetime('now', ?) GROUP BY m.billing ORDER BY n DESC`, id, since);
  const sentTotal = (msgs.sent || 0);
  res.json({
    days, messages: msgs, conversations: convs, converted, conversion: convs ? Math.round((converted / convs) * 1000) / 10 : 0,
    automation: sentTotal ? Math.round(((msgs.ai_auto || 0) / sentTotal) * 100) : 0, firstResponseSec: median,
    handoffs: n(`SELECT COUNT(*) AS n FROM activity WHERE workspace_id = ? AND type = 'chat_handoff' AND created_at > datetime('now', ?)`, id, since),
    orders, deliveryRate: (orders.delivered || 0) + (orders.lost || 0) ? Math.round(((orders.delivered || 0) / ((orders.delivered || 0) + (orders.lost || 0))) * 100) : null,
    byPage, byAd, team, waBilling, csat: one(`SELECT COUNT(csat) AS n, ROUND(AVG(csat = 3) * 100) AS good FROM conversations WHERE workspace_id = ? AND csat IS NOT NULL AND csat_sent_at > datetime('now', ?)`, id, since), topProducts: Object.values(products).sort((a, b) => b.value - a.value).slice(0, 10), daily,
    learned: n('SELECT COUNT(*) AS n FROM learn_examples WHERE workspace_id = ? AND weight > 0', id),
  });
});

/**
 * Erase a customer (their request, or the shop's): chats, notes, what the assistant learned from them.
 * Orders are kept for the shop's accounts but without name, phone or address.
 */
r.post('/customers/erase', requireRole('owner', 'admin'), (req, res) => {
  const id = wsId(req);
  const ph = normalizePhone(req.body?.phone);
  const convIds = (Array.isArray(req.body?.conversations) ? req.body.conversations : []).map((x) => Number.parseInt(x, 10)).filter(Boolean);
  const byPhone = ph.length >= 10 ? all('SELECT id, customer_phone FROM conversations WHERE workspace_id = ?', id).filter((v) => normalizePhone(v.customer_phone) === ph).map((v) => v.id) : [];
  const ids = [...new Set([...convIds, ...byPhone])].filter((cid) => one('SELECT 1 FROM conversations WHERE id = ? AND workspace_id = ?', cid, id));
  if (!ids.length && ph.length < 10) return res.status(400).json({ error: 'Give the customer\'s phone number or chats' });
  for (const cid of ids) {
    run('DELETE FROM learn_examples WHERE conversation_id = ? AND workspace_id = ?', cid, id);
    run(`UPDATE orders SET customer_name = 'Erased customer', customer_phone = NULL, customer_address = NULL, note = NULL, conversation_id = NULL WHERE conversation_id = ? AND workspace_id = ?`, cid, id);
    run('DELETE FROM conversations WHERE id = ? AND workspace_id = ?', cid, id);
  }
  let orders = 0;
  if (ph.length >= 10) {
    for (const o of all('SELECT id, customer_phone FROM orders WHERE workspace_id = ?', id).filter((o) => normalizePhone(o.customer_phone) === ph)) {
      run(`UPDATE orders SET customer_name = 'Erased customer', customer_phone = NULL, customer_address = NULL, note = NULL WHERE id = ?`, o.id); orders++;
    }
  }
  // Activity lines that named them, and the raw webhook copies (a replay buffer only), go too.
  for (const cid of ids) run(`UPDATE activity SET detail = NULL WHERE workspace_id = ? AND (detail LIKE ? OR detail LIKE ?)`, id, `%"conversation":${cid},%`, `%"conversation":${cid}}%`);
  if (ph.length >= 10) run('UPDATE activity SET detail = NULL WHERE workspace_id = ? AND detail LIKE ?', id, `%${ph.slice(-10)}%`);
  run('DELETE FROM webhook_events WHERE workspace_id = ? AND processed_at IS NOT NULL', id);
  audit(req, 'customer.erase', null, { chats: ids.length, orders });
  res.json({ chats: ids.length, orders });
});

export default r;
