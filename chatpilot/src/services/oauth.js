// Google & Microsoft OAuth 2.0: "Sign in with Google / Microsoft".
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getSetting, getBool, appUrl } from '../settings.js';
import { run } from '../db.js';
import { seal, open } from '../vault.js';

export const PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    loginScopes: 'openid email profile',
    extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    loginScopes: 'openid email profile',
    extra: { prompt: 'select_account' },
  },
};

const creds = (p) => ({ id: getSetting(`${p}_client_id`), secret: getSetting(`${p}_client_secret`) });

export function oauthAvailability() {
  const out = {};
  for (const p of Object.keys(PROVIDERS)) {
    const ok = Boolean(creds(p).id && creds(p).secret);
    out[p] = { login: ok && getBool(`${p}_login_enabled`) };
  }
  return out;
}

export const redirectUri = (p) => `${appUrl()}/api/oauth/${p}/callback`;

/** purpose: 'login'. State is a short-lived signed JWT (CSRF protection + carries context). */
export function buildAuthUrl(provider, purpose, ctx = {}) {
  const p = PROVIDERS[provider];
  const { id } = creds(provider);
  if (!p || !id) throw new Error(`${provider} sign-in is not configured`);
  const state = jwt.sign({ provider, purpose, ...ctx }, config.jwtSecret, { expiresIn: '15m' });
  const params = new URLSearchParams({
    client_id: id, redirect_uri: redirectUri(provider), response_type: 'code',
    scope: p.loginScopes, state, ...p.extra,
  });
  if (purpose === 'login') {
    // Sign-in only needs identity: no offline access, and no forced consent screen on every login.
    params.delete('access_type');
    params.delete('include_granted_scopes');
    params.set('prompt', 'select_account');
  }
  if (ctx.loginHint) params.set('login_hint', ctx.loginHint);
  return `${p.authUrl}?${params}`;
}

export const verifyState = (state) => jwt.verify(state, config.jwtSecret);

async function tokenRequest(provider, body) {
  const { id, secret } = creds(provider);
  const res = await fetch(PROVIDERS[provider].tokenUrl, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'OAuth token request failed');
  return data;
}

/** Exchange the authorization code. Returns tokens + verified identity (from the id_token issued over TLS). */
export async function exchangeCode(provider, code) {
  const t = await tokenRequest(provider, { code, grant_type: 'authorization_code', redirect_uri: redirectUri(provider) });
  const claims = t.id_token ? jwt.decode(t.id_token) : {};
  const email = String(claims.email || claims.preferred_username || claims.upn || '').toLowerCase();
  if (!email) throw new Error('The provider did not return an email address');
  if (provider === 'google' && claims.email_verified === false) throw new Error('Google email is not verified');
  return {
    sub: claims.sub || claims.oid, email, name: claims.name || '', picture: claims.picture || null,
    accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 3600) * 1000,
  };
}
