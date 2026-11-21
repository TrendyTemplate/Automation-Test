import { Router } from 'express';
import { one, run, logActivity } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { buildAuthUrl, verifyState, exchangeCode, oauthAvailability, PROVIDERS } from '../services/oauth.js';
import { seal } from '../vault.js';
import { securityEvent } from '../db.js';
import { effectivePlan } from '../plans.js';
import { getBool } from '../settings.js';
import { createAccount, finishLogin } from './auth.js';
import { syncMailbox } from '../services/worker.js';

const r = Router();

// "Sign in with Google / Microsoft"
r.get('/:provider/login', (req, res) => {
  const { provider } = req.params;
  if (!oauthAvailability()[provider]?.login) return res.redirect('/login?error=provider_disabled');
  res.redirect(buildAuthUrl(provider, 'login', { ref: req.query.ref || req.cookies?.mp_ref || null }));
});

// "Connect Gmail / Outlook with one click" (signed-in users only)
r.get('/:provider/connect', requireAuth, requireRole('owner', 'admin'), (req, res) => {
  const { provider } = req.params;
  if (!oauthAvailability()[provider]?.mailbox) return res.redirect('/app#mailboxes?error=provider_disabled');
  const plan = effectivePlan(req.workspace);
  const count = one('SELECT COUNT(*) AS n FROM mailboxes WHERE workspace_id = ?', req.workspace.id).n;
  if (count >= plan.mailboxes) return res.redirect('/app#mailboxes?error=limit');
  res.redirect(buildAuthUrl(provider, 'mailbox', {
    uid: req.user.id, wsId: req.workspace.id, mode: ['off', 'draft', 'auto'].includes(req.query.mode) ? req.query.mode : 'draft',
  }));
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

    // purpose === 'mailbox'
    const member = one('SELECT role FROM workspace_members WHERE user_id = ? AND workspace_id = ?', state.uid, state.wsId);
    if (!member || !['owner', 'admin'].includes(member.role)) return res.redirect('/app#mailboxes?error=forbidden');
    if (!id.refreshToken) return res.redirect('/app#mailboxes?error=no_refresh_token');
    const p = PROVIDERS[provider];
    const existing = one('SELECT id FROM mailboxes WHERE workspace_id = ? AND email = ?', state.wsId, id.email);
    const sealTokens = (wsId) => [seal(wsId, 'mailboxes.oauth_refresh', id.refreshToken), seal(wsId, 'mailboxes.oauth_access', id.accessToken)];
    if (existing) {
      const [refEnc, accEnc] = sealTokens(state.wsId);
      run(`UPDATE mailboxes SET auth_type=?, oauth_refresh_enc=?, oauth_access_enc=?, oauth_expires_at=?, password_enc='', last_error=NULL, enabled=1, revoked_at=NULL WHERE id=?`,
        `oauth_${provider}`, refEnc, accEnc, id.expiresAt, existing.id);
      securityEvent(req, 'mailbox_reconnected', { email: id.email, via: provider }, { userId: state.uid, workspaceId: state.wsId });
      return res.redirect('/app#mailboxes?connected=1');
    }
    const [refEnc, accEnc] = sealTokens(state.wsId);
    const ins = run(`INSERT INTO mailboxes (workspace_id, label, email, provider, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
        username, password_enc, mode, auth_type, oauth_refresh_enc, oauth_access_enc, oauth_expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, state.wsId, id.name || '', id.email, provider === 'google' ? 'gmail' : 'outlook',
    p.imap.host, p.imap.port, p.imap.secure ? 1 : 0, p.smtp.host, p.smtp.port, p.smtp.secure ? 1 : 0,
    id.email, '', state.mode || 'draft', `oauth_${provider}`, refEnc, accEnc, id.expiresAt);
    logActivity(state.wsId, 'mailbox_added', { email: id.email, via: provider });
    securityEvent(req, 'mailbox_connected', { email: id.email, via: provider }, { userId: state.uid, workspaceId: state.wsId });
    syncMailbox(Number(ins.lastInsertRowid)).catch(() => {});
    return res.redirect('/app#mailboxes?connected=1');
  } catch (e) {
    console.error('[oauth]', e.message);
    const back = state.purpose === 'mailbox' ? '/app#mailboxes' : '/login';
    return res.redirect(`${back}?error=${encodeURIComponent(e.message.slice(0, 120))}`);
  }
});

export default r;
