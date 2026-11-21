import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { one, all, run, tx, audit, securityEvent } from '../db.js';
import { config } from '../config.js';
import {
  issueSession, requireAuth, sha256, revokeSession, revokeAllSessions, listSessions, passwordProblem,
  isLocked, registerFailedLogin, clearFailedLogins, SESSION_COOKIE,
} from '../auth.js';
import { effectivePlan } from '../plans.js';
import { getBool, getNum, appUrl, appName } from '../settings.js';
import { randomToken, encrypt, decrypt } from '../crypto.js';
import { forgetKey } from '../vault.js';
import { generateSecret, verifyTotp, otpauthUrl } from '../services/totp.js';
import { sendSystemEmail, notifyAdmins } from '../services/notify.js';
import { oauthAvailability, revokeMailboxGrant } from '../services/oauth.js';

const r = Router();
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/;
// A real-looking hash so failed lookups take as long as real ones (no user enumeration via timing).
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 12);

function createToken(userId, purpose, hours) {
  const t = randomToken(24);
  run('INSERT INTO tokens (token_hash, user_id, purpose, expires_at) VALUES (?,?,?,?)', sha256(t), userId, purpose,
    new Date(Date.now() + hours * 3600_000).toISOString().replace('T', ' ').slice(0, 19));
  return t;
}
function consumeToken(token, purpose) {
  const row = one(`SELECT * FROM tokens WHERE token_hash = ? AND purpose = ? AND expires_at > datetime('now')`, sha256(String(token)), purpose);
  if (row) run('DELETE FROM tokens WHERE token_hash = ?', row.token_hash);
  return row;
}

/** Create user + personal workspace (shared by password sign-up and OAuth sign-up). */
export function createAccount({ email, name, passwordHash, company, googleId, microsoftId, avatar, verified, refCode }) {
  const trialEnds = new Date(Date.now() + getNum('trial_days') * 86400_000).toISOString();
  const referrer = refCode ? one('SELECT id FROM users WHERE referral_code = ?', String(refCode)) : null;
  const user = tx(() => {
    const u = run(`INSERT INTO users (email, name, password_hash, is_admin, google_id, microsoft_id, avatar_url, email_verified, referred_by, referral_code, password_changed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))`, email, String(name || '').slice(0, 120), passwordHash || '!', config.adminEmails.includes(email) ? 1 : 0,
    googleId || null, microsoftId || null, avatar || null, verified ? 1 : 0, referrer?.id || null, randomToken(4));
    const uid = Number(u.lastInsertRowid);
    const w = run('INSERT INTO workspaces (name, owner_id, business_name, trial_ends_at, webhook_secret) VALUES (?,?,?,?,?)',
      String(company || `${name || email.split('@')[0]}'s workspace`).slice(0, 120), uid, String(company || '').slice(0, 120), trialEnds, randomToken(24));
    run('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)', Number(w.lastInsertRowid), uid, 'owner');
    return one('SELECT * FROM users WHERE id = ?', uid);
  });
  notifyAdmins('New sign-up', `${email} just signed up${referrer ? ' via a referral' : ''}.`).catch(() => {});
  return user;
}

export function sendVerification(user) {
  const t = createToken(user.id, 'verify', 72);
  return sendSystemEmail(user.email, `Confirm your email for ${appName()}`,
    `Welcome to ${appName()}! Confirm your email address by opening this link:\n${appUrl()}/api/auth/verify?token=${t}\n\nThe link is valid for 3 days.`);
}

/** Successful login: new session, security log, and an alert if this device/network is new for the account. */
export function finishLogin(req, res, user, method = 'password') {
  clearFailedLogins(user.id);
  const known = one(`SELECT 1 AS x FROM sessions WHERE user_id = ? AND (ip = ? OR user_agent = ?) AND created_at > datetime('now','-90 days') LIMIT 1`,
    user.id, req.ip || '', String(req.headers['user-agent'] || '').slice(0, 200));
  const hadSessions = one('SELECT 1 AS x FROM sessions WHERE user_id = ? LIMIT 1', user.id);
  run(`UPDATE users SET last_login_at = datetime('now'), last_login_ip = ? WHERE id = ?`, req.ip, user.id);
  issueSession(req, res, user);
  securityEvent(req, 'login', { method }, { userId: user.id });
  if (hadSessions && !known && getBool('new_device_alerts')) {
    securityEvent(req, 'new_device_login', { method }, { userId: user.id });
    sendSystemEmail(user.email, `New sign-in to your ${appName()} account`,
      `Your account was just accessed from a new device or network.\n\nIP: ${req.ip}\nDevice: ${String(req.headers['user-agent'] || 'unknown').slice(0, 120)}\nTime: ${new Date().toUTCString()}\n\nIf this was you, no action is needed. If not, reset your password now and use "Sign out everywhere" in Security & privacy:\n${appUrl()}/forgot`).catch(() => {});
  }
}

r.get('/providers', (req, res) => res.json({ ...oauthAvailability(), signupEnabled: getBool('signup_enabled') }));

r.post('/signup', async (req, res) => {
  if (!getBool('signup_enabled')) return res.status(403).json({ error: 'Sign-ups are currently closed' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password, name, company } = req.body;
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email required' });
  const problem = passwordProblem(password, email);
  if (problem) return res.status(400).json({ error: problem });
  if (one('SELECT id FROM users WHERE email = ?', email)) return res.status(409).json({ error: 'Email already registered' });
  const user = createAccount({ email, name, company, passwordHash: await bcrypt.hash(password, 12), refCode: req.body.ref || req.cookies?.mp_ref });
  sendVerification(user).catch(() => {});
  finishLogin(req, res, user, 'signup');
  res.json({ ok: true });
});

r.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = one('SELECT * FROM users WHERE email = ?', email);
  const generic = () => res.status(401).json({ error: 'Invalid email or password' });
  if (!user) { await bcrypt.compare(String(req.body.password || ''), DUMMY_HASH); return generic(); }
  if (isLocked(user)) {
    securityEvent(req, 'login_blocked_locked', null, { userId: user.id });
    return res.status(429).json({ error: 'Too many failed attempts. This account is temporarily locked — try again later or reset your password.' });
  }
  if (!(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) {
    const lockMin = registerFailedLogin(user);
    securityEvent(req, 'login_failed', { lockMin }, { userId: user.id });
    if (lockMin === 15) sendSystemEmail(user.email, `Failed sign-in attempts on your ${appName()} account`, `We blocked several failed sign-in attempts and locked your account for 15 minutes.\nIP: ${req.ip}\nIf this wasn't you, consider changing your password.`).catch(() => {});
    return generic();
  }
  if (user.suspended) return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
  if (user.totp_enabled) {
    const pending = jwt.sign({ uid: user.id, pending2fa: true, pv: (user.password_changed_at || '') }, config.jwtSecret, { expiresIn: '10m' });
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
  if (!user || isLocked(user)) return res.status(429).json({ error: 'Account temporarily locked' });
  if (!verifyTotp(decrypt(user.totp_secret_enc), req.body.code)) {
    registerFailedLogin(user);
    securityEvent(req, '2fa_failed', null, { userId: user.id });
    return res.status(401).json({ error: 'Wrong code' });
  }
  finishLogin(req, res, user, 'password+2fa');
  res.json({ ok: true });
});

r.post('/logout', (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) revokeSession(sha256(sid));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

r.post('/forgot', async (req, res) => {
  const user = one('SELECT * FROM users WHERE email = ?', String(req.body.email || '').trim().toLowerCase());
  if (user && !user.suspended) {
    run(`DELETE FROM tokens WHERE user_id = ? AND purpose = 'reset'`, user.id); // only the newest link works
    const t = createToken(user.id, 'reset', 1);
    securityEvent(req, 'password_reset_requested', null, { userId: user.id });
    await sendSystemEmail(user.email, `Reset your ${appName()} password`,
      `Someone (hopefully you) asked to reset your password. Open this link within 1 hour:\n${appUrl()}/reset?token=${t}\n\nIf you didn't ask, ignore this email — your password stays the same.`).catch(() => {});
  }
  res.json({ ok: true }); // same answer either way: don't reveal which emails exist
});

r.post('/reset', async (req, res) => {
  const row = one(`SELECT * FROM tokens WHERE token_hash = ? AND purpose = 'reset' AND expires_at > datetime('now')`, sha256(String(req.body.token || '')));
  if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired' });
  const user = one('SELECT email FROM users WHERE id = ?', row.user_id);
  const problem = passwordProblem(req.body.password, user.email);
  if (problem) return res.status(400).json({ error: problem });
  consumeToken(req.body.token, 'reset');
  run(`UPDATE users SET password_hash = ?, email_verified = 1, password_changed_at = datetime('now'), failed_logins = 0, locked_until = NULL WHERE id = ?`,
    await bcrypt.hash(req.body.password, 12), row.user_id);
  revokeAllSessions(row.user_id);
  securityEvent(req, 'password_reset', null, { userId: row.user_id });
  sendSystemEmail(user.email, `Your ${appName()} password was changed`, 'Your password was just reset and all devices were signed out. If this was not you, contact support immediately.').catch(() => {});
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
    adminNeeds2fa: Boolean(req.user.is_admin && config.isProd && getBool('require_admin_2fa') && !req.user.totp_enabled),
    workspace: ws && {
      id: ws.id, name: ws.name, plan: ws.plan, subscription_status: ws.subscription_status,
      trial_ends_at: ws.trial_ends_at, current_period_end: ws.current_period_end, billing_interval: ws.billing_interval,
      support_access_until: ws.support_access_until,
    },
    effectivePlan: effectivePlan(ws),
  });
});

r.post('/change-password', requireAuth, async (req, res) => {
  if (req.impersonatedBy) return res.status(403).json({ error: 'Not allowed while impersonating' });
  const u = one('SELECT * FROM users WHERE id = ?', req.user.id);
  const hasPassword = u.password_hash && u.password_hash !== '!';
  if (hasPassword && !(await bcrypt.compare(String(req.body.current || ''), u.password_hash))) return res.status(400).json({ error: 'Current password is wrong' });
  const problem = passwordProblem(req.body.next, u.email);
  if (problem) return res.status(400).json({ error: problem });
  run(`UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?`, await bcrypt.hash(req.body.next, 12), u.id);
  revokeAllSessions(u.id, req.sessionHash); // keep this device, sign out all others
  securityEvent(req, 'password_changed');
  sendSystemEmail(u.email, `Your ${appName()} password was changed`, 'Your password was changed and your other devices were signed out. If this was not you, reset your password immediately.').catch(() => {});
  res.json({ ok: true });
});

r.put('/profile', requireAuth, (req, res) => {
  const theme = ['system', 'light', 'dark'].includes(req.body.ui_theme) ? req.body.ui_theme : undefined;
  run('UPDATE users SET name = COALESCE(?, name), ui_theme = COALESCE(?, ui_theme) WHERE id = ?',
    req.body.name === undefined ? null : String(req.body.name).slice(0, 120), theme ?? null, req.user.id);
  res.json({ ok: true });
});

// ----- Sessions & devices -----
r.get('/sessions', requireAuth, (req, res) => {
  res.json(listSessions(req.user.id).map((s) => ({ ...s, id: s.id.slice(0, 12), current: s.id === req.sessionHash })));
});
r.post('/sessions/:prefix/revoke', requireAuth, (req, res) => {
  const s = listSessions(req.user.id).find((x) => x.id.startsWith(String(req.params.prefix)) && req.params.prefix.length >= 12);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  revokeSession(s.id);
  securityEvent(req, 'session_revoked');
  res.json({ ok: true });
});
r.post('/sessions/revoke-others', requireAuth, (req, res) => {
  revokeAllSessions(req.user.id, req.sessionHash);
  securityEvent(req, 'signed_out_everywhere');
  res.json({ ok: true });
});
r.get('/security-events', requireAuth, (req, res) => {
  res.json(all('SELECT type, detail, ip, user_agent, created_at FROM security_events WHERE user_id = ? OR workspace_id = ? ORDER BY id DESC LIMIT 100',
    req.user.id, req.workspace?.id ?? -1));
});

// ----- Two-factor authentication (TOTP) -----
r.post('/2fa/setup', requireAuth, async (req, res) => {
  if (req.impersonatedBy) return res.status(403).json({ error: 'Not allowed while impersonating' });
  const secret = generateSecret();
  run('UPDATE users SET totp_secret_enc = ?, totp_enabled = 0 WHERE id = ?', encrypt(secret), req.user.id);
  const url = otpauthUrl(secret, req.user.email, appName());
  res.json({ secret, otpauth: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
});
r.post('/2fa/enable', requireAuth, (req, res) => {
  const u = one('SELECT totp_secret_enc FROM users WHERE id = ?', req.user.id);
  if (!u.totp_secret_enc || !verifyTotp(decrypt(u.totp_secret_enc), req.body.code)) return res.status(400).json({ error: 'Wrong code — check your phone clock and try again' });
  run('UPDATE users SET totp_enabled = 1 WHERE id = ?', req.user.id);
  revokeAllSessions(req.user.id, req.sessionHash);
  securityEvent(req, '2fa_enabled');
  res.json({ ok: true });
});
r.post('/2fa/disable', requireAuth, (req, res) => {
  const u = one('SELECT totp_secret_enc FROM users WHERE id = ?', req.user.id);
  if (!u.totp_secret_enc || !verifyTotp(decrypt(u.totp_secret_enc), req.body.code)) return res.status(400).json({ error: 'Wrong code' });
  run('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL WHERE id = ?', req.user.id);
  securityEvent(req, '2fa_disabled');
  sendSystemEmail(req.user.email, `Two-factor authentication was turned off`, 'Two-factor authentication was just disabled on your account. If this was not you, reset your password immediately.').catch(() => {});
  res.json({ ok: true });
});

// ----- Support access consent (admins can only impersonate with permission) -----
r.post('/support-access', requireAuth, (req, res) => {
  if (!['owner', 'admin'].includes(req.role) || req.impersonatedBy) return res.status(403).json({ error: 'Only workspace owners/admins can grant support access' });
  const hours = Math.max(0, Math.min(168, Number(req.body.hours) || 0));
  const until = hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
  run('UPDATE workspaces SET support_access_until = ? WHERE id = ?', until, req.workspace.id);
  securityEvent(req, hours ? 'support_access_granted' : 'support_access_revoked', { hours });
  res.json({ ok: true, until });
});

// ----- Emergency lockdown: one button to cut every access path -----
r.post('/lockdown', requireAuth, async (req, res) => {
  if (req.role !== 'owner' || req.impersonatedBy) return res.status(403).json({ error: 'Only the workspace owner can do this' });
  const wsId = req.workspace.id;
  const boxes = all('SELECT * FROM mailboxes WHERE workspace_id = ?', wsId);
  for (const mb of boxes) await revokeMailboxGrant(mb).catch(() => {});
  tx(() => {
    run(`UPDATE mailboxes SET enabled = 0, password_enc = '', oauth_refresh_enc = NULL, oauth_access_enc = NULL, revoked_at = datetime('now'),
      last_error = 'Disconnected by emergency lockdown — reconnect to resume' WHERE workspace_id = ?`, wsId);
    run('DELETE FROM api_keys WHERE workspace_id = ?', wsId);
    run(`UPDATE replies SET status = 'pending', scheduled_at = NULL, error = 'Held by emergency lockdown' WHERE workspace_id = ? AND status = 'scheduled'`, wsId);
    run('UPDATE workspaces SET support_access_until = NULL WHERE id = ?', wsId);
    for (const m of all('SELECT user_id FROM workspace_members WHERE workspace_id = ?', wsId)) revokeAllSessions(m.user_id, m.user_id === req.user.id ? req.sessionHash : null);
  });
  securityEvent(req, 'emergency_lockdown', { mailboxes: boxes.length });
  audit(req, 'emergency_lockdown', `workspace:${wsId}`);
  res.json({ ok: true, mailboxes: boxes.length });
});

// ----- Workspaces (agencies can manage several clients) -----
r.post('/workspaces', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const owned = one('SELECT COUNT(*) AS n FROM workspaces WHERE owner_id = ?', req.user.id).n;
  if (owned >= 20) return res.status(400).json({ error: 'Workspace limit reached' });
  const w = run('INSERT INTO workspaces (name, owner_id, business_name, trial_ends_at, webhook_secret) VALUES (?,?,?,?,?)', name, req.user.id, name,
    new Date(Date.now() + getNum('trial_days') * 86400_000).toISOString(), randomToken(24));
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
r.get('/export', requireAuth, async (req, res) => {
  const { openMessage, openReply } = await import('../vault.js');
  const wsIds = all('SELECT workspace_id FROM workspace_members WHERE user_id = ? AND role = ?', req.user.id, 'owner').map((x) => x.workspace_id);
  const data = { exported_at: new Date().toISOString(), user: one('SELECT id, email, name, created_at, last_login_at FROM users WHERE id = ?', req.user.id), workspaces: [] };
  for (const id of wsIds) {
    data.workspaces.push({
      workspace: one('SELECT id, name, business_name, business_description, plan, created_at FROM workspaces WHERE id = ?', id),
      mailboxes: all('SELECT email, provider, mode, created_at FROM mailboxes WHERE workspace_id = ?', id),
      messages: all('SELECT workspace_id, from_name, from_email, subject, text_body, category, priority, summary, received_at, status FROM messages WHERE workspace_id = ?', id).map(openMessage).map(({ workspace_id, ...m }) => m),
      replies: all('SELECT workspace_id, subject, body, status, sent_at FROM replies WHERE workspace_id = ?', id).map(openReply).map(({ workspace_id, ...m }) => m),
      contacts: all('SELECT email, name, company, phone, tags, notes FROM contacts WHERE workspace_id = ?', id),
      knowledge: all('SELECT title, content FROM knowledge WHERE workspace_id = ?', id),
      rules: all('SELECT name, conditions_json, actions_json FROM rules WHERE workspace_id = ?', id),
      ai_log: all('SELECT message_id, purpose, model, created_at FROM ai_log WHERE workspace_id = ?', id),
    });
  }
  securityEvent(req, 'data_exported');
  res.setHeader('content-disposition', 'attachment; filename="mailpilot-export.json"');
  res.json(data);
});

r.post('/delete-account', requireAuth, async (req, res) => {
  if (req.impersonatedBy) return res.status(403).json({ error: 'Not allowed while impersonating' });
  const u = one('SELECT * FROM users WHERE id = ?', req.user.id);
  if (String(req.body.confirm || '').trim().toLowerCase() !== u.email) return res.status(400).json({ error: 'Type your email address to confirm' });
  if (u.password_hash !== '!' && !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) return res.status(400).json({ error: 'Enter your current password to confirm' });
  const owned = all('SELECT id FROM workspaces WHERE owner_id = ?', u.id);
  for (const w of owned) for (const mb of all('SELECT * FROM mailboxes WHERE workspace_id = ?', w.id)) await revokeMailboxGrant(mb).catch(() => {});
  tx(() => {
    run('UPDATE replies SET approved_by = NULL WHERE approved_by = ?', u.id);
    run('DELETE FROM workspaces WHERE owner_id = ?', u.id); // cascades; deleting the wrapped key crypto-shreds leftovers
    run('DELETE FROM users WHERE id = ?', u.id);
  });
  owned.forEach((w) => forgetKey(w.id));
  audit(req, 'account_deleted', u.email);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

export default r;
