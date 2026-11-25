// Meta Conversions API for business messaging: when a chat turns into an order, tell Meta Ads ("Purchase"),
// so click-to-message ads find more people who actually buy. Needs the shop's dataset (pixel) id and a token.
import { one, run, logActivity } from '../db.js';
import { seal, open } from '../vault.js';
import { graph } from './meta.js';

export function capiSettings(ws) {
  try { const c = JSON.parse(ws.capi_json || '{}'); return { dataset_id: c.dataset_id || '', enabled: Boolean(c.dataset_id && c.token), test_code: c.test_code || '' }; } catch { return { dataset_id: '', enabled: false, test_code: '' }; }
}

export function saveCapi(ws, b = {}) {
  const old = (() => { try { return JSON.parse(ws.capi_json || '{}'); } catch { return {}; } })();
  if (b.dataset_id === '' && !b.token) { run('UPDATE workspaces SET capi_json = NULL WHERE id = ?', ws.id); return capiSettings({}); }
  const dataset = String(b.dataset_id || '').trim();
  if (!/^\d{5,32}$/.test(dataset)) throw Object.assign(new Error('Dataset / Pixel ID is the number from Events Manager'), { status: 400 });
  const token = b.token ? seal(ws.id, 'capi.token', String(b.token).trim().slice(0, 1000)) : old.token;
  if (!token) throw Object.assign(new Error('Paste the Conversions API access token from Events Manager'), { status: 400 });
  const next = { dataset_id: dataset, token, test_code: String(b.test_code || '').trim().slice(0, 40) };
  run('UPDATE workspaces SET capi_json = ? WHERE id = ?', JSON.stringify(next), ws.id);
  return capiSettings({ capi_json: JSON.stringify(next) });
}

const CHANNEL = { messenger: 'messenger', instagram: 'instagram', whatsapp: 'whatsapp' };

/** Send one Purchase event for a chat order (once). Never throws. */
export async function sendPurchase(orderId) {
  try {
    const o = one('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o?.conversation_id || o.capi_sent_at) return false;
    const ws = one('SELECT * FROM workspaces WHERE id = ?', o.workspace_id);
    const cfg = JSON.parse(ws.capi_json || '{}');
    if (!cfg.dataset_id || !cfg.token) return false;
    const conv = one('SELECT * FROM conversations WHERE id = ?', o.conversation_id);
    const ch = one('SELECT * FROM channels WHERE id = ?', conv.channel_id);
    const ref = conv.referral_json ? JSON.parse(conv.referral_json) : {};
    const user = ch.platform === 'whatsapp'
      ? { whatsapp_business_account_id: ch.waba_id || undefined, ...(ref.ctwa_clid ? { ctwa_clid: ref.ctwa_clid } : {}) }
      : { page_id: ch.send_id || ch.external_id, page_scoped_user_id: conv.customer_id };
    const event = { event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000), event_id: `cp-order-${o.id}`, action_source: 'business_messaging',
      messaging_channel: CHANNEL[ch.platform], user_data: user, custom_data: { currency: o.currency || 'BDT', value: o.total, order_id: String(o.id) } };
    await graph(`${encodeURIComponent(cfg.dataset_id)}/events`, { method: 'POST', token: open(ws.id, 'capi.token', cfg.token),
      body: { data: [event], ...(cfg.test_code ? { test_event_code: cfg.test_code } : {}) } });
    run(`UPDATE orders SET capi_sent_at = datetime('now') WHERE id = ?`, o.id);
    return true;
  } catch (e) {
    const o = one('SELECT workspace_id FROM orders WHERE id = ?', orderId);
    if (o) logActivity(o.workspace_id, 'send_failed', { order: orderId, error: `Conversions API: ${e.message}` });
    return false;
  }
}
