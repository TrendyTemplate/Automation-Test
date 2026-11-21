// Authentication & authorization.
// Sessions are opaque random tokens stored server-side (only their SHA-256 hash is in the DB), so they can be
// listed and revoked at any time ("sign out everywhere", password change, admin lockdown).
import { config } from './config.js';
import { one, run, all } from './db.js';
import { getBool } from './settings.js';
import { randomToken, sha256 } from './crypto.js';

export { sha256 };
export const SESSION_COOKIE = config.isProd ? '__Host-mp_session' : 'mp_session';
const DAY = 86400_000;
const SESSION_DAYS = 30;
const IDLE_DAYS = 14;

const sqlTime = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

export function issueSession(req, res, user, { impersonatorId = null } = {}) {
  const sid = randomToken(32);
  const ttl = impersonatorId ? 3600_000 : SESSION_DAYS * DAY;
  run('INSERT INTO sessions (id, user_id, ip, user_agent, impersonator_id, expires_at) VALUES (?,?,?,?,?,?)',
    sha256(sid), user.id, req.ip || null, String(req.headers?.['user-agent'] || '').slice(0, 200), impersonatorId, sqlTime(Date.now() + ttl));
  res.cookie(SESSION_COOKIE, sid, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/', maxAge: ttl });
  return sid;
}

export function revokeSession(sidHash) {
  run(`UPDATE sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`, sidHash);
}
export function revokeAllSessions(userId, exceptHash = null) {
  run(`UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL AND id IS NOT ?`, userId, exceptHash);
}
export const listSessions = (userId) => all(`SELECT id, ip, user_agent, created_at, last_seen_at, impersonator_id FROM sessions
  WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now') ORDER BY last_seen_at DESC`, userId);

function loadWorkspace(user) {
  const pick = (wsId) => one(`SELECT w.*, wm.role FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = ? AND w.id = ?`, user.id, wsId);
  return (user.current_workspace_id && pick(user.current_workspace_id))
    || one(`SELECT w.*, wm.role FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = ? ORDER BY w.id LIMIT 1`, user.id);
}

export function requireAuth(req, res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  // Public API keys ("mp_live_…") act as the workspace with admin role, never as a platform admin.
  if (bearer.startsWith('mp_live_')) {
    const key = one('SELECT * FROM api_keys WHERE key_hash = ?', sha256(bearer));
    if (!key) return res.status(401).json({ error: 'Invalid API key' });
    run(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`, key.id);
    const ws = one('SELECT * FROM workspaces WHERE id = ?', key.workspace_id);
    req.user = one('SELECT id, email, name, 0 AS is_admin, email_verified FROM users WHERE id = ?', ws.owner_id);
    req.workspace = { ...ws, role: 'admin' };
    req.role = 'admin';
    req.viaApiKey = true;
    return next();
  }
  const sid = req.cookies?.[SESSION_COOKIE];
  if (!sid || sid.length < 32) return res.status(401).json({ error: 'Not signed in' });
  const sidHash = sha256(sid);
  const s = one(`SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
      AND last_seen_at > datetime('now', '-${IDLE_DAYS} days')`, sidHash);
  if (!s) return res.status(401).json({ error: 'Session expired — please sign in again' });
  const user = one(`SELECT id, email, name, is_admin, suspended, current_workspace_id, email_verified, totp_enabled, avatar_url,
      referral_code, ui_theme, ui_language FROM users WHERE id = ?`, s.user_id);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  if (user.suspended && !s.impersonator_id) return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
  if (getBool('maintenance_mode') && !user.is_admin && !s.impersonator_id) return res.status(503).json({ error: 'We are performing maintenance. Please try again shortly.' });
  if (Date.now() - new Date(`${s.last_seen_at}Z`).getTime() > 5 * 60_000) run(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`, sidHash);
  req.user = user;
  req.sessionHash = sidHash;
  req.impersonatedBy = s.impersonator_id || null;
  req.workspace = loadWorkspace(user);
  req.role = req.workspace?.role;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => (roles.includes(req.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' }));
}

/** Platform admins. In production, admins must have 2FA enabled (can be relaxed in Settings, not recommended). */
export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin || req.viaApiKey || req.impersonatedBy) return res.status(403).json({ error: 'Admin only' });
  if (config.isProd && getBool('require_admin_2fa') && !req.user.totp_enabled) {
    return res.status(403).json({ error: 'Admins must enable two-factor authentication first (Security & privacy).', code: 'admin_2fa_required' });
  }
  next();
}

// ---- Password policy ----
const COMMON = new Set(('123456 123456789 12345678 password qwerty123 qwerty 1234567890 1234567 111111 123123 abc123 password1 '
  + 'iloveyou 000000 admin123 letmein welcome welcome1 monkey dragon football baseball sunshine princess master '
  + 'passw0rd p@ssw0rd p@ssword superman trustno1 qwertyuiop 1q2w3e4r 1qaz2wsx zaq12wsx changeme secret123 '
  + 'password123 password1234 administrator bangladesh 12345678910 asdfghjkl').split(' '));
export function passwordProblem(pw, email = '') {
  const p = String(pw || '');
  if (p.length < 10) return 'Password must be at least 10 characters';
  if (p.length > 200) return 'Password is too long';
  if (COMMON.has(p.toLowerCase())) return 'This password is too common — choose another';
  if (email && p.toLowerCase().includes(String(email).split('@')[0].toLowerCase()) && String(email).split('@')[0].length > 3) return 'Password must not contain your email name';
  if (new Set(p).size < 5) return 'Password is too simple';
  return null;
}

// ---- Brute-force protection (per account; per-IP limits are applied by the rate limiter) ----
export function isLocked(user) {
  return user.locked_until && new Date(`${user.locked_until}Z`) > new Date();
}
export function registerFailedLogin(user) {
  const n = (user.failed_logins || 0) + 1;
  const lockMin = n >= 5 ? Math.min(24 * 60, 15 * 2 ** (n - 5)) : 0;
  run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', n, lockMin ? sqlTime(Date.now() + lockMin * 60_000) : null, user.id);
  return lockMin;
}
export const clearFailedLogins = (userId) => run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', userId);
