// Google & Microsoft OAuth 2.0: "Sign in with…" and one-click mailbox connection (IMAP/SMTP via XOAUTH2).
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
    // https://mail.google.com/ is the only Gmail scope that allows IMAP/SMTP (restricted scope -> needs Google verification).
    mailboxScopes: 'openid email profile https://mail.google.com/',
    extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    imap: { host: 'imap.gmail.com', port: 993, secure: true }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    loginScopes: 'openid email profile',
    mailboxScopes: 'openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send',
    extra: { prompt: 'select_account' },
    imap: { host: 'outlook.office365.com', port: 993, secure: true }, smtp: { host: 'smtp.office365.com', port: 587, secure: false },
  },
};

const creds = (p) => ({ id: getSetting(`${p}_client_id`), secret: getSetting(`${p}_client_secret`) });

export function oauthAvailability() {
  const out = {};
  for (const p of Object.keys(PROVIDERS)) {
    const ok = Boolean(creds(p).id && creds(p).secret);
    out[p] = { login: ok && getBool(`${p}_login_enabled`), mailbox: ok && getBool(`${p}_mailbox_enabled`) };
  }
  return out;
}

export const redirectUri = (p) => `${appUrl()}/api/oauth/${p}/callback`;

/** purpose: 'login' | 'mailbox'. State is a short-lived signed JWT (CSRF protection + carries context). */
export function buildAuthUrl(provider, purpose, ctx = {}) {
  const p = PROVIDERS[provider];
  const { id } = creds(provider);
  if (!p || !id) throw new Error(`${provider} sign-in is not configured`);
  const state = jwt.sign({ provider, purpose, ...ctx }, config.jwtSecret, { expiresIn: '15m' });
  const params = new URLSearchParams({
    client_id: id, redirect_uri: redirectUri(provider), response_type: 'code',
    scope: purpose === 'mailbox' ? p.mailboxScopes : p.loginScopes, state, ...p.extra,
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

/** Get a valid access token for an OAuth mailbox, refreshing (and persisting) when needed. */
export async function mailboxAccessToken(mb) {
  const provider = mb.auth_type === 'oauth_google' ? 'google' : 'microsoft';
  if (mb.oauth_access_enc && mb.oauth_expires_at && mb.oauth_expires_at > Date.now() + 60_000) return open(mb.workspace_id, 'mailboxes.oauth_access', mb.oauth_access_enc);
  const refresh = mb.oauth_refresh_enc ? open(mb.workspace_id, 'mailboxes.oauth_refresh', mb.oauth_refresh_enc) : null;
  if (!refresh) throw new Error('Mailbox authorization expired — please reconnect this account');
  let t;
  try {
    t = await tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: refresh });
  } catch (e) {
    throw new Error(`Authorization expired or revoked — reconnect this account (${e.message})`);
  }
  const expires = Date.now() + (t.expires_in || 3600) * 1000;
  // Providers may rotate refresh tokens: always keep the newest one.
  const accessEnc = seal(mb.workspace_id, 'mailboxes.oauth_access', t.access_token);
  run('UPDATE mailboxes SET oauth_access_enc=?, oauth_expires_at=?, oauth_refresh_enc=COALESCE(?, oauth_refresh_enc) WHERE id=?',
    accessEnc, expires, t.refresh_token ? seal(mb.workspace_id, 'mailboxes.oauth_refresh', t.refresh_token) : null, mb.id);
  mb.oauth_access_enc = accessEnc;
  mb.oauth_expires_at = expires;
  return t.access_token;
}

/**
 * Revoke our access at the provider when a mailbox is removed (least privilege: no dormant tokens left behind).
 * Google supports token revocation; Microsoft grants are removed by the user (myapps.microsoft.com), so we just
 * discard the tokens.
 */
export async function revokeMailboxGrant(mb) {
  if (mb.auth_type !== 'oauth_google' || !mb.oauth_refresh_enc) return false;
  const token = open(mb.workspace_id, 'mailboxes.oauth_refresh', mb.oauth_refresh_enc);
  if (!token || token.startsWith('[unreadable')) return false;
  const res = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10_000),
  });
  return res.ok;
}
