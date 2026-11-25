// Tell the customer, in their chat, when their order is confirmed, shipped, delivered or cancelled.
// Only free-form messages inside Meta's 24-hour window are sent (no paid templates); otherwise it is logged
// so the team knows the customer was not notified.
import { one, logActivity } from '../db.js';
import { insideWindow } from './social.js';

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

export async function notifyOrderStatus(orderId) {
  const o = one('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o?.conversation_id) return { skipped: 'no chat' };
  const ws = one('SELECT * FROM workspaces WHERE id = ?', o.workspace_id);
  if (!ws.notify_customers) return { skipped: 'off' };
  const conv = one('SELECT * FROM conversations WHERE id = ?', o.conversation_id);
  if (!conv || conv.kind === 'comment') return { skipped: 'no chat' };
  const lang = conv.language === 'bn' ? 'bn' : 'en';
  const make = T[lang][o.status];
  if (!make) return { skipped: 'status' };
  if (!insideWindow(conv.last_inbound_at)) {
    logActivity(o.workspace_id, 'notify_skipped', { order: o.id, conversation: conv.id, error: 'Customer last wrote more than 24 hours ago — Meta does not allow a free message now' });
    return { skipped: 'window' };
  }
  const { storeOutbound, deliver } = await import('./sales.js');
  const id = storeOutbound(conv, make(o), { source: 'human', status: 'draft' });
  await deliver(id);
  return { sent: true, id };
}
