import { Router } from 'express';
import { one, run } from '../db.js';
import { buildAuthUrl, verifyState, exchangeCode, oauthAvailability, PROVIDERS } from '../services/oauth.js';
import { getBool } from '../settings.js';
import { createAccount, finishLogin } from './auth.js';
import { requireAuth } from '../auth.js';
import { connectGranted } from '../services/connect.js';
import { metaConnectAvailable, buildConnectUrl, verifyConnectState, exchangeCode as metaExchangeCode, listPages, listWhatsAppNumbers } from '../services/meta.js';

const r = Router();

// ---------- Facebook: "Continue with Facebook" (account + pages in one step) and "Connect" (signed-in users) ----------
const managerOnly = (req, res, next) => (['owner', 'admin'].includes(req.role) && !req.viaApiKey ? next() : res.redirect('/app#channels?error=forbidden'));
r.get('/meta/signup', (req, res) => {
  if (!metaConnectAvailable()) return res.redirect('/signup?error=provider_disabled');
  res.redirect(buildConnectUrl('signup', { ref: req.query.ref || req.cookies?.mp_ref || null }));
});
r.get('/meta/connect', requireAuth, managerOnly, (req, res) => {
  if (!metaConnectAvailable()) return res.redirect('/app#channels?error=not_configured');
  const kind = req.query.kind === 'whatsapp' ? 'whatsapp' : 'pages';
  res.redirect(buildConnectUrl(kind, { uid: req.user.id, wsId: req.workspace.id }));
});
r.get('/meta/callback', async (req, res) => {
  let state = null;
  try { state = verifyConnectState(String(req.query.state || '')); } catch { /* handled below */ }
  const signup = state?.kind === 'signup';
  const back = (q) => res.redirect(signup ? `/signup?${new URLSearchParams(q)}` : `/app#channels?${new URLSearchParams(q)}`);
  if (req.query.error) return back({ error: String(req.query.error_reason || req.query.error).slice(0, 80) });
  if (!state) return back({ error: 'expired' });
  try {
    const u = await metaExchangeCode(String(req.query.code || ''));
    let wsId = state.wsId;
    let user = null;
    if (signup) {
      // Find or create the ChatPilot account for this Facebook user. Existing email accounts are only linked after a
      // password sign-in (a Facebook email is not proof of owning that ChatPilot account).
      user = one('SELECT * FROM users WHERE facebook_id = ?', u.fbUserId);
      if (!user) {
        if (u.email && one('SELECT id FROM users WHERE email = ?', u.email)) return back({ error: 'account_exists_use_password' });
        if (!getBool('signup_enabled')) return back({ error: 'signups_closed' });
        user = createAccount({ email: u.email || `fb-${u.fbUserId}@facebook.invalid`, name: u.name, verified: Boolean(u.email), refCode: state.ref, facebookId: u.fbUserId });
      }
      if (user.suspended) return res.redirect('/login?error=suspended');
      wsId = one(`SELECT workspace_id FROM workspace_members WHERE user_id = ? AND role IN ('owner', 'admin') ORDER BY (workspace_id = ?) DESC LIMIT 1`, user.id, user.current_workspace_id || 0)?.workspace_id;
    } else {
      const member = one('SELECT role FROM workspace_members WHERE user_id = ? AND workspace_id = ?', state.uid, state.wsId);
      if (!member || !['owner', 'admin'].includes(member.role)) return back({ error: 'forbidden' });
      run('UPDATE users SET facebook_id = COALESCE(facebook_id, ?) WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE facebook_id = ?)', u.fbUserId, state.uid, u.fbUserId);
    }
    const kind = state.kind === 'whatsapp' ? 'whatsapp' : 'pages';
    const items = kind === 'whatsapp' ? await listWhatsAppNumbers(u.token) : await listPages(u.token);
    const results = items.length ? await connectGranted(req, wsId, { kind, fbUserId: u.fbUserId, userToken: u.token, items }) : [];
    const ok = results.filter((x) => x.ok).length;
    const q = { connected: String(ok), ...(results.some((x) => !x.ok) ? { problems: results.filter((x) => !x.ok).map((x) => `${x.name}: ${x.error}`).join(' · ').slice(0, 300) } : {}),
      ...(!items.length ? { error: kind === 'whatsapp' ? 'no_whatsapp_numbers' : 'no_pages' } : {}) };
    if (signup) {
      if (user.totp_enabled) {
        const jwt = (await import('jsonwebtoken')).default;
        const { config } = await import('../config.js');
        return res.redirect(`/login?twofa=${encodeURIComponent(jwt.sign({ uid: user.id, pending2fa: true }, config.jwtSecret, { expiresIn: '10m' }))}`);
      }
      finishLogin(req, res, user, 'facebook');
    }
    return res.redirect(`/app#welcome?${new URLSearchParams(q)}`);
  } catch (e) {
    console.error('[meta-connect]', e.message);
    return back({ error: e.message.slice(0, 120) });
  }
});

// "Sign in with Google / Microsoft"
r.get('/:provider/login', (req, res) => {
  const { provider } = req.params;
  if (!oauthAvailability()[provider]?.login) return res.redirect('/login?error=provider_disabled');
  res.redirect(buildAuthUrl(provider, 'login', { ref: req.query.ref || req.cookies?.mp_ref || null }));
});


r.get('/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  if (req.query.error) return res.redirect(`/login?error=${encodeURIComponent(String(req.query.error))}`);
  let state;
  try { state = verifyState(String(req.query.state || '')); } catch { return res.redirect('/login?error=expired'); }
  if (state.provider !== provider || !PROVIDERS[provider]) return res.redirect('/login?error=bad_state');

  try {
    const id = await exchangeCode(provider, String(req.query.code || ''));
    const idCol = provider === 'google' ? 'google_id' : 'microsoft_id';

    if (state.purpose === 'login') {
      let user = one(`SELECT * FROM users WHERE ${idCol} = ?`, id.sub);
      const byEmail = !user && one('SELECT * FROM users WHERE email = ?', id.email);
      // Google guarantees email_verified; Microsoft's email claim is not always verified (multi-tenant "nOAuth" risk),
      // so Microsoft identities are only linked automatically to accounts already linked by their immutable id.
      if (byEmail && provider === 'microsoft') return res.redirect('/login?error=account_exists_use_password');
      user ||= byEmail;
      if (!user) {
        if (!getBool('signup_enabled')) return res.redirect('/login?error=signups_closed');
        user = createAccount({ email: id.email, name: id.name, avatar: id.picture, verified: true, refCode: state.ref, [provider === 'google' ? 'googleId' : 'microsoftId']: id.sub });
      } else {
        // Link the provider to the existing account (email ownership is proven by the provider).
        run(`UPDATE users SET ${idCol} = ?, email_verified = 1, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?`, id.sub, id.picture, user.id);
      }
      if (user.suspended) return res.redirect('/login?error=suspended');
      if (user.totp_enabled) {
        // OAuth proves the identity at the provider, but 2FA on our side still applies.
        const jwt = (await import('jsonwebtoken')).default;
        const { config } = await import('../config.js');
        const pending = jwt.sign({ uid: user.id, pending2fa: true }, config.jwtSecret, { expiresIn: '10m' });
        return res.redirect(`/login?twofa=${encodeURIComponent(pending)}`);
      }
      finishLogin(req, res, user, provider);
      return res.redirect('/app');
    }
    return res.redirect('/login?error=bad_state');  } catch (e) {
    console.error('[oauth]', e.message);
    return res.redirect(`/login?error=${encodeURIComponent(e.message.slice(0, 120))}`);
  }
});

export default r;
