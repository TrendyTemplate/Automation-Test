// Outgoing messages: "PO waiting for review" alerts (Slack, email) and order confirmations to the buyer.
import nodemailer from 'nodemailer';
import { all, get, run } from '../db.js';
import { config } from '../config.js';
import { http } from '../connectors/http.js';
import { label } from './match.js';

let transport = null;
/** Tests inject a transport (e.g. nodemailer jsonTransport). */
export function setMailTransport(t) { transport = t; }
function mailer() {
  if (transport) return transport;
  if (!config.smtpUrl) return null;
  transport = nodemailer.createTransport(config.smtpUrl);
  return transport;
}
export const mailEnabled = () => Boolean(transport || config.smtpUrl);

export const isSlackWebhook = (u) => /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\/[A-Za-z0-9/_-]+$/.test(String(u || ''));
export const isEmail = (e) => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i.test(String(e || ''));

const reviewLink = (poId) => `${config.appUrl}/?po=${poId}`;

/** Tell the team a PO needs a human. */
export async function sendReviewAlert(storeId, poId) {
  const store = get('SELECT * FROM stores WHERE id = ?', storeId);
  const po = get('SELECT * FROM purchase_orders WHERE id = ? AND store_id = ?', poId, storeId);
  if (!store || !po || po.status !== 'needs_review') return;
  const issues = all('SELECT flags_json FROM po_lines WHERE po_id = ?', poId).flatMap((l) => JSON.parse(l.flags_json));
  const count = (f) => issues.filter((x) => x === f).length;
  const summary = [
    count('no_match') && `${count('no_match')} line(s) without a product`,
    count('ambiguous_match') && `${count('ambiguous_match')} unclear match(es)`,
    count('price_mismatch') && `${count('price_mismatch')} price difference(s)`,
    count('low_stock') && `${count('low_stock')} low-stock line(s)`,
    ...JSON.parse(po.flags_json).filter((f) => f !== 'unknown_customer').map((f) => f.replace(/_/g, ' ')),
  ].filter(Boolean).join(', ') || 'please confirm the matches';
  const who = po.company_name || po.customer_name || po.buyer_email || 'a buyer';
  const text = `New PO ${po.po_number || `#${po.id}`} from ${who} needs review: ${summary}. ${reviewLink(po.id)}`;

  const errors = [];
  if (isSlackWebhook(store.slack_webhook_url)) {
    try {
      const res = await http.safeFetch(store.slack_webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!res.ok) errors.push(`Slack ${res.status}`);
    } catch (e) { errors.push(`Slack: ${e.message}`); }
  }
  const m = mailer();
  if (m && isEmail(store.notify_email)) {
    await m.sendMail({ from: config.mailFrom, to: store.notify_email, subject: `PO ${po.po_number || `#${po.id}`} from ${who} needs review`, text });
  }
  if (errors.length) throw new Error(errors.join('; '));
}

/** Confirm the order to the buyer, threaded under their original email when we have it. */
export async function sendBuyerConfirmation(storeId, poId) {
  const store = get('SELECT * FROM stores WHERE id = ?', storeId);
  const po = get('SELECT * FROM purchase_orders WHERE id = ? AND store_id = ?', poId, storeId);
  if (!store?.confirm_buyer || !po || po.status !== 'created' || po.confirmation_sent_at || !isEmail(po.buyer_email)) return;
  const m = mailer();
  if (!m) throw Object.assign(new Error('Email sending is not configured (SMTP_URL)'), { permanent: true });
  const lines = all(`SELECT l.final_quantity, c.title, c.variant_title, c.sku FROM po_lines l
    LEFT JOIN catalog_items c ON c.store_id = ? AND c.external_id = l.matched_external_id
    WHERE l.po_id = ? AND l.final_quantity > 0 ORDER BY l.line_no`, storeId, poId);
  const greeting = po.customer_name ? `Hi ${po.customer_name.split(' ')[0]},` : 'Hello,';
  const text = [
    greeting,
    '',
    `Thank you for your order${po.po_number ? ` (PO ${po.po_number})` : ''}. We have received it and entered it as order ${po.order_name}:`,
    '',
    ...lines.map((l) => `  ${l.final_quantity} × ${label(l)}${l.sku ? ` (${l.sku})` : ''}`),
    '',
    store.confirm_message || 'We will let you know when it ships. Reply to this email if anything needs to change.',
    '',
    store.name,
  ].join('\n');
  const subject = po.email_subject ? (/^re:/i.test(po.email_subject) ? po.email_subject : `Re: ${po.email_subject}`)
    : `Order confirmation${po.po_number ? ` — PO ${po.po_number}` : ''}`;
  await m.sendMail({
    from: config.mailFrom,
    to: po.buyer_email,
    replyTo: isEmail(store.notify_email) ? store.notify_email : undefined,
    subject,
    text,
    inReplyTo: po.email_message_id || undefined,
    references: po.email_message_id || undefined,
  });
  run("UPDATE purchase_orders SET confirmation_sent_at = datetime('now') WHERE id = ?", poId);
}
