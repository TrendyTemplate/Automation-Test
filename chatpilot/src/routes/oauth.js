import { Router } from 'express';
import { one, run } from '../db.js';
import { buildAuthUrl, verifyState, exchangeCode, oauthAvailability, PROVIDERS } from '../services/oauth.js';
import { getBool } from '../settings.js';
import { createAccount, finishLogin } from './auth.js';

const r = Router();

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
