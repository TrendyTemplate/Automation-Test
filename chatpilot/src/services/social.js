// Meta platform adapters: Facebook Messenger, Instagram Direct and the WhatsApp Business Cloud API all deliver
// webhooks signed with the app secret (X-Hub-Signature-256) and send through the Graph API with a bearer token.
import crypto from 'node:crypto';

export const PLATFORMS = {
  messenger: { label: 'Facebook Messenger', maxLen: 2000, webhookObject: 'page' },
  instagram: { label: 'Instagram Direct', maxLen: 1000, webhookObject: 'instagram' },
  whatsapp: { label: 'WhatsApp Business', maxLen: 4096, webhookObject: 'whatsapp_business_account' },
};

// Messenger & Instagram: replies are only allowed within 24 hours of the customer's last message ("standard
// messaging window"). WhatsApp: free-form messages only within the 24-hour customer service window.
export const WINDOW_MS = 24 * 3600_000;
// SQLite datetime('now') values are UTC without a zone marker; never let them be parsed as local time.
export const toMs = (d) => new Date(/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(String(d)) ? `${String(d).replace(' ', 'T')}Z` : d).getTime();
export const insideWindow = (lastInboundAt, now = Date.now()) => Boolean(lastInboundAt) && now - toMs(lastInboundAt) < WINDOW_MS;

const graphBase = () => (process.env.META_GRAPH_URL || 'https://graph.facebook.com').replace(/\/$/, '');
const graphVersion = () => process.env.META_GRAPH_VERSION || 'v21.0';

/** Constant-time check of Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifySignature(rawBody, header, appSecret) {
  if (!header || !appSecret || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(header.slice(7).toLowerCase(), 'hex'), Buffer.from(expected, 'hex'));
}

/**
 * Normalise one webhook payload into events:
 * { platform, externalId (channel routing id), customerId, customerName, messageId, text, timestamp, echo, attachments[] }
 */
export function parseWebhook(payload) {
  const events = [];
  const object = payload?.object;
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    if (object === 'page' || object === 'instagram') {
      const platform = object === 'page' ? 'messenger' : 'instagram';
      // Post comments: Page "feed" changes and Instagram "comments" changes.
      for (const ch of Array.isArray(entry.changes) ? entry.changes : []) {
        const v = ch.value || {};
        if (ch.field === 'feed' && v.item === 'comment' && v.verb === 'add' && v.comment_id) {
          events.push({ platform, type: 'comment', externalId: String(entry.id), commentId: String(v.comment_id), postId: v.post_id ? String(v.post_id) : null,
            parentId: v.parent_id ? String(v.parent_id) : null, fromId: String(v.from?.id || ''), fromName: v.from?.name || null, text: String(v.message || ''),
            timestamp: v.created_time ? new Date(Number(v.created_time) * 1000 || v.created_time).toISOString() : new Date().toISOString(), self: String(v.from?.id || '') === String(entry.id) });
        } else if (ch.field === 'comments' && v.id) {
          events.push({ platform, type: 'comment', externalId: String(entry.id), commentId: String(v.id), postId: v.media?.id ? String(v.media.id) : null,
            parentId: v.parent_id ? String(v.parent_id) : null, fromId: String(v.from?.id || ''), fromName: v.from?.username ? `@${v.from.username}` : null, text: String(v.text || ''),
            timestamp: new Date().toISOString(), self: String(v.from?.id || '') === String(entry.id) });
        }
      }
      for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
        if (m.postback && !m.message) {
          // Tapped "Get Started", an ice breaker or a menu item: treat the button title as what the customer said.
          events.push({ platform, externalId: String(entry.id), customerId: String(m.sender?.id), text: String(m.postback.title || ''),
            messageId: m.postback.mid ? String(m.postback.mid) : `pb:${m.sender?.id}:${m.timestamp}`, attachments: [], referral: m.postback.referral || null,
            postback: String(m.postback.payload || '').slice(0, 200), timestamp: m.timestamp ? new Date(Number(m.timestamp)).toISOString() : new Date().toISOString(), echo: false });
          continue;
        }
        if (!m.message || m.message.is_deleted) continue; // reads, deliveries, reactions … are ignored
        const echo = Boolean(m.message.is_echo);
        events.push({
          platform, externalId: String(entry.id),
          customerId: String(echo ? m.recipient?.id : m.sender?.id),
          messageId: m.message.mid ? String(m.message.mid) : null,
          text: String(m.message.text || m.message.quick_reply?.payload || ''),
          attachments: [...(m.message.reply_to?.story ? [{ type: 'story_reply', url: m.message.reply_to.story.url || null }] : []),
            ...(m.message.attachments || []).filter((a) => a?.type).map((a) => ({ type: a.type, url: a.payload?.url || null }))],
          referral: m.message.referral || m.referral || null,
          timestamp: m.timestamp ? new Date(Number(m.timestamp)).toISOString() : new Date().toISOString(),
          echo, appId: m.message.app_id ? String(m.message.app_id) : null,
        });
      }
    } else if (object === 'whatsapp_business_account') {
      for (const ch of Array.isArray(entry.changes) ? entry.changes : []) {
        const v = ch.value || {};
        if (ch.field !== 'messages' || !v.metadata?.phone_number_id) continue;
        const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
        for (const msg of v.messages || []) {
          const text = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title
            || msg.image?.caption || '';
          events.push({
            platform: 'whatsapp', externalId: String(v.metadata.phone_number_id),
            customerId: String(msg.from), customerName: names[msg.from] || null,
            messageId: msg.id ? String(msg.id) : null, text: String(text),
            attachments: ['image', 'audio', 'video', 'document', 'sticker', 'location'].filter((t) => msg.type === t).map((t) => ({ type: t === 'audio' && msg.audio?.voice ? 'audio' : t, mediaId: msg[t]?.id ? String(msg[t].id) : null })),
            referral: msg.referral || null,
            timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(), echo: false,
          });
        }
      }
    }
  }
  return events;
}

/** Split long replies at paragraph/sentence boundaries so they fit the platform's message limit. */
export function splitText(text, maxLen) {
  const parts = [];
  let rest = String(text || '').trim();
  while (rest.length > maxLen) {
    let cut = Math.max(rest.lastIndexOf('\n', maxLen), rest.lastIndexOf('. ', maxLen) + 1, rest.lastIndexOf('। ', maxLen) + 1);
    if (cut < maxLen / 2) cut = rest.lastIndexOf(' ', maxLen);
    if (cut <= 0) cut = maxLen;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.slice(0, 5);
}

async function graphPost(path, token, body) {
  const res = await fetch(`${graphBase()}/${graphVersion()}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(`${e.message || `Graph API HTTP ${res.status}`}${e.code ? ` (code ${e.code})` : ''}`);
  }
  return json;
}

/** Send a text message to a customer. Returns the platform message ids. */
/**
 * Send a text message to a customer, optionally with tap-to-answer buttons (Messenger/Instagram quick replies,
 * WhatsApp reply buttons) on the last part. Returns the platform message ids.
 */
export async function sendText(channel, token, customerId, text, { buttons = [] } = {}) {
  const ids = [];
  const parts = splitText(text, PLATFORMS[channel.platform].maxLen);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const btns = i === parts.length - 1 ? buttons.slice(0, channel.platform === 'whatsapp' ? 3 : 13) : [];
    let out;
    if (channel.platform === 'whatsapp') {
      const body = btns.length && part.length <= 1024
        ? { type: 'interactive', interactive: { type: 'button', body: { text: part }, action: { buttons: btns.map((b, n) => ({ type: 'reply', reply: { id: `b${n}`, title: b.slice(0, 20) } })) } } }
        : { type: 'text', text: { body: part, preview_url: false } };
      out = await graphPost(`${encodeURIComponent(channel.external_id)}/messages`, token, { messaging_product: 'whatsapp', recipient_type: 'individual', to: customerId, ...body });
      ids.push(out.messages?.[0]?.id || null);
    } else {
      const message = { text: part, ...(btns.length ? { quick_replies: btns.map((b) => ({ content_type: 'text', title: b.slice(0, 20), payload: b.slice(0, 100) })) } : {}) };
      out = await graphPost(`${encodeURIComponent(channel.send_id || channel.external_id)}/messages`, token, { recipient: { id: customerId }, messaging_type: 'RESPONSE', message });
      ids.push(out.message_id || null);
    }
  }
  return ids;
}

/** Send a photo (e.g. a product picture) by public https URL. */
export async function sendImage(channel, token, customerId, url) {
  if (channel.platform === 'whatsapp') {
    const out = await graphPost(`${encodeURIComponent(channel.external_id)}/messages`, token, { messaging_product: 'whatsapp', recipient_type: 'individual', to: customerId, type: 'image', image: { link: url } });
    return out.messages?.[0]?.id || null;
  }
  const out = await graphPost(`${encodeURIComponent(channel.send_id || channel.external_id)}/messages`, token,
    { recipient: { id: customerId }, messaging_type: 'RESPONSE', message: { attachment: { type: 'image', payload: { url, is_reusable: true } } } });
  return out.message_id || null;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
/**
 * Download a customer's photo so the AI can look at it. Messenger/Instagram give a CDN URL; WhatsApp gives a
 * media id that is resolved with the token. Returns {media_type, data(base64)} or null. Max 5 MB.
 */
export async function fetchCustomerImage(channel, token, att) {
  try {
    let url = att.url;
    let auth = {};
    if (!url && att.mediaId) {
      const meta = await fetch(`${graphBase()}/${graphVersion()}/${encodeURIComponent(att.mediaId)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).then((r) => r.json());
      url = meta.url; auth = { authorization: `Bearer ${token}` };
    }
    if (!url || !/^https?:\/\//.test(url)) return null;
    // Only Meta's own media hosts (or the configured Graph host) — never an arbitrary URL from a payload.
    const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    if (!url.startsWith(graphBase()) && !(/^https:\/\//.test(url) && /(^|\.)(fbcdn\.net|fbsbx\.com|cdninstagram\.com|whatsapp\.net|facebook\.com)$/.test(host))) return null;
    const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(20_000) });
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim();
    if (!res.ok || !IMAGE_TYPES.has(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) return null;
    return { media_type: type, data: buf.toString('base64') };
  } catch { return null; }
}

/** Check that a token can reach the account (used when connecting a channel). */
export async function testChannel(channel, token) {
  const id = channel.platform === 'whatsapp' ? channel.external_id : (channel.send_id || channel.external_id);
  const fields = channel.platform === 'whatsapp' ? 'display_phone_number,verified_name' : 'name';
  const res = await fetch(`${graphBase()}/${graphVersion()}/${encodeURIComponent(id)}?fields=${fields}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message || `Graph API HTTP ${res.status}`);
  return { name: (channel.platform === 'whatsapp' ? json.verified_name || json.display_phone_number : json.name) || '' };
}
