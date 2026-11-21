import { one } from '../db.js';

const AUTOMATED_LOCALPARTS = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[s]?|notifications?|alerts?|news(letter)?|marketing|info-noreply)([+.\-_].*)?$/i;

/**
 * Decide whether an incoming email was sent by a machine. We must never auto-reply to
 * these: it causes mail loops and annoys bulk senders (RFC 3834 guidance).
 */
export function isAutomatedEmail({ fromEmail, headers }) {
  const h = (k) => String(headers?.[k.toLowerCase()] ?? '').toLowerCase();
  const local = String(fromEmail || '').split('@')[0];
  if (!fromEmail || AUTOMATED_LOCALPARTS.test(local)) return true;
  const autoSubmitted = h('auto-submitted');
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  if (['bulk', 'list', 'junk', 'auto_reply'].includes(h('precedence'))) return true;
  if (h('list-id') || h('list-unsubscribe')) return true;
  if (h('x-autoreply') || h('x-autorespond') || h('x-auto-response-suppress')) return true;
  if (h('x-mailpilot-generated')) return true;
  return false;
}

/** Rate-limit auto-replies per recipient to break loops even with misbehaving peers. */
export function recentlyRepliedTo(workspaceId, toEmail, hours = 24) {
  const row = one(
    `SELECT COUNT(*) AS n FROM sent_log WHERE workspace_id = ? AND lower(to_email) = lower(?)
       AND sent_at > datetime('now', ?)`,
    workspaceId, toEmail, `-${hours} hours`,
  );
  return row.n > 0;
}

/** businessHours: {tz:"Asia/Dhaka", days:[1,2,3,4,5], start:"09:00", end:"18:00"} — ISO weekday 1=Mon. */
export function withinBusinessHours(businessHoursJson, now = new Date()) {
  if (!businessHoursJson) return true;
  let bh;
  try { bh = JSON.parse(businessHoursJson); } catch { return true; }
  if (!bh?.tz) return true;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: bh.tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const day = dayMap[parts.weekday];
  const hm = `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
  if (Array.isArray(bh.days) && !bh.days.includes(day)) return false;
  if (bh.start && hm < bh.start) return false;
  if (bh.end && hm >= bh.end) return false;
  return true;
}
