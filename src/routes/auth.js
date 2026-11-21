import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { one, run, tx } from '../db.js';
import { config } from '../config.js';
import { issueToken, requireAuth } from '../auth.js';
import { effectivePlan } from '../plans.js';

const r = Router();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

r.post('/signup', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password, name, company } = req.body;
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (one('SELECT id FROM users WHERE email = ?', email)) return res.status(409).json({ error: 'Email already registered' });
  const hash = await bcrypt.hash(password, 12);
  const trialEnds = new Date(Date.now() + config.trialDays * 86400_000).toISOString();
  const user = tx(() => {
    const u = run('INSERT INTO users (email, name, password_hash, is_admin) VALUES (?,?,?,?)',
      email, name || '', hash, config.adminEmails.includes(email) ? 1 : 0);
    const uid = Number(u.lastInsertRowid);
    const w = run('INSERT INTO workspaces (name, owner_id, business_name, trial_ends_at) VALUES (?,?,?,?)',
      company || `${name || email}'s workspace`, uid, company || '', trialEnds);
    run('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)', Number(w.lastInsertRowid), uid, 'owner');
    return { id: uid };
  });
  issueToken(res, user);
  res.json({ ok: true });
});

r.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = one('SELECT * FROM users WHERE email = ?', email);
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  issueToken(res, user);
  res.json({ ok: true });
});

r.post('/logout', (req, res) => {
  res.clearCookie('mp_session');
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => {
  const ws = req.workspace;
  res.json({
    user: req.user,
    role: req.role,
    workspace: ws && {
      id: ws.id, name: ws.name, plan: ws.plan, subscription_status: ws.subscription_status,
      trial_ends_at: ws.trial_ends_at, current_period_end: ws.current_period_end, billing_interval: ws.billing_interval,
    },
    effectivePlan: effectivePlan(ws),
  });
});

r.post('/change-password', requireAuth, async (req, res) => {
  const u = one('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!(await bcrypt.compare(String(req.body.current || ''), u.password_hash))) return res.status(400).json({ error: 'Current password is wrong' });
  if (String(req.body.next || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(req.body.next, 12), u.id);
  res.json({ ok: true });
});

export default r;
