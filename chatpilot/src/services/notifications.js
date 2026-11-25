// Tell the customer, in their chat, when their order is confirmed, shipped, delivered or cancelled.
// Inside the reply window: a normal message. On WhatsApp after 24 hours (couriers take days): the shop's approved
// UTILITY template for that status, if it set one up. Otherwise it is logged so the team knows.
import { one, run, logActivity } from '../db.js';
import { seal, open } from '../vault.js';
import { replyWindow, sendTemplate } from './social.js';

const T = {
  bn: {
    confirmed: (o) => `আপনার অর্ডার #${o.id} কনফার্ম হয়েছে ✅ মোট ${o.currency} ${o.total}। শীঘ্রই পাঠানো হবে।`,
    shipped: (o) => `আপনার অর্ডার #${o.id} কুরিয়ারে পাঠানো হয়েছে 🚚${o.tracking_code ? ` ট্র্যাকিং: ${o.tracking_code}` : ''}`,
    delivered: (o) => `আপনার অর্ডার #${o.id} ডেলিভারি হয়েছে। কেনাকাটার জন্য ধন্যবাদ 🙏`,
    cancelled: (o) => `আপনার অর্ডার #${o.id} বাতিল করা হয়েছে। কোনো প্রশ্ন থাকলে জানাবেন।`,
  },
  en: {
    confirmed: (o) => `Your order #${o.id} is confirmed ✅ Total ${o.currency} ${o.total}. We'll ship it soon.`,
    shipped: (o) => `Your order #${o.id} is on its way 🚚${o.tracking_code ? ` Tracking: ${o.tracking_code}` : ''}`,
    delivered: (o) => `Your order #${o.id} has been delivered. Thank you for shopping with us 🙏`,
    cancelled: (o) => `Your order #${o.id} has been cancelled. Let us know if you have any questions.`,
  },
};
export const NOTIFY_STATUSES = ['confirmed', 'shipped', 'delivered', 'cancelled'];

export function orderTemplates(ws) { try { return JSON.parse(ws.order_templates || '{}'); } catch { return {}; } }
export function validateOrderTemplates(b = {}) {
  const out = {};
  for (const s of NOTIFY_STATUSES) {
    const t = b[s];
    if (!t?.name) continue;
    if (!/^[a-z0-9_]{1,512}$/.test(t.name)) throw Object.assign(new Error(`${s}: template names are lowercase letters, numbers and _`), { status: 400 });
    out[s] = { name: t.name, language: String(t.language || 'en').slice(0, 15), params: (Array.isArray(t.params) ? t.params : String(t.params || '').split(',')).map((x) => String(x).trim()).filter(Boolean).slice(0, 10) };
  }
  return out;
}
const fill = (p, o, conv) => String(p).replace(/\{\{order\}\}/g, String(o.id)).replace(/\{\{total\}\}/g, `${o.currency} ${o.total}`)
  .replace(/\{\{tracking\}\}/g, o.tracking_code || o.consignment_id || '-').replace(/\{\{courier\}\}/g, o.courier || '-')
  .replace(/\{\{name\}\}/g, (o.customer_name || conv.customer_name || '').split(' ')[0] || '-');

export async function notifyOrderStatus(orderId) {
  const o = one('SELECT * FROM orders WHERE id = ?', orderId);
  if (o) { const { smsOrder } = await import('./sms.js'); await smsOrder(o.id, o.status); } // SMS too, if the shop turned it on for this update
  if (!o?.conversation_id) return { skipped: 'no chat' };
  const ws = one('SELECT * FROM workspaces WHERE id = ?', o.workspace_id);
  if (!ws.notify_customers) return { skipped: 'off' };
  const conv = one('SELECT * FROM conversations WHERE id = ?', o.conversation_id);
  if (!conv || conv.kind === 'comment') return { skipped: 'no chat' };
  const channel = one('SELECT * FROM channels WHERE id = ?', conv.channel_id);
  const lang = conv.language === 'bn' ? 'bn' : 'en';
  const make = T[lang][o.status];
  if (!make || !channel) return { skipped: 'status' };
  if (replyWindow(channel.platform, conv).open) {
    const { storeOutbound, deliver } = await import('./sales.js');
    const id = storeOutbound(conv, make(o), { source: 'auto', status: 'draft' });
    await deliver(id);
    return { sent: true, id };
  }
  const tpl = orderTemplates(ws)[o.status];
  if (channel.platform === 'whatsapp' && tpl) {
    const token = open(channel.workspace_id, 'channels.access_token', channel.access_token_enc);
    const wamid = await sendTemplate(channel, token, conv.customer_id, tpl.name, tpl.language, tpl.params.map((p) => fill(p, o, conv)));
    run(`INSERT INTO chat_messages (workspace_id, conversation_id, direction, source, external_id, body, status) VALUES (?,?, 'out', 'auto', ?, ?, 'sent')`,
      conv.workspace_id, conv.id, wamid, seal(conv.workspace_id, 'chat_messages.body', `[template ${tpl.name}] ${make(o)}`));
    return { sent: true, template: tpl.name };
  }
  logActivity(o.workspace_id, 'notify_skipped', { order: o.id, conversation: conv.id,
    error: channel.platform === 'whatsapp' ? 'Customer last wrote more than 24 hours ago — set an order-update template to reach them' : 'Customer last wrote too long ago — Meta does not allow a free message now' });
  return { skipped: 'window' };
}
