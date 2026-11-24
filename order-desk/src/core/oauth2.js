// OAuth 2.0 for accounting platforms (QuickBooks Online, Xero): authorize URL, code exchange, refresh with rotation.
// Tokens are stored encrypted in stores.oauth_enc, bound to the store id.
import { config } from '../config.js';
import { encrypt, decrypt } from '../crypto.js';
import { run, get } from '../db.js';
import { http, readJson } from '../connectors/http.js';

export const PROVIDERS = {
  quickbooks: {
    authUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    scope: 'com.intuit.quickbooks.accounting',
    creds: () => config.quickbooks,
  },
  xero: {
    authUrl: 'https://login.xero.com/identity/connect/authorize',
    tokenUrl: 'https://identity.xero.com/connect/token',
    scope: 'openid profile email offline_access accounting.transactions accounting.contacts accounting.settings',
    creds: () => config.xero,
  },
};

export const redirectUri = (provider) => `${config.appUrl}/connect/${provider}/callback`;

export function authorizeUrl(provider, state) {
  const p = PROVIDERS[provider];
  if (!p?.creds().clientId) throw Object.assign(new Error(`${provider} is not configured on this server`), { status: 500 });
  const u = new URL(p.authUrl);
  u.searchParams.set('client_id', p.creds().clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', p.scope);
  u.searchParams.set('redirect_uri', redirectUri(provider));
  u.searchParams.set('state', state);
  return u.toString();
}

async function tokenRequest(provider, params) {
  const p = PROVIDERS[provider];
  const { clientId, clientSecret } = p.creds();
  const res = await http.fetch(p.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await readJson(res, `${provider} token`);
  if (!body?.access_token) throw new Error(`${provider} did not return an access token`);
  return body;
}

export const exchangeCode = (provider, code) => tokenRequest(provider, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(provider) });

export function readOAuth(store) {
  if (!store.oauth_enc) return null;
  return JSON.parse(decrypt(store.oauth_enc, `store:${store.id}:oauth`));
}

export function saveOAuth(storeId, data) {
  run('UPDATE stores SET oauth_enc = ? WHERE id = ?', encrypt(JSON.stringify(data), `store:${storeId}:oauth`), storeId);
}

/** Valid access token for the store, refreshing (and saving the rotated refresh token) when it is about to expire. */
export async function accessToken(store, provider) {
  const fresh = get('SELECT * FROM stores WHERE id = ?', store.id) || store;
  const data = readOAuth(fresh);
  if (!data?.refresh_token) throw Object.assign(new Error(`Connect ${provider} first`), { status: 400 });
  if (data.access_token && data.expires_at > Date.now() + 60_000) return { token: data.access_token, data };
  const t = await tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: data.refresh_token });
  const next = {
    ...data,
    access_token: t.access_token,
    refresh_token: t.refresh_token || data.refresh_token,
    expires_at: Date.now() + (Number(t.expires_in) || 1800) * 1000,
  };
  saveOAuth(store.id, next);
  return { token: next.access_token, data: next };
}
