import { Router } from 'express';
import { one, run } from '../db.js';
import { buildAuthUrl, verifyState, exchangeCode, oauthAvailability, PROVIDERS } from '../services/oauth.js';
import { getBool } from '../settings.js';
import { createAccount, finishLogin } from './auth.js';
import { requireAuth } from '../auth.js';
import { randomToken } from '../crypto.js';
import { seal } from '../vault.js';
import { metaConnectAvailable, buildConnectUrl, verifyConnectState, exchangeCode as metaExchangeCode, listPages, listWhatsAppNumbers } from '../services/meta.js';

const r = Router();

// ---------- "Connect with Facebook" (Pages, Instagram, WhatsApp) — registered before the generic sign-in routes ----------
const managerOnly = (req, res, next) => (['owner', 'admin'].includes(req.role) && !req.viaApiKey ? next() : res.redirect('/app#channels?error=forbidden'));
r.get('/meta/connect', requireAuth, managerOnly, (req, res) => {
  if (!metaConnectAvailable()) return res.redirect('/app#channels?error=not_configured');
  const kind = req.query.kind === 'whatsapp' ? 'whatsapp' : 'pages';
  res.redirect(buildConnectUrl(kind, { uid: req.user.id, wsId: req.workspace.id }));
});
r.get('/meta/callback', async (req, res) => {
  const back = (q) => res.redirect(`/app#channels?${new URLSearchParams(q)}`);
  if (req.query.error) return back({ error: String(req.query.error_reason || req.query.error).slice(0, 80) });
  let state;
  try { state = verifyConnectState(String(req.query.state || '')); } catch { return back({ error: 'expired' }); }
  const member = one('SELECT role FROM workspace_members WHERE user_id = ? AND workspace_id = ?', state.uid, state.wsId);
  if (!member || !['owner', 'admin'].includes(member.role)) return back({ error: 'forbidden' });
  try {
    const u = await metaExchangeCode(String(req.query.code || ''));
    const items = state.kind === 'whatsapp' ? await listWhatsAppNumbers(u.token) : await listPages(u.token);
    if (!items.length) return back({ error: state.kind === 'whatsapp' ? 'no_whatsapp_numbers' : 'no_pages' });
    const id = randomToken(16);
    run(`INSERT INTO meta_pending (id, workspace_id, user_id, kind, fb_user_id, data_enc, expires_at) VALUES (?,?,?,?,?,?, datetime('now', '+15 minutes'))`,
      id, state.wsId, state.uid, state.kind, u.fbUserId, seal(state.wsId, 'meta_pending.data', JSON.stringify({ userToken: u.token, items })));
    run(`DELETE FROM meta_pending WHERE expires_at < datetime('now')`);
    return back({ pick: id });
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
