import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { one, all, run, tx, audit } from '../db.js';
import { config } from '../config.js';
import { issueToken, requireAuth, sha256 } from '../auth.js';
import { effectivePlan } from '../plans.js';
import { getBool, getNum, appUrl, appName } from '../settings.js';
import { randomToken, encrypt, decrypt } from '../crypto.js';
import { generateSecret, verifyTotp, otpauthUrl } from '../services/totp.js';
import { sendSystemEmail, notifyAdmins } from '../services/notify.js';
import { oauthAvailability } from '../services/oauth.js';

const r = Router();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function createToken(userId, purpose, hours) {
  const t = randomToken(24);
  run('INSERT INTO tokens (token_hash, user_id, purpose, expires_at) VALUES (?,?,?,?)', sha256(t), userId, purpose,
    new Date(Date.now() + hours * 3600_000).toISOString().replace('T', ' ').slice(0, 19));
  return t;
}
function consumeToken(token, purpose) {
  const row = one(`SELECT * FROM tokens WHERE token_hash = ? AND purpose = ? AND expires_at > datetime('now')`, sha256(token), purpose);
  if (row) run('DELETE FROM tokens WHERE token_hash = ?', row.token_hash);
  return row;
}

/** Create user + personal workspace (shared by password sign-up and OAuth sign-up). */
export function createAccount({ email, name, passwordHash, company, googleId, microsoftId, avatar, verified, refCode }) {
  const trialEnds = new Date(Date.now() + getNum('trial_days') * 86400_000).toISOString();
  const referrer = refCode ? one('SELECT id FROM users WHERE referral_code = ?', String(refCode)) : null;
  const user = tx(() => {
    const u = run(`INSERT INTO users (email, name, password_hash, is_admin, google_id, microsoft_id, avatar_url, email_verified, referred_by, referral_code)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, email, name || '', passwordHash || '!', config.adminEmails.includes(email) ? 1 : 0,
    googleId || null, microsoftId || null, avatar || null, verified ? 1 : 0, referrer?.id || null, randomToken(4));
    const uid = Number(u.lastInsertRowid);
    const w = run('INSERT INTO workspaces (name, owner_id, business_name, trial_ends_at) VALUES (?,?,?,?)',
      company || `${name || email.split('@')[0]}'s workspace`, uid, company || '', trialEnds);
    run('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)', Number(w.lastInsertRowid), uid, 'owner');
    return one('SELECT * FROM users WHERE id = ?', uid);
  });
  notifyAdmins('New sign-up', `${email} (${name || ''}) just signed up${referrer ? ' via a referral' : ''}.`).catch(() => {});
  return user;
}

export function sendVerification(user) {
  const t = createToken(user.id, 'verify', 72);
  return sendSystemEmail(user.email, `Confirm your email for ${appName()}`,
    `Welcome to ${appName()}! Confirm your email address by opening this link:\n${appUrl()}/api/auth/verify?token=${t}\n\nThe link is valid for 3 days.`);
}

function finishLogin(req, res, user) {
  run(`UPDATE users SET last_login_at = datetime('now'), last_login_ip = ? WHERE id = ?`, req.ip, user.id);
  issueToken(res, user);
}

r.get('/providers', (req, res) => res.json({ ...oauthAvailability(), signupEnabled: getBool('signup_enabled') }));

r.post('/signup', async (req, res) => {
  if (!getBool('signup_enabled')) return res.status(403).json({ error: 'Sign-ups are currently closed' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password, name, company } = req.body;
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (one('SELECT id FROM users WHERE email = ?', email)) return res.status(409).json({ error: 'Email already registered' });
  const user = createAccount({ email, name, company, passwordHash: await bcrypt.hash(password, 12), refCode: req.body.ref || req.cookies?.mp_ref });
  sendVerification(user).catch(() => {});
  finishLogin(req, res, user);
  res.json({ ok: true });
});

r.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = one('SELECT * FROM users WHERE email = ?', email);
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.suspended) return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
  if (user.totp_enabled) {
    const pending = jwt.sign({ uid: user.id, pending2fa: true }, config.jwtSecret, { expiresIn: '10m' });
    return res.json({ need2fa: true, pending });
  }
  finishLogin(req, res, user);
  res.json({ ok: true });
});

r.post('/login/2fa', (req, res) => {
  let p;
  try { p = jwt.verify(String(req.body.pending || ''), config.jwtSecret); } catch { return res.status(401).json({ error: 'Login expired, start again' }); }
  if (!p.pending2fa) return res.status(400).json({ error: 'Invalid request' });
  const user = one('SELECT * FROM users WHERE id = ?', p.uid);
  if (!user || !verifyTotp(decrypt(user.totp_secret_enc), req.body.code)) return res.status(401).json({ error: 'Wrong code' });
  finishLogin(req, res, user);
  res.json({ ok: true });
});

r.post('/logout', (req, res) => { res.clearCookie('mp_session'); res.json({ ok: true }); });

r.post('/forgot', async (req, res) => {
  const user = one('SELECT * FROM users WHERE email = ?', String(req.body.email || '').trim().toLowerCase());
  if (user && !user.suspended) {
    const t = createToken(user.id, 'reset', 1);
    await sendSystemEmail(user.email, `Reset your ${appName()} password`,
      `Someone (hopefully you) asked to reset your password. Open this link within 1 hour:\n${appUrl()}/reset?token=${t}\n\nIf you didn't ask, ignore this email.`).catch(() => {});
  }
  res.json({ ok: true }); // same answer either way: don't reveal which emails exist
});

r.post('/reset', async (req, res) => {
  if (String(req.body.password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const row = consumeToken(String(req.body.token || ''), 'reset');
  if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired' });
  run('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?', await bcrypt.hash(req.body.password, 12), row.user_id);
  res.json({ ok: true });
});

r.get('/verify', (req, res) => {
  const row = consumeToken(String(req.query.token || ''), 'verify');
  if (row) run('UPDATE users SET email_verified = 1 WHERE id = ?', row.user_id);
  res.redirect(row ? '/app#dashboard?verified=1' : '/login?verify=failed');
});

r.post('/resend-verification', requireAuth, async (req, res) => {
  await sendVerification(req.user);
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => {
  const ws = req.workspace;
  const workspaces = all(`SELECT w.id, w.name, wm.role, w.plan FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
    WHERE wm.user_id = ? ORDER BY w.id`, req.user.id);
  const announcements = all(`SELECT id, message, level FROM announcements WHERE active = 1
    AND (starts_at IS NULL OR starts_at <= datetime('now')) AND (ends_at IS NULL OR ends_at >= datetime('now')) ORDER BY id DESC`);
  res.json({
    user: { ...req.user, suspended: undefined },
    role: req.role, impersonatedBy: req.impersonatedBy, workspaces, announcements,
    workspace: ws && {
      id: ws.id, name: ws.name, plan: ws.plan, subscription_status: ws.subscription_status,
      trial_ends_at: ws.trial_ends_at, current_period_end: ws.current_period_end, billing_interval: ws.billing_interval,
    },
    effectivePlan: effectivePlan(ws),
  });
});

r.post('/change-password', requireAuth, async (req, res) => {
  const u = one('SELECT * FROM users WHERE id = ?', req.user.id);
  const hasPassword = u.password_hash && u.password_hash !== '!';
  if (hasPassword && !(await bcrypt.compare(String(req.body.current || ''), u.password_hash))) return res.status(400).json({ error: 'Current password is wrong' });
  if (String(req.body.next || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(req.body.next, 12), u.id);
  res.json({ ok: true });
});

r.put('/profile', requireAuth, (req, res) => {
  run('UPDATE users SET name = ?, locale = ? WHERE id = ?', String(req.body.name || ''), String(req.body.locale || 'en'), req.user.id);
  res.json({ ok: true });
});

// ----- Two-factor authentication (TOTP) -----
r.post('/2fa/setup', requireAuth, async (req, res) => {
  const secret = generateSecret();
  run('UPDATE users SET totp_secret_enc = ?, totp_enabled = 0 WHERE id = ?', encrypt(secret), req.user.id);
  const url = otpauthUrl(secret, req.user.email, appName());
  res.json({ secret, otpauth: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
});
r.post('/2fa/enable', requireAuth, (req, res) => {
  const u = one('SELECT totp_secret_enc FROM users WHERE id = ?', req.user.id);
  if (!u.totp_secret_enc || !verifyTotp(decrypt(u.totp_secret_enc), req.body.code)) return res.status(400).json({ error: 'Wrong code — check your phone clock and try again' });
  run('UPDATE users SET totp_enabled = 1 WHERE id = ?', req.user.id);
  res.json({ ok: true });
});
r.post('/2fa/disable', requireAuth, (req, res) => {
  const u = one('SELECT totp_secret_enc FROM users WHERE id = ?', req.user.id);
  if (!u.totp_secret_enc || !verifyTotp(decrypt(u.totp_secret_enc), req.body.code)) return res.status(400).json({ error: 'Wrong code' });
  run('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL WHERE id = ?', req.user.id);
  res.json({ ok: true });
});

// ----- Workspaces (agencies can manage several clients) -----
r.post('/workspaces', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const owned = one('SELECT COUNT(*) AS n FROM workspaces WHERE owner_id = ?', req.user.id).n;
  if (owned >= 20) return res.status(400).json({ error: 'Workspace limit reached' });
  const w = run('INSERT INTO workspaces (name, owner_id, business_name, trial_ends_at) VALUES (?,?,?,?)', name, req.user.id, name,
    new Date(Date.now() + getNum('trial_days') * 86400_000).toISOString());
  const id = Number(w.lastInsertRowid);
  run('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)', id, req.user.id, 'owner');
  run('UPDATE users SET current_workspace_id = ? WHERE id = ?', id, req.user.id);
  res.json({ id });
});
r.post('/workspaces/:id/switch', requireAuth, (req, res) => {
  const m = one('SELECT 1 AS x FROM workspace_members WHERE user_id = ? AND workspace_id = ?', req.user.id, Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Not a member of that workspace' });
  run('UPDATE users SET current_workspace_id = ? WHERE id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ----- GDPR: export & delete -----
r.get('/export', requireAuth, (req, res) => {
  const wsIds = all('SELECT workspace_id FROM workspace_members WHERE user_id = ? AND role = ?', req.user.id, 'owner').map((x) => x.workspace_id);
  const data = { user: one('SELECT id, email, name, created_at, last_login_at FROM users WHERE id = ?', req.user.id), workspaces: [] };
  for (const id of wsIds) {
    data.workspaces.push({
      workspace: one('SELECT id, name, business_name, business_description, plan, created_at FROM workspaces WHERE id = ?', id),
      mailboxes: all('SELECT email, provider, mode, created_at FROM mailboxes WHERE workspace_id = ?', id),
      messages: all('SELECT from_name, from_email, subject, text_body, category, priority, summary, received_at, status FROM messages WHERE workspace_id = ?', id),
      replies: all('SELECT subject, body, status, sent_at FROM replies WHERE workspace_id = ?', id),
      contacts: all('SELECT email, name, company, phone, tags, notes FROM contacts WHERE workspace_id = ?', id),
      knowledge: all('SELECT title, content FROM knowledge WHERE workspace_id = ?', id),
      rules: all('SELECT name, conditions_json, actions_json FROM rules WHERE workspace_id = ?', id),
    });
  }
  res.setHeader('content-disposition', 'attachment; filename="mailpilot-export.json"');
  res.json(data);
});

r.post('/delete-account', requireAuth, async (req, res) => {
  const u = one('SELECT * FROM users WHERE id = ?', req.user.id);
  if (String(req.body.confirm || '') !== u.email) return res.status(400).json({ error: 'Type your email address to confirm' });
  tx(() => {
    run('UPDATE replies SET approved_by = NULL WHERE approved_by = ?', u.id);
    run('DELETE FROM workspaces WHERE owner_id = ?', u.id);
    run('DELETE FROM users WHERE id = ?', u.id);
  });
  audit(req, 'account_deleted', u.email);
  res.clearCookie('mp_session');
  res.json({ ok: true });
});

export default r;
