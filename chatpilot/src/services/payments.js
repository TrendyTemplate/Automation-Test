// bKash / Nagad / Rocket advance payments: the assistant tells the customer where to send money,
// reads the Transaction ID (TrxID) they reply with, and the order waits for a person to verify it in the app.
import { one, run, logActivity } from '../db.js';

export const METHODS = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', upay: 'Upay' };
export const ADVANCE = ['none', 'delivery', 'full', 'risky'];
const DEFAULT = { methods: {}, account_type: 'personal', advance: 'none', note: '' };

export function paymentSettings(ws) {
  try { return { ...DEFAULT, ...JSON.parse(ws.payment_json || '{}') }; } catch { return { ...DEFAULT }; }
}

export function validatePayment(b = {}) {
  const methods = {};
  for (const k of Object.keys(METHODS)) {
    const n = String(b.methods?.[k] || '').replace(/[\s-]/g, '');
    if (!n) continue;
    if (!/^(\+?88)?01[3-9]\d{8}$/.test(n)) throw Object.assign(new Error(`${METHODS[k]}: enter an 11-digit number like 01712345678`), { status: 400 });
    methods[k] = n.replace(/^\+?88/, '');
  }
  if (!ADVANCE.includes(b.advance || 'none')) throw Object.assign(new Error('Invalid advance rule'), { status: 400 });
  return { methods, account_type: ['personal', 'merchant', 'agent'].includes(b.account_type) ? b.account_type : 'personal', advance: b.advance || 'none', note: String(b.note || '').trim().slice(0, 400) };
}

/** Prompt block for the assistant. */
export function paymentText(ws) {
  const p = paymentSettings(ws);
  const list = Object.entries(p.methods).map(([k, n]) => `${METHODS[k]} ${p.account_type} ${n}${p.account_type === 'merchant' ? ' (Payment)' : ' (Send Money)'}`);
  if (!list.length) return 'Payment: cash on delivery only.';
  const rule = { none: 'Cash on delivery is fine; advance payment is optional.', delivery: 'Ask for the delivery charge in advance before confirming; the rest is cash on delivery.',
    full: 'Ask for full payment in advance.', risky: 'Cash on delivery is fine, except when told an order is risky: then ask for the delivery charge in advance.' }[p.advance];
  return `<payment>Payment methods: cash on delivery, ${list.join(', ')}. ${rule}${p.note ? ` ${p.note}` : ''}
When the customer says they paid, ask for the Transaction ID (TrxID) and the number they paid from, and put them in payment.trx_id / payment.method / payment.amount. Never say a payment is received or verified — say the team will check it.</payment>`;
}

const TRX = /^[A-Z0-9]{8,12}$/;

/**
 * Attach a customer's claimed payment to their order (the one just created, or their latest open order).
 * The order stays "unpaid" until a person verifies it. A TrxID already used on another order is flagged.
 */
export function recordClaim(wsId, convId, orderId, pay = {}) {
  const trx = String(pay.trx_id || '').toUpperCase().replace(/\s/g, '');
  if (!TRX.test(trx)) return null;
  const order = orderId ? one('SELECT * FROM orders WHERE id = ?', orderId)
    : one(`SELECT * FROM orders WHERE workspace_id = ? AND conversation_id = ? AND status NOT IN ('cancelled', 'returned') AND created_at > datetime('now', '-14 days') ORDER BY id DESC LIMIT 1`, wsId, convId);
  if (!order || order.payment_trx === trx) return null;
  const reused = one('SELECT id FROM orders WHERE workspace_id = ? AND payment_trx = ? AND id <> ?', wsId, trx, order.id);
  const method = METHODS[String(pay.method || '').toLowerCase()] ? String(pay.method).toLowerCase() : 'other';
  const amount = Math.max(0, Math.round(Number(pay.amount) || 0));
  run(`UPDATE orders SET payment_trx = ?, payment_method = ?, payment_claim = ?, payment_check = ? WHERE id = ?`,
    trx, METHODS[method] || 'Mobile banking', amount || null, reused ? 'reused' : 'pending', order.id);
  logActivity(wsId, 'payment_claim', { order: order.id, conversation: convId, error: reused ? `TrxID already used on order #${reused.id}` : null });
  return { orderId: order.id, trx, reused: reused?.id || null, amount };
}

/** A person checked their bKash / Nagad app: accept (marks the amount paid) or reject the claim. */
export function verifyClaim(order, ok, amount) {
  if (!order.payment_trx) throw Object.assign(new Error('No payment to verify'), { status: 400 });
  if (order.payment_check === 'verified') throw Object.assign(new Error('This payment was already verified'), { status: 409 });
  if (!ok) { run(`UPDATE orders SET payment_check = 'rejected' WHERE id = ?`, order.id); return; }
  const paid = Math.max(0, Number(amount ?? order.payment_claim) || 0);
  if (!paid) throw Object.assign(new Error('Enter the amount you received'), { status: 400 });
  const total = Math.round(((Number(order.paid_amount) || 0) + paid) * 100) / 100; // adds to earlier advances
  run(`UPDATE orders SET payment_check = 'verified', paid_amount = ?, payment_status = CASE WHEN ? >= total THEN 'paid' ELSE 'advance' END WHERE id = ?`, total, total, order.id);
}
