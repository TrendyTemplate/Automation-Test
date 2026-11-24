// "Connect with Facebook": the platform's own Meta app (Facebook Login for Business) gives shops one-click access for
// their Pages, Instagram accounts and WhatsApp numbers — no developer app per shop. Also Meta's data-deletion and
// deauthorize callbacks (signed_request), which Meta requires before App Review.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getSetting, appUrl } from '../settings.js';

const graphBase = () => (process.env.META_GRAPH_URL || 'https://graph.facebook.com').replace(/\/$/, '');
const dialogBase = () => (process.env.META_DIALOG_URL || 'https://www.facebook.com').replace(/\/$/, '');
const version = () => process.env.META_GRAPH_VERSION || 'v21.0';

export const metaApp = () => ({ id: getSetting('meta_app_id'), secret: getSetting('meta_app_secret') });
export const metaConnectAvailable = () => Boolean(metaApp().id && metaApp().secret);
export const redirectUri = () => `${appUrl()}/api/oauth/meta/callback`;

export const SCOPES = {
  pages: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement', 'instagram_basic', 'instagram_manage_messages', 'business_management'],
  whatsapp: ['whatsapp_business_management', 'whatsapp_business_messaging', 'business_management'],
};

/** Build the Facebook Login dialog URL. State is a short-lived signed token bound to user + workspace. */
export function buildConnectUrl(kind, { uid, wsId }) {
  const { id } = metaApp();
  if (!id) throw new Error('Connect with Facebook is not configured');
  const state = jwt.sign({ p: 'meta', kind, uid, wsId }, config.jwtSecret, { expiresIn: '15m' });
  const params = new URLSearchParams({ client_id: id, redirect_uri: redirectUri(), state, response_type: 'code' });
  const configId = getSetting(kind === 'whatsapp' ? 'meta_config_id_whatsapp' : 'meta_config_id_pages');
  if (configId) {
    params.set('config_id', configId); // Facebook Login for Business configuration (incl. WhatsApp Embedded Signup)
    params.set('override_default_response_type', 'true');
  } else {
    params.set('scope', SCOPES[kind].join(','));
  }
  return `${dialogBase()}/${version()}/dialog/oauth?${params}`;
}
export function verifyConnectState(state) {
  const s = jwt.verify(state, config.jwtSecret);
  if (s.p !== 'meta' || !SCOPES[s.kind]) throw new Error('bad state');
  return s;
}

async function graph(path, { method = 'GET', token, params = {}, body } = {}) {
  const url = new URL(`${graphBase()}/${version()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message || `Graph API HTTP ${res.status}`);
  return json;
}

/** code → user access token (long-lived when possible) + Facebook user id. */
export async function exchangeCode(code) {
  const { id, secret } = metaApp();
  const short = await graph('oauth/access_token', { params: { client_id: id, client_secret: secret, redirect_uri: redirectUri(), code } });
  let token = short.access_token;
  try {
    const long = await graph('oauth/access_token', { params: { grant_type: 'fb_exchange_token', client_id: id, client_secret: secret, fb_exchange_token: token } });
    token = long.access_token || token;
  } catch { /* business-integration system-user tokens can't be exchanged and don't need to be */ }
  const me = await graph('me', { token, params: { fields: 'id,name' } });
  return { token, fbUserId: String(me.id), name: me.name || '' };
}

/** Pages the user granted, each with its Page token and linked Instagram professional account. */
export async function listPages(userToken) {
  const out = await graph('me/accounts', { token: userToken, params: { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '100' } });
  return (out.data || []).filter((p) => p.id && p.access_token).map((p) => ({
    id: String(p.id), name: p.name || '', token: p.access_token,
    instagram: p.instagram_business_account?.id ? { id: String(p.instagram_business_account.id), username: p.instagram_business_account.username || '' } : null,
  }));
}

/** WhatsApp numbers the user granted (WABA ids come from the token's granular scopes). */
export async function listWhatsAppNumbers(userToken) {
  const { id, secret } = metaApp();
  const dbg = await graph('debug_token', { params: { input_token: userToken, access_token: `${id}|${secret}` } });
  const wabas = new Set();
  for (const g of dbg.data?.granular_scopes || []) {
    if (['whatsapp_business_management', 'whatsapp_business_messaging'].includes(g.scope)) for (const t of g.target_ids || []) wabas.add(String(t));
  }
  const numbers = [];
  for (const waba of wabas) {
    const list = await graph(`${encodeURIComponent(waba)}/phone_numbers`, { token: userToken, params: { fields: 'id,display_phone_number,verified_name' } });
    for (const n of list.data || []) numbers.push({ id: String(n.id), waba, name: n.verified_name || '', phone: n.display_phone_number || '' });
  }
  return numbers;
}

/** Subscribe our app to a Page's messaging webhooks (Messenger + Instagram events arrive for the Page). */
export const subscribePage = (pageId, pageToken) => graph(`${encodeURIComponent(pageId)}/subscribed_apps`, {
  method: 'POST', token: pageToken, params: { subscribed_fields: 'messages,message_echoes,messaging_postbacks' },
});
/** Subscribe our app to a WhatsApp Business Account's webhooks. */
export const subscribeWaba = (wabaId, token) => graph(`${encodeURIComponent(wabaId)}/subscribed_apps`, { method: 'POST', token });

// ---------- signed_request (data deletion / deauthorize callbacks) ----------
const b64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
/** Verify and decode Meta's signed_request. Returns the payload or null. */
export function parseSignedRequest(signed, secret = metaApp().secret) {
  if (!secret || typeof signed !== 'string' || !signed.includes('.')) return null;
  const [sig, payload] = signed.split('.', 2);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const got = b64url(sig);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  try {
    const data = JSON.parse(b64url(payload).toString('utf8'));
    if (String(data.algorithm || '').toUpperCase() !== 'HMAC-SHA256' || !data.user_id) return null;
    return data;
  } catch { return null; }
}
