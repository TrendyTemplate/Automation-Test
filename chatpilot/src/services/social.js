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
      for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
        if (!m.message || m.message.is_deleted) continue; // reads, deliveries, reactions … are ignored
        const echo = Boolean(m.message.is_echo);
        events.push({
          platform, externalId: String(entry.id),
          customerId: String(echo ? m.recipient?.id : m.sender?.id),
          messageId: m.message.mid ? String(m.message.mid) : null,
          text: String(m.message.text || m.message.quick_reply?.payload || ''),
          attachments: (m.message.attachments || []).map((a) => a.type).filter(Boolean),
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
            attachments: ['image', 'audio', 'video', 'document', 'sticker', 'location'].filter((t) => msg.type === t),
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
export async function sendText(channel, token, customerId, text) {
  const ids = [];
  for (const part of splitText(text, PLATFORMS[channel.platform].maxLen)) {
    let out;
    if (channel.platform === 'whatsapp') {
      out = await graphPost(`${encodeURIComponent(channel.external_id)}/messages`, token,
        { messaging_product: 'whatsapp', recipient_type: 'individual', to: customerId, type: 'text', text: { body: part, preview_url: false } });
      ids.push(out.messages?.[0]?.id || null);
    } else {
      out = await graphPost(`${encodeURIComponent(channel.send_id || channel.external_id)}/messages`, token,
        { recipient: { id: customerId }, messaging_type: 'RESPONSE', message: { text: part } });
      ids.push(out.message_id || null);
    }
  }
  return ids;
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
