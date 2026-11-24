import nodemailer from 'nodemailer';
import { getSetting, appName } from '../settings.js';

let transport = null;
let transportKey = '';

function systemTransport() {
  const host = getSetting('smtp_host');
  if (!host) return null;
  const key = [host, getSetting('smtp_port'), getSetting('smtp_user'), getSetting('smtp_pass')].join('|');
  if (!transport || key !== transportKey) {
    const port = Number(getSetting('smtp_port')) || 587;
    transport = nodemailer.createTransport({
      host, port, secure: port === 465,
      auth: getSetting('smtp_user') ? { user: getSetting('smtp_user'), pass: getSetting('smtp_pass') } : undefined,
    });
    transportKey = key;
  }
  return transport;
}

const htmlWrap = (title, bodyHtml) => `<!doctype html><html><body style="margin:0;background:#f4f5fa;font-family:Arial,sans-serif;color:#141826">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e3e6ee">
<div style="font-weight:800;font-size:18px;margin-bottom:16px">${appName()}</div>
<h2 style="font-size:18px;margin:0 0 12px">${title}</h2>${bodyHtml}
<p style="color:#8a90a2;font-size:12px;margin-top:28px">You received this email from ${appName()}.</p></div></body></html>`;

/** Transactional email (password reset, alerts). Falls back to console logging when SMTP isn't configured. */
export async function sendSystemEmail(to, subject, text, { html, title } = {}) {
  const t = systemTransport();
  if (!t) {
    console.log(`[mail:not-configured] to=${to} subject="${subject}"\n${text}`);
    return { logged: true };
  }
  const escaped = String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>');
  return t.sendMail({
    from: getSetting('smtp_from') || getSetting('smtp_user'), to, subject, text,
    html: htmlWrap(title || subject, html || `<p style="line-height:1.6">${escaped}</p>`),
    headers: { 'Auto-Submitted': 'auto-generated', 'X-ChatPilot-Generated': appName() },
  });
}

export async function sendTelegram(chatId, text) {
  const token = getSetting('telegram_bot_token');
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
}

export async function sendSlack(url, text) {
  if (!url || !/^https:\/\/hooks\.slack\.com\//.test(url)) return;
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000) });
}

export async function notifyAdmins(subject, text) {
  const to = getSetting('admin_alert_email');
  if (to) await sendSystemEmail(to, `[${appName()} admin] ${subject}`, text).catch((e) => console.error('[notify]', e.message));
}
