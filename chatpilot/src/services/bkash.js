// bKash Tokenized Checkout: a payment link for an order (advance / delivery charge / full). The customer pays in the
// bKash app or page; ChatPilot executes the payment on the callback and marks the order paid — verified by bKash.
import { one, run, logActivity } from '../db.js';
import { seal, open } from '../vault.js';
import { appUrl } from '../settings.js';

const base = (sandbox) => (process.env.BKASH_BASE_URL || (sandbox ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta' : 'https://tokenized.pay.bka.sh/v1.2.0-beta')).replace(/\/$/, '');

export function bkashSettings(ws) {
  try { const c = JSON.parse(ws.bkash_json || '{}'); return { connected: Boolean(c.app_key && c.secret), sandbox: Boolean(c.sandbox), username: c.username || '' }; } catch { return { connected: false }; }
}
const cfgOf = (ws) => { try { const c = JSON.parse(ws.bkash_json || '{}'); return c.app_key ? { ...c, ...JSON.parse(open(ws.id, 'bkash.secret', c.secret)) } : null; } catch { return null; } };

async function call(cfg, path, body, headers = {}) {
  const res = await fetch(`${base(cfg.sandbox)}/tokenized/checkout/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.statusCode && j.statusCode !== '0000')) throw new Error(j.statusMessage || j.errorMessage || `bKash HTTP ${res.status}`);
  return j;
}
async function grant(cfg) {
  const j = await call(cfg, 'token/grant', { app_key: cfg.app_key, app_secret: cfg.app_secret }, { username: cfg.username, password: cfg.password });
  if (!j.id_token) throw new Error(j.statusMessage || 'bKash did not return a token');
  return j.id_token;
}
const auth = async (cfg) => ({ authorization: await grant(cfg), 'x-app-key': cfg.app_key });

export async function connectBkash(ws, b = {}) {
  if (b.disconnect) { run('UPDATE workspaces SET bkash_json = NULL WHERE id = ?', ws.id); return { connected: false }; }
  for (const k of ['app_key', 'app_secret', 'username', 'password']) if (!b[k]) throw Object.assign(new Error('Enter the app key, app secret, username and password from bKash'), { status: 400 });
  const cfg = { app_key: String(b.app_key).trim(), app_secret: String(b.app_secret).trim(), username: String(b.username).trim(), password: String(b.password), sandbox: Boolean(b.sandbox) };
  try { await grant(cfg); } catch (e) { throw Object.assign(new Error(`bKash refused the keys: ${e.message}`), { status: 400 }); }
  run('UPDATE workspaces SET bkash_json = ? WHERE id = ?', JSON.stringify({ app_key: cfg.app_key, username: cfg.username, sandbox: cfg.sandbox,
    secret: seal(ws.id, 'bkash.secret', JSON.stringify({ app_secret: cfg.app_secret, password: cfg.password })) }), ws.id);
  return bkashSettings(one('SELECT * FROM workspaces WHERE id = ?', ws.id));
}

/** Create a payment for an order. Returns the bKash page URL to send to the customer. */
export async function createPayment(ws, order, amount) {
  const cfg = cfgOf(ws);
  if (!cfg) throw Object.assign(new Error('Connect bKash first (Payments page)'), { status: 400 });
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!(amt >= 1 && amt <= order.total)) throw Object.assign(new Error('Amount must be between 1 and the order total'), { status: 400 });
  const j = await call(cfg, 'create', { mode: '0011', payerReference: String(order.customer_phone || order.id).slice(0, 20), callbackURL: `${appUrl()}/api/pay/bkash/callback`,
    amount: amt.toFixed(2), currency: 'BDT', intent: 'sale', merchantInvoiceNumber: `CP${ws.id}-${order.id}-${Date.now().toString(36)}` }, await auth(cfg));
  if (!j.bkashURL || !j.paymentID) throw new Error('bKash did not return a payment link');
  run('UPDATE orders SET bkash_payment_id = ?, bkash_amount = ? WHERE id = ?', j.paymentID, amt, order.id);
  logActivity(ws.id, 'payment_link', { order: order.id, detail: `bKash ${amt}` });
  return { url: j.bkashURL, paymentID: j.paymentID, amount: amt };
}

/** bKash sends the customer back here. Execute the payment and mark the order paid. Returns a short message. */
export async function handleCallback({ paymentID, status }) {
  const o = paymentID ? one('SELECT * FROM orders WHERE bkash_payment_id = ?', String(paymentID).slice(0, 100)) : null;
  if (!o) return { ok: false, text: 'Payment not found.' };
  if (status !== 'success') return { ok: false, text: status === 'cancel' ? 'Payment cancelled.' : 'Payment failed. Please try again.' };
  if (o.payment_check === 'verified' && o.payment_trx) return { ok: true, text: `Already paid — TrxID ${o.payment_trx}.`, order: o.id };
  const ws = one('SELECT * FROM workspaces WHERE id = ?', o.workspace_id);
  const cfg = cfgOf(ws);
  let j;
  try { j = await call(cfg, 'execute', { paymentID }, await auth(cfg)); } catch (e) {
    // Executed already (e.g. the customer refreshed): ask bKash for the result.
    try { j = await call(cfg, 'payment/status', { paymentID }, await auth(cfg)); } catch { return { ok: false, text: `Payment could not be completed: ${e.message}` }; }
  }
  if (j.transactionStatus !== 'Completed') return { ok: false, text: 'Payment not completed.' };
  const paid = Math.round(((o.paid_amount || 0) + Number(j.amount || o.bkash_amount || 0)) * 100) / 100;
  run(`UPDATE orders SET payment_trx = ?, payment_method = 'bKash', payment_claim = ?, payment_check = 'verified', paid_amount = ?,
    payment_status = CASE WHEN ? >= total THEN 'paid' ELSE 'advance' END WHERE id = ?`, String(j.trxID || ''), Number(j.amount || 0), paid, paid, o.id);
  logActivity(o.workspace_id, 'payment_received', { order: o.id, detail: `bKash ${j.amount} TrxID ${j.trxID}` });
  return { ok: true, text: `Payment received ✅ TrxID ${j.trxID}`, order: o.id };
}
