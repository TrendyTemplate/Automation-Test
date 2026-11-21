import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from './config.js';
import { one, run } from './db.js';
import { getBool } from './settings.js';

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function issueToken(res, user, extra = {}) {
  const token = jwt.sign({ uid: user.id, ...extra }, config.jwtSecret, { expiresIn: extra.imp ? '2h' : '30d' });
  res.cookie('mp_session', token, {
    httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: (extra.imp ? 2 : 30 * 24) * 3600 * 1000,
  });
}

function loadWorkspace(user) {
  const pick = (wsId) => one(`SELECT w.*, wm.role FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = ? AND w.id = ?`, user.id, wsId);
  let ws = user.current_workspace_id ? pick(user.current_workspace_id) : null;
  ws ||= one(`SELECT w.*, wm.role FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = ? ORDER BY w.id LIMIT 1`, user.id);
  return ws;
}

export function requireAuth(req, res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  // Public API keys: "mp_live_..." authenticate as the workspace (owner permissions, no admin access).
  if (bearer.startsWith('mp_live_')) {
    const key = one('SELECT * FROM api_keys WHERE key_hash = ?', sha256(bearer));
    if (!key) return res.status(401).json({ error: 'Invalid API key' });
    run(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`, key.id);
    const ws = one('SELECT * FROM workspaces WHERE id = ?', key.workspace_id);
    req.user = one('SELECT id, email, name, 0 AS is_admin FROM users WHERE id = ?', ws.owner_id);
    req.workspace = { ...ws, role: 'admin' };
    req.role = 'admin';
    req.viaApiKey = true;
    return next();
  }
  const token = req.cookies?.mp_session || bearer;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret); } catch { return res.status(401).json({ error: 'Session expired' }); }
  if (payload.pending2fa) return res.status(401).json({ error: 'Two-factor code required' });
  const user = one('SELECT id, email, name, is_admin, suspended, current_workspace_id, email_verified, totp_enabled, avatar_url, referral_code FROM users WHERE id = ?', payload.uid);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  if (user.suspended) return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
  if (getBool('maintenance_mode') && !user.is_admin && !payload.imp) return res.status(503).json({ error: 'We are performing maintenance. Please try again shortly.' });
  req.user = user;
  req.impersonatedBy = payload.imp || null;
  req.workspace = loadWorkspace(user);
  req.role = req.workspace?.role;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => (roles.includes(req.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' }));
}

export function requireAdmin(req, res, next) {
  return req.user?.is_admin && !req.viaApiKey ? next() : res.status(403).json({ error: 'Admin only' });
}
