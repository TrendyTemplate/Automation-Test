import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { one } from './db.js';

export function issueToken(res, user) {
  const token = jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: '30d' });
  res.cookie('mp_session', token, {
    httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 30 * 24 * 3600 * 1000,
  });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.mp_session || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const { uid } = jwt.verify(token, config.jwtSecret);
    const user = one('SELECT id, email, name, is_admin FROM users WHERE id = ?', uid);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    const membership = one(
      `SELECT w.*, wm.role FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
        WHERE wm.user_id = ? ORDER BY w.id LIMIT 1`, uid);
    req.user = user;
    req.workspace = membership;
    req.role = membership?.role;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => (roles.includes(req.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' }));
}

export function requireAdmin(req, res, next) {
  return req.user?.is_admin ? next() : res.status(403).json({ error: 'Admin only' });
}
