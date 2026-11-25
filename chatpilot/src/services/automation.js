// Rules that run without the AI: comment moderation & keyword replies, business hours / away message,
// and the Messenger / Instagram / WhatsApp chat profile (Get Started, greeting, ice breakers, menu).
import { one, run } from '../db.js';
import { graph } from './meta.js';

const list = (v, max, len) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map((x) => String(x).trim().toLowerCase().slice(0, len)).filter(Boolean).slice(0, max);
const BN_DIGITS = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
const latinDigits = (t) => String(t || '').replace(/[০-৯]/g, (d) => BN_DIGITS[d]);

// ---------- Comment rules ----------
export const DEFAULT_RULES = { hide_phones: false, hide_links: false, hide_words: [], once_per_person: true, only_posts: [], skip_posts: [], triggers: [] };

export function commentRules(channel) {
  try { return { ...DEFAULT_RULES, ...JSON.parse(channel.comment_rules || '{}') }; } catch { return { ...DEFAULT_RULES }; }
}

export function validateRules(b = {}) {
  const posts = (v) => list(v, 200, 80).map((x) => x.replace(/^.*\/(posts|p|reel|videos)\//, '').replace(/[/?].*$/, '')).filter((x) => /^[\w.-]{3,80}$/.test(x));
  const triggers = (Array.isArray(b.triggers) ? b.triggers : []).slice(0, 30).map((t) => ({
    words: list(t?.words, 10, 40),
    public: String(t?.public || '').trim().slice(0, 500),
    private: String(t?.private || '').trim().slice(0, 1000),
  })).filter((t) => t.words.length);
  for (const t of triggers) if (!t.public && !t.private) throw Object.assign(new Error(`Keyword "${t.words[0]}": write a public reply, an inbox message, or both`), { status: 400 });
  return { hide_phones: Boolean(b.hide_phones), hide_links: Boolean(b.hide_links), hide_words: list(b.hide_words, 100, 40),
    once_per_person: b.once_per_person !== false, only_posts: posts(b.only_posts), skip_posts: posts(b.skip_posts), triggers };
}

const hasPhone = (t) => /(?:\+?88)?01[3-9]\d{8}/.test(latinDigits(t).replace(/[\s.-]/g, ''));
const hasLink = (t) => /(https?:\/\/|www\.|\b[\w-]+\.(com|net|org|xyz|top|info|bd|me|io|shop|link|ly)\b)/i.test(t);
const wordHit = (t, words) => { const low = String(t).toLowerCase(); return words.find((w) => low.includes(w)); };
const postMatch = (postId, ids) => ids.some((x) => String(postId || '').includes(x));

/**
 * Decide what happens to a new customer comment before the AI sees it.
 * → { hide: reason } | { skip: reason } | { trigger: {public, private} } | {}
 */
export function moderateComment(channel, conv, text) {
  const r = commentRules(channel);
  if (r.hide_phones && hasPhone(text)) return { hide: 'phone number in a public comment' };
  if (r.hide_links && hasLink(text)) return { hide: 'link in a comment' };
  const bad = wordHit(text, r.hide_words);
  if (bad) return { hide: `blocked word "${bad}"` };
  if (r.only_posts.length && !postMatch(conv.post_id, r.only_posts)) return { skip: 'auto replies are off for this post' };
  if (postMatch(conv.post_id, r.skip_posts)) return { skip: 'auto replies are off for this post' };
  const trig = r.triggers.find((t) => wordHit(text, t.words));
  if (r.once_per_person && conv.author_id && conv.post_id) {
    // Somebody commenting "price" five times on one post gets one answer, not five.
    const answered = one(`SELECT 1 FROM conversations v JOIN chat_messages m ON m.conversation_id = v.id
      WHERE v.channel_id = ? AND v.kind = 'comment' AND v.post_id = ? AND v.author_id = ? AND v.id <> ? AND m.direction = 'out' AND m.status IN ('sent', 'draft')
        AND m.created_at > datetime('now', '-7 days') LIMIT 1`, channel.id, conv.post_id, conv.author_id, conv.id);
    if (answered) return { skip: 'already answered this person on this post' };
  }
  return trig ? { trigger: trig } : {};
}

/** Hide a comment on the Page / Instagram post (the commenter and their friends still see it; others don't). */
export async function hideComment(channel, token, commentId) {
  const body = channel.platform === 'instagram' ? { hide: true } : { is_hidden: true };
  await graph(encodeURIComponent(commentId), { method: 'POST', token, body });
}

// ---------- Business hours ----------
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_HOURS = { enabled: false, tz: 'Asia/Dhaka', days: Object.fromEntries(DAYS.map((d) => [d, d === 'fri' ? null : ['10:00', '22:00']])),
  away: 'ধন্যবাদ! আমরা এখন অফলাইনে আছি, খোলার সাথে সাথে উত্তর দেব। / Thanks! We are closed right now and will reply as soon as we open.', ai_after_hours: true };

export function businessHours(ws) {
  try { const h = JSON.parse(ws.hours_json || '{}'); return { ...DEFAULT_HOURS, ...h, days: { ...DEFAULT_HOURS.days, ...(h.days || {}) } }; } catch { return { ...DEFAULT_HOURS }; }
}

export function validateHours(b = {}) {
  const tz = String(b.tz || 'Asia/Dhaka').slice(0, 60);
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw Object.assign(new Error('Unknown time zone'), { status: 400 }); }
  const days = {};
  for (const d of DAYS) {
    const v = b.days?.[d];
    if (!v) { days[d] = null; continue; }
    if (!Array.isArray(v) || !TIME.test(v[0]) || !TIME.test(v[1])) throw Object.assign(new Error(`${d}: use times like 10:00 and 22:00`), { status: 400 });
    days[d] = [v[0], v[1]];
  }
  return { enabled: Boolean(b.enabled), tz, days, away: String(b.away ?? DEFAULT_HOURS.away).trim().slice(0, 640), ai_after_hours: b.ai_after_hours !== false };
}

/** Is the shop open at `date`? Overnight ranges (18:00–02:00) work. */
export function isOpen(ws, date = new Date()) {
  const h = businessHours(ws);
  if (!h.enabled) return true;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: h.tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((p) => [p.type, p.value]));
  const day = DAYS.indexOf(parts.weekday.toLowerCase().slice(0, 3));
  const now = `${parts.hour}:${parts.minute}`;
  const today = h.days[DAYS[day]];
  if (today && (today[0] <= today[1] ? now >= today[0] && now < today[1] : now >= today[0])) return true;
  const yday = h.days[DAYS[(day + 6) % 7]]; // yesterday's overnight range still running
  return Boolean(yday && yday[0] > yday[1] && now < yday[1]);
}

export function hoursText(ws, date = new Date()) {
  const h = businessHours(ws);
  if (!h.enabled) return '';
  const lines = DAYS.map((d) => `${d}: ${h.days[d] ? `${h.days[d][0]}–${h.days[d][1]}` : 'closed'}`).join(', ');
  return `<business_hours tz="${h.tz}">${lines}. Right now the shop is ${isOpen(ws, date) ? 'OPEN' : 'CLOSED: you may answer questions and take orders, but say a person will confirm / ship when the shop opens'}.</business_hours>`;
}

/** Outside business hours: what to do with a new chat message. → { away: text } | { quiet: true } | {} */
export function afterHours(ws, conv) {
  const h = businessHours(ws);
  if (!h.enabled || isOpen(ws)) return {};
  const recent = one(`SELECT 1 FROM chat_messages WHERE conversation_id = ? AND source = 'auto' AND created_at > datetime('now', '-12 hours') LIMIT 1`, conv.id);
  return { away: !recent && h.away ? h.away : null, quiet: !h.ai_after_hours };
}

// ---------- Chat profile: Get Started, greeting, ice breakers, persistent menu ----------
export function validateProfile(b = {}) {
  const out = {
    greeting: String(b.greeting || '').trim().slice(0, 160),
    ice_breakers: (Array.isArray(b.ice_breakers) ? b.ice_breakers : String(b.ice_breakers || '').split('\n')).map((q) => String(q).trim().slice(0, 80)).filter(Boolean).slice(0, 4),
    menu: (Array.isArray(b.menu) ? b.menu : []).slice(0, 5).map((m) => ({ title: String(m?.title || '').trim().slice(0, 30), url: String(m?.url || '').trim().slice(0, 500) })).filter((m) => m.title),
  };
  for (const m of out.menu) if (m.url && !/^https:\/\//.test(m.url)) throw Object.assign(new Error(`Menu "${m.title}": links must start with https://`), { status: 400 });
  return out;
}

/** Push the profile to Meta. Messenger: all of it; Instagram: ice breakers + menu; WhatsApp: welcome + prompts. */
export async function applyProfile(channel, token, p) {
  if (channel.platform === 'whatsapp') {
    await graph(`${encodeURIComponent(channel.external_id)}/conversational_automation`, { method: 'POST', token,
      params: { enable_welcome_message: 'true', prompts: JSON.stringify(p.ice_breakers) } });
    return;
  }
  const ig = channel.platform === 'instagram';
  const page = encodeURIComponent(channel.send_id || channel.external_id);
  const menu = p.menu.map((m) => (m.url ? { type: 'web_url', title: m.title, url: m.url } : { type: 'postback', title: m.title, payload: `MENU:${m.title}` }));
  const body = {
    ...(ig ? { platform: 'instagram' } : { get_started: { payload: 'GET_STARTED' } }),
    ...(!ig && p.greeting ? { greeting: [{ locale: 'default', text: p.greeting }] } : {}),
    ...(p.ice_breakers.length ? { ice_breakers: [{ locale: 'default', call_to_actions: p.ice_breakers.map((q) => ({ question: q, payload: `ICE:${q}` })) }] } : {}),
    ...(menu.length ? { persistent_menu: [{ locale: 'default', composer_input_disabled: false, call_to_actions: menu }] } : {}),
  };
  const fields = ['ice_breakers', 'persistent_menu', ...(ig ? [] : ['greeting'])].filter((f) => !(f in body));
  if (fields.length) await graph(`${page}/messenger_profile`, { method: 'DELETE', token, body: { fields, ...(ig ? { platform: 'instagram' } : {}) } }).catch(() => {});
  await graph(`${page}/messenger_profile`, { method: 'POST', token, body });
}

export function saveProfile(channelId, p) { run('UPDATE channels SET profile_json = ? WHERE id = ?', JSON.stringify(p), channelId); }
