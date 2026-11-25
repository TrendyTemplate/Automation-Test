// SMS for orders (Bangladeshi gateways): confirmation, shipped-with-tracking, and a one-tap "confirm your order" link
// for risky cash-on-delivery orders. SMS reaches customers when Messenger / WhatsApp rules don't allow a message.
import crypto from 'node:crypto';
import { one, run, logActivity } from '../db.js';
import { seal, open } from '../vault.js';
import { appUrl } from '../settings.js';
import { normalizePhone } from './couriers.js';

export const PROVIDERS = {
  bulksmsbd: { label: 'BulkSMSBD', fields: ['api_key', 'sender_id'] },
  sslwireless: { label: 'SSL Wireless (SMS Plus)', fields: ['api_key', 'sid'] },
  alpha: { label: 'Alpha SMS (sms.net.bd)', fields: ['api_key', 'sender_id'] },
};
const URLS = {
  bulksmsbd: () => process.env.SMS_BULKSMSBD_URL || 'https://bulksmsbd.net/api/smsapi',
  sslwireless: () => process.env.SMS_SSL_URL || 'https://smsplus.sslwireless.com/api/v3/send-sms',
  alpha: () => process.env.SMS_ALPHA_URL || 'https://api.sms.net.bd/sendsms',
};
export const EVENTS = ['confirmed', 'shipped', 'delivered', 'cancelled', 'risky_confirm'];

export function smsSettings(ws) {
  try {
    const c = JSON.parse(ws.sms_json || '{}');
    return { provider: c.provider || '', sender_id: c.sender_id || '', sid: c.sid || '', events: c.events || {}, connected: Boolean(c.provider && c.key) };
  } catch { return { provider: '', events: {}, connected: false }; }
}
const config = (ws) => { try { const c = JSON.parse(ws.sms_json || '{}'); return c.key ? { ...c, api_key: open(ws.id, 'sms.key', c.key) } : null; } catch { return null; } };

/** E.164-less Bangladeshi mobile: 8801XXXXXXXXX (what the gateways want). */
const bdMsisdn = (phone) => { const p = normalizePhone(phone); return /^01[3-9]\d{8}$/.test(p) ? `88${p}` : null; };

async function send(cfg, to, text) {
  const signal = AbortSignal.timeout(15_000);
  let res; let body;
  if (cfg.provider === 'bulksmsbd') {
    const u = new URL(URLS.bulksmsbd());
    for (const [k, v] of Object.entries({ api_key: cfg.api_key, type: 'text', number: to, senderid: cfg.sender_id, message: text })) u.searchParams.set(k, v);
    res = await fetch(u, { signal }); body = await res.json().catch(() => ({}));
    if (Number(body.response_code) !== 202) throw new Error(body.error_message || `BulkSMSBD error ${body.response_code || res.status}`);
  } else if (cfg.provider === 'sslwireless') {
    res = await fetch(URLS.sslwireless(), { method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_token: cfg.api_key, sid: cfg.sid, msisdn: to, sms: text, csms_id: crypto.randomBytes(8).toString('hex') }) });
    body = await res.json().catch(() => ({}));
    if (body.status !== 'SUCCESS') throw new Error(body.error_message || `SSL Wireless error ${body.status_code || res.status}`);
  } else if (cfg.provider === 'alpha') {
    res = await fetch(URLS.alpha(), { method: 'POST', signal, headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_key: cfg.api_key, msg: text, to, ...(cfg.sender_id ? { sender_id: cfg.sender_id } : {}) }) });
    body = await res.json().catch(() => ({}));
    if (Number(body.error) !== 0) throw new Error(body.msg || `Alpha SMS error ${res.status}`);
  } else throw new Error('No SMS provider');
  return true;
}

export async function connectSms(ws, b = {}) {
  if (!b.provider) { run('UPDATE workspaces SET sms_json = NULL WHERE id = ?', ws.id); return smsSettings({}); }
  if (!PROVIDERS[b.provider]) throw Object.assign(new Error('Choose an SMS provider'), { status: 400 });
  const old = (() => { try { return JSON.parse(ws.sms_json || '{}'); } catch { return {}; } })();
  const key = b.api_key ? seal(ws.id, 'sms.key', String(b.api_key).trim().slice(0, 300)) : old.provider === b.provider ? old.key : null;
  if (!key) throw Object.assign(new Error('Enter the API key from your SMS provider'), { status: 400 });
  if (b.provider === 'sslwireless' && !b.sid) throw Object.assign(new Error('SSL Wireless needs the SID'), { status: 400 });
  const events = Object.fromEntries(EVENTS.map((e) => [e, Boolean(b.events?.[e])]));
  const next = { provider: b.provider, key, sender_id: String(b.sender_id || '').slice(0, 20), sid: String(b.sid || '').slice(0, 40), events };
  run('UPDATE workspaces SET sms_json = ? WHERE id = ?', JSON.stringify(next), ws.id);
  if (b.test_phone) {
    const to = bdMsisdn(b.test_phone);
    if (!to) throw Object.assign(new Error('Test number should look like 01712345678'), { status: 400 });
    await send({ ...next, api_key: open(ws.id, 'sms.key', key) }, to, 'ChatPilot: SMS is working ✅').catch((e) => { throw Object.assign(new Error(`The provider refused: ${e.message}`), { status: 400 }); });
  }
  return smsSettings({ sms_json: JSON.stringify(next) });
}

const shop = (ws) => (ws.business_name || ws.name || 'Shop').slice(0, 30);
const TEXT = {
  confirmed: (o, ws) => `${shop(ws)}: Order #${o.id} confirmed. Total ${o.currency} ${o.total}${o.total - (o.paid_amount || 0) > 0 ? ` (COD ${o.total - (o.paid_amount || 0)})` : ''}. Thank you!`,
  shipped: (o, ws) => `${shop(ws)}: Order #${o.id} shipped${o.courier ? ` by ${o.courier}` : ''}.${o.tracking_code ? ` Tracking: ${o.tracking_code}` : ''} Please keep ${o.currency} ${Math.max(0, o.total - (o.paid_amount || 0))} ready.`,
  delivered: (o, ws) => `${shop(ws)}: Order #${o.id} delivered. Thank you for shopping with us!`,
  cancelled: (o, ws) => `${shop(ws)}: Order #${o.id} has been cancelled.`,
  risky_confirm: (o, ws, link) => `${shop(ws)}: Please confirm your order #${o.id} (${o.currency} ${o.total}): ${link}`,
};

/** Send the SMS for an order event if the shop turned it on. Never throws. */
export async function smsOrder(orderId, event) {
  try {
    const o = one('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o?.customer_phone) return false;
    const ws = one('SELECT * FROM workspaces WHERE id = ?', o.workspace_id);
    const cfg = config(ws);
    if (!cfg || !cfg.events?.[event]) return false;
    const to = bdMsisdn(o.customer_phone);
    if (!to) return false;
    let link = '';
    if (event === 'risky_confirm') {
      const token = o.confirm_token || crypto.randomBytes(16).toString('hex');
      run('UPDATE orders SET confirm_token = ? WHERE id = ?', token, o.id);
      link = `${appUrl()}/c/${token}`;
    }
    await send(cfg, to, TEXT[event](o, ws, link));
    logActivity(ws.id, 'sms_sent', { order: o.id, detail: event });
    return true;
  } catch (e) {
    const o = one('SELECT workspace_id FROM orders WHERE id = ?', orderId);
    if (o) logActivity(o.workspace_id, 'send_failed', { order: orderId, error: `SMS: ${e.message}` });
    return false;
  }
}

// ---------- the customer's one-tap confirmation page ----------
const page = (title, body) => `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;background:#f6f4ef;color:#1d2420;padding:16px}.c{max-width:420px;background:#fff;border-radius:16px;padding:24px;box-shadow:0 2px 12px #0001}button{width:100%;padding:14px;border:0;border-radius:12px;background:#0b7a62;color:#fff;font-size:17px;font-weight:700;margin-top:12px}.n{background:#eee;color:#333}</style></head><body><div class="c">${body}</div></body></html>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function confirmPage(token) {
  const o = /^[a-f0-9]{32}$/.test(String(token)) ? one('SELECT * FROM orders WHERE confirm_token = ?', token) : null;
  if (!o) return page('Not found', '<h2>এই লিংকটি আর কাজ করছে না</h2><p>This link is no longer valid.</p>');
  const items = JSON.parse(o.items_json).map((l) => `<li>${l.qty} × ${esc(l.name)}${l.variant ? ` (${esc(l.variant)})` : ''}</li>`).join('');
  if (o.customer_confirmed) return page('Confirmed', `<h2>✅ অর্ডার #${o.id} কনফার্ম হয়েছে</h2><p>Thank you — your order is confirmed.</p>`);
  if (o.status === 'cancelled') return page('Cancelled', `<h2>অর্ডার #${o.id} বাতিল</h2>`);
  return page(`Order #${o.id}`, `<h2>অর্ডার #${o.id} কনফার্ম করুন</h2><ul>${items}</ul><p><b>মোট ${esc(o.currency)} ${o.total}</b><br>${esc(o.customer_address || '')}</p>
    <form method="post"><button name="answer" value="yes">✅ হ্যাঁ, অর্ডার কনফার্ম করছি</button><button name="answer" value="no" class="n">❌ আমি এই অর্ডার করিনি</button></form>`);
}
export async function confirmAnswer(token, answer) {
  const o = /^[a-f0-9]{32}$/.test(String(token)) ? one('SELECT * FROM orders WHERE confirm_token = ?', token) : null;
  if (!o || o.customer_confirmed || o.status === 'cancelled') return confirmPage(token);
  if (answer === 'yes') {
    run(`UPDATE orders SET customer_confirmed = 1, note = TRIM(COALESCE(note, '') || ' ✅ Customer confirmed by SMS link') WHERE id = ?`, o.id);
    logActivity(o.workspace_id, 'order_customer_confirmed', { order: o.id });
  } else {
    run(`UPDATE orders SET customer_confirmed = -1, note = TRIM(COALESCE(note, '') || ' ❌ Customer says they did not order this') WHERE id = ?`, o.id);
    logActivity(o.workspace_id, 'order_risk', { order: o.id, error: 'Customer denied the order via SMS link' });
    return page('Thanks', '<h2>ধন্যবাদ</h2><p>We have noted that you did not place this order.</p>');
  }
  return confirmPage(token);
}
