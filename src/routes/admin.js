// Platform owner's admin API. Every mutating action is written to the audit log.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import os from 'node:os';
import { all, one, run, tx, audit, db } from '../db.js';
import { config } from '../config.js';
import { allPlans, getPlan, effectivePlan } from '../plans.js';
import { listSettings, setSetting, SETTINGS, getNum } from '../settings.js';
import { issueToken } from '../auth.js';
import { workerState, syncMailbox } from '../services/worker.js';
import { sendSystemEmail } from '../services/notify.js';
import { aiEnabled } from '../services/ai.js';
import { recordPayment, stripe } from './billing.js';
import { randomToken } from '../crypto.js';

const r = Router();
const int = (v) => Number.parseInt(v, 10);
const like = (q) => `%${q}%`;

function mrrOf() {
  const rows = all(`SELECT w.plan, w.billing_interval, p.price_monthly, p.price_yearly FROM workspaces w JOIN plans p ON p.key = w.plan
    WHERE w.subscription_status IN ('active','trialing','past_due') AND w.billing_interval IN ('monthly','yearly','manual') AND w.suspended = 0`);
  return rows.reduce((s, x) => s + (x.billing_interval === 'yearly' ? (x.price_yearly || 0) / 12 : (x.price_monthly || 0)), 0);
}

// ---------------- Overview ----------------
r.get('/overview', (req, res) => {
  const period = new Date().toISOString().slice(0, 7);
  const usage = one(`SELECT SUM(ai_calls) AS ai_calls, SUM(ai_replies) AS ai_replies, SUM(emails_sent) AS emails_sent,
    SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens FROM usage WHERE period = ?`, period);
  const aiCost = ((usage.input_tokens || 0) * getNum('ai_input_price') + (usage.output_tokens || 0) * getNum('ai_output_price')) / 1e6;
  const revenue30 = one(`SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE status='paid' AND created_at > datetime('now','-30 days')`).v;
  const revenueAll = one(`SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE status='paid'`).v;
  const paying = one(`SELECT COUNT(*) AS n FROM workspaces WHERE (plan='lifetime' OR subscription_status IN ('active','trialing','past_due')) AND plan != 'trial'`).n;
  const churned30 = one(`SELECT COUNT(*) AS n FROM workspaces WHERE subscription_status = 'canceled'`).n;
  res.json({
    users: one('SELECT COUNT(*) AS n FROM users').n,
    newUsers7: one(`SELECT COUNT(*) AS n FROM users WHERE created_at > datetime('now','-7 days')`).n,
    workspaces: one('SELECT COUNT(*) AS n FROM workspaces').n,
    trials: one(`SELECT COUNT(*) AS n FROM workspaces WHERE plan='trial' AND trial_ends_at > datetime('now')`).n,
    paying, churned: churned30,
    mailboxes: one('SELECT COUNT(*) AS n FROM mailboxes').n,
    mailboxErrors: one('SELECT COUNT(*) AS n FROM mailboxes WHERE last_error IS NOT NULL AND enabled = 1').n,
    messages24h: one(`SELECT COUNT(*) AS n FROM messages WHERE created_at > datetime('now','-1 day')`).n,
    openTickets: one(`SELECT COUNT(*) AS n FROM tickets WHERE status = 'open'`).n,
    mrr: Math.round(mrrOf() * 100) / 100, arr: Math.round(mrrOf() * 12), revenue30, revenueAll,
    usage, aiCost: Math.round(aiCost * 100) / 100, aiEnabled: aiEnabled(),
    byPlan: all(`SELECT plan, COUNT(*) AS n FROM workspaces GROUP BY plan ORDER BY n DESC`),
    signups: all(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM users WHERE created_at > datetime('now','-30 days') GROUP BY day ORDER BY day`),
    revenue: all(`SELECT substr(created_at,1,10) AS day, SUM(amount) AS v FROM payments WHERE status='paid' AND created_at > datetime('now','-30 days') GROUP BY day ORDER BY day`),
    volume: all(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM messages WHERE created_at > datetime('now','-14 days') GROUP BY day ORDER BY day`),
    recentUsers: all('SELECT id, email, name, created_at FROM users ORDER BY id DESC LIMIT 8'),
    recentPayments: all(`SELECT p.*, w.name AS workspace_name FROM payments p LEFT JOIN workspaces w ON w.id = p.workspace_id ORDER BY p.id DESC LIMIT 8`),
  });
});

// ---------------- Users ----------------
r.get('/users', (req, res) => {
  const where = ['1=1']; const p = [];
  if (req.query.q) { where.push('(u.email LIKE ? OR u.name LIKE ?)'); p.push(like(req.query.q), like(req.query.q)); }
  if (req.query.filter === 'admins') where.push('u.is_admin = 1');
  if (req.query.filter === 'suspended') where.push('u.suspended = 1');
  if (req.query.filter === 'unverified') where.push('u.email_verified = 0');
  if (req.query.filter === '2fa') where.push('u.totp_enabled = 1');
  res.json(all(`SELECT u.id, u.email, u.name, u.is_admin, u.suspended, u.email_verified, u.totp_enabled, u.created_at, u.last_login_at,
      u.google_id IS NOT NULL AS google, u.microsoft_id IS NOT NULL AS microsoft,
      (SELECT COUNT(*) FROM workspace_members wm WHERE wm.user_id = u.id) AS workspaces,
      (SELECT email FROM users r2 WHERE r2.id = u.referred_by) AS referred_by_email
    FROM users u WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT 500`, ...p));
});
r.get('/users/:id', (req, res) => {
  const u = one(`SELECT id, email, name, is_admin, suspended, email_verified, totp_enabled, created_at, last_login_at, last_login_ip,
    google_id IS NOT NULL AS google, microsoft_id IS NOT NULL AS microsoft, referral_code, locale FROM users WHERE id = ?`, int(req.params.id));
  if (!u) return res.status(404).json({ error: 'Not found' });
  u.workspaces = all(`SELECT w.id, w.name, w.plan, w.subscription_status, wm.role FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = ?`, u.id);
  u.tickets = all('SELECT id, subject, status, created_at FROM tickets WHERE user_id = ? ORDER BY id DESC', u.id);
  u.referrals = all('SELECT id, email, created_at FROM users WHERE referred_by = ?', u.id);
  u.audit = all('SELECT * FROM audit_log WHERE target = ? OR actor_id = ? ORDER BY id DESC LIMIT 30', `user:${u.id}`, u.id);
  res.json(u);
});
r.put('/users/:id', (req, res) => {
  const id = int(req.params.id);
  const u = one('SELECT * FROM users WHERE id = ?', id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (id === req.user.id && (req.body.is_admin === false || req.body.suspended)) return res.status(400).json({ error: "You can't demote or suspend yourself" });
  const v = (k) => (req.body[k] === undefined ? u[k] : req.body[k]);
  run('UPDATE users SET name=?, is_admin=?, suspended=?, email_verified=? WHERE id=?', v('name'), v('is_admin') ? 1 : 0, v('suspended') ? 1 : 0, v('email_verified') ? 1 : 0, id);
  if (req.body.email && req.body.email !== u.email) {
    if (one('SELECT id FROM users WHERE email = ?', String(req.body.email).toLowerCase())) return res.status(409).json({ error: 'Email in use' });
    run('UPDATE users SET email = ? WHERE id = ?', String(req.body.email).toLowerCase(), id);
  }
  audit(req, 'user_updated', `user:${id}`, req.body);
  res.json({ ok: true });
});
r.post('/users/:id/reset-password', async (req, res) => {
  const id = int(req.params.id);
  const u = one('SELECT email FROM users WHERE id = ?', id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const temp = randomToken(6);
  run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(temp, 12), id);
  audit(req, 'password_reset_by_admin', `user:${id}`);
  res.json({ tempPassword: temp });
});
r.post('/users/:id/disable-2fa', (req, res) => {
  run('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL WHERE id = ?', int(req.params.id));
  audit(req, '2fa_disabled_by_admin', `user:${req.params.id}`);
  res.json({ ok: true });
});
r.post('/users/:id/impersonate', (req, res) => {
  const u = one('SELECT * FROM users WHERE id = ?', int(req.params.id));
  if (!u) return res.status(404).json({ error: 'Not found' });
  audit(req, 'impersonate', `user:${u.id}`);
  issueToken(res, u, { imp: req.user.id });
  res.json({ ok: true });
});
r.post('/users/:id/email', async (req, res) => {
  const u = one('SELECT email FROM users WHERE id = ?', int(req.params.id));
  if (!u || !req.body.subject || !req.body.body) return res.status(400).json({ error: 'Subject and body required' });
  await sendSystemEmail(u.email, req.body.subject, req.body.body);
  audit(req, 'email_user', `user:${req.params.id}`, req.body.subject);
  res.json({ ok: true });
});
r.delete('/users/:id', (req, res) => {
  const id = int(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "You can't delete yourself" });
  tx(() => {
    run('UPDATE replies SET approved_by = NULL WHERE approved_by = ?', id);
    run('DELETE FROM workspaces WHERE owner_id = ?', id);
    run('DELETE FROM users WHERE id = ?', id);
  });
  audit(req, 'user_deleted', `user:${id}`);
  res.json({ ok: true });
});

// ---------------- Workspaces ----------------
r.get('/workspaces', (req, res) => {
  const where = ['1=1']; const p = [];
  if (req.query.q) { where.push('(w.name LIKE ? OR u.email LIKE ?)'); p.push(like(req.query.q), like(req.query.q)); }
  if (req.query.plan) { where.push('w.plan = ?'); p.push(req.query.plan); }
  if (req.query.status === 'suspended') where.push('w.suspended = 1');
  if (req.query.status === 'trial_expired') where.push(`w.plan = 'trial' AND w.trial_ends_at < datetime('now')`);
  if (req.query.status === 'past_due') where.push(`w.subscription_status = 'past_due'`);
  const rows = all(`SELECT w.*, u.email AS owner_email,
      (SELECT COUNT(*) FROM mailboxes WHERE workspace_id = w.id) AS mailbox_count,
      (SELECT COUNT(*) FROM messages WHERE workspace_id = w.id) AS message_count,
      (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) AS members
    FROM workspaces w JOIN users u ON u.id = w.owner_id WHERE ${where.join(' AND ')} ORDER BY w.id DESC LIMIT 500`, ...p);
  res.json(rows.map((w) => ({ id: w.id, name: w.name, owner_email: w.owner_email, plan: w.plan, effective: effectivePlan(w).key,
    subscription_status: w.subscription_status, billing_interval: w.billing_interval, trial_ends_at: w.trial_ends_at,
    current_period_end: w.current_period_end, suspended: w.suspended, mailbox_count: w.mailbox_count, message_count: w.message_count,
    members: w.members, created_at: w.created_at })));
});
r.get('/workspaces/:id', (req, res) => {
  const w = one('SELECT * FROM workspaces WHERE id = ?', int(req.params.id));
  if (!w) return res.status(404).json({ error: 'Not found' });
  const period = new Date().toISOString().slice(0, 7);
  res.json({
    workspace: { ...w, effective: effectivePlan(w) },
    members: all('SELECT u.id, u.email, u.name, wm.role FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = ?', w.id),
    mailboxes: all('SELECT id, email, provider, auth_type, mode, enabled, last_sync_at, last_error FROM mailboxes WHERE workspace_id = ?', w.id),
    usage: all('SELECT * FROM usage WHERE workspace_id = ? ORDER BY period DESC LIMIT 12', w.id),
    thisMonth: one('SELECT * FROM usage WHERE workspace_id = ? AND period = ?', w.id, period),
    payments: all('SELECT * FROM payments WHERE workspace_id = ? ORDER BY id DESC', w.id),
    activity: all('SELECT * FROM activity WHERE workspace_id = ? ORDER BY id DESC LIMIT 40', w.id),
    stats: one(`SELECT COUNT(*) AS messages, SUM(status='replied') AS replied, COUNT(DISTINCT contact_id) AS contacts FROM messages WHERE workspace_id = ?`, w.id),
  });
});
r.put('/workspaces/:id', (req, res) => {
  const id = int(req.params.id);
  const w = one('SELECT * FROM workspaces WHERE id = ?', id);
  if (!w) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  if (b.plan !== undefined && !getPlan(b.plan)) return res.status(400).json({ error: 'Unknown plan' });
  if (b.limits_override_json) { try { JSON.parse(b.limits_override_json); } catch { return res.status(400).json({ error: 'Limits override must be JSON' }); } }
  const v = (k) => (b[k] === undefined ? w[k] : (b[k] === '' ? null : b[k]));
  run(`UPDATE workspaces SET name=?, plan=?, subscription_status=?, billing_interval=?, trial_ends_at=?, current_period_end=?,
      suspended=?, limits_override_json=?, admin_notes=? WHERE id=?`,
  v('name'), v('plan'), v('subscription_status'), v('billing_interval'), v('trial_ends_at'), v('current_period_end'),
  v('suspended') ? 1 : 0, v('limits_override_json'), v('admin_notes'), id);
  audit(req, 'workspace_updated', `workspace:${id}`, b);
  res.json({ ok: true });
});
// Quick actions
r.post('/workspaces/:id/extend-trial', (req, res) => {
  const id = int(req.params.id);
  const days = int(req.body.days) || 7;
  const w = one('SELECT trial_ends_at FROM workspaces WHERE id = ?', id);
  const base = Math.max(Date.now(), new Date(w?.trial_ends_at || 0).getTime());
  run(`UPDATE workspaces SET plan='trial', trial_ends_at=? WHERE id=?`, new Date(base + days * 86400_000).toISOString(), id);
  audit(req, 'trial_extended', `workspace:${id}`, { days });
  res.json({ ok: true });
});
r.post('/workspaces/:id/grant', (req, res) => {
  const id = int(req.params.id);
  const { plan, days } = req.body;
  if (!getPlan(plan) || plan === 'trial') return res.status(400).json({ error: 'Unknown plan' });
  const end = days ? new Date(Date.now() + Number(days) * 86400_000).toISOString() : null;
  run(`UPDATE workspaces SET plan=?, subscription_status='active', billing_interval=?, current_period_end=?, suspended=0 WHERE id=?`,
    plan, getPlan(plan).priceOnce && !getPlan(plan).priceMonthly ? 'once' : 'manual', end, id);
  audit(req, 'plan_granted', `workspace:${id}`, { plan, days });
  res.json({ ok: true });
});
r.post('/workspaces/:id/reset-usage', (req, res) => {
  run('DELETE FROM usage WHERE workspace_id = ? AND period = ?', int(req.params.id), new Date().toISOString().slice(0, 7));
  audit(req, 'usage_reset', `workspace:${req.params.id}`);
  res.json({ ok: true });
});
r.post('/workspaces/:id/cancel-stripe', async (req, res) => {
  const w = one('SELECT * FROM workspaces WHERE id = ?', int(req.params.id));
  const s = stripe();
  if (!s || !w?.stripe_subscription_id) return res.status(400).json({ error: 'No Stripe subscription' });
  await s.subscriptions.cancel(w.stripe_subscription_id);
  audit(req, 'stripe_subscription_canceled', `workspace:${w.id}`);
  res.json({ ok: true });
});
r.delete('/workspaces/:id', (req, res) => {
  run('DELETE FROM workspaces WHERE id = ?', int(req.params.id));
  audit(req, 'workspace_deleted', `workspace:${req.params.id}`);
  res.json({ ok: true });
});

// ---------------- Payments ----------------
r.get('/payments', (req, res) => {
  const where = ['1=1']; const p = [];
  if (req.query.method) { where.push('p.method = ?'); p.push(req.query.method); }
  if (req.query.status) { where.push('p.status = ?'); p.push(req.query.status); }
  if (req.query.q) { where.push('(w.name LIKE ? OR p.reference LIKE ? OR u.email LIKE ?)'); p.push(like(req.query.q), like(req.query.q), like(req.query.q)); }
  const rows = all(`SELECT p.*, w.name AS workspace_name, u.email AS owner_email FROM payments p
    LEFT JOIN workspaces w ON w.id = p.workspace_id LEFT JOIN users u ON u.id = w.owner_id
    WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT 1000`, ...p);
  const totals = one(`SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount END),0) AS paid, COALESCE(SUM(CASE WHEN status='refunded' THEN amount END),0) AS refunded, COUNT(*) AS n FROM payments`);
  res.json({ rows, totals, byMethod: all(`SELECT method, SUM(amount) AS v, COUNT(*) AS n FROM payments WHERE status='paid' GROUP BY method`) });
});
// Manual payment (bKash, Nagad, bank transfer, PayPal invoice...) + optional plan activation.
r.post('/payments', (req, res) => {
  const b = req.body;
  const amount = Number(b.amount);
  if (!(amount > 0) || !b.method) return res.status(400).json({ error: 'Amount and method are required' });
  const wsId = int(b.workspace_id) || null;
  if (wsId && !one('SELECT id FROM workspaces WHERE id = ?', wsId)) return res.status(404).json({ error: 'Workspace not found' });
  const id = recordPayment({ workspaceId: wsId, amount, currency: b.currency || 'usd', method: b.method, plan: b.plan || null, interval: b.interval || null, reference: b.reference || null, note: b.note || null });
  if (id === null) return res.status(409).json({ error: 'A payment with this reference already exists' });
  if (wsId && b.activate && b.plan) {
    const plan = getPlan(b.plan);
    if (!plan) return res.status(400).json({ error: 'Unknown plan' });
    const once = b.interval === 'once' || (plan.priceOnce && !plan.priceMonthly);
    const days = b.interval === 'yearly' ? 365 : 31;
    run(`UPDATE workspaces SET plan=?, subscription_status='active', billing_interval=?, current_period_end=?, suspended=0 WHERE id=?`,
      plan.key, once ? 'once' : 'manual', once ? null : new Date(Date.now() + days * 86400_000).toISOString(), wsId);
  }
  audit(req, 'payment_recorded', `payment:${id}`, b);
  res.json({ id });
});
r.put('/payments/:id', (req, res) => {
  const p = one('SELECT * FROM payments WHERE id = ?', int(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  const v = (k) => (req.body[k] === undefined ? p[k] : req.body[k]);
  run('UPDATE payments SET status=?, note=?, commission_paid=? WHERE id=?', v('status'), v('note'), v('commission_paid') ? 1 : 0, p.id);
  audit(req, 'payment_updated', `payment:${p.id}`, req.body);
  res.json({ ok: true });
});
r.get('/payments.csv', (req, res) => {
  const rows = all(`SELECT p.id, p.created_at, p.amount, p.currency, p.method, p.status, p.plan, p.interval, p.reference, w.name AS workspace, p.commission, p.note
    FROM payments p LEFT JOIN workspaces w ON w.id = p.workspace_id ORDER BY p.id`);
  const cols = ['id', 'created_at', 'amount', 'currency', 'method', 'status', 'plan', 'interval', 'reference', 'workspace', 'commission', 'note'];
  res.setHeader('content-type', 'text/csv');
  res.setHeader('content-disposition', 'attachment; filename="payments.csv"');
  res.send([cols.join(','), ...rows.map((x) => cols.map((c) => `"${String(x[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n'));
});

// ---------------- Plans & pricing ----------------
r.get('/plans', (req, res) => res.json(allPlans().map((p) => ({ ...p,
  workspaces: one('SELECT COUNT(*) AS n FROM workspaces WHERE plan = ?', p.key).n }))));
r.post('/plans', (req, res) => {
  const key = String(req.body.key || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!key || getPlan(key) || key === 'expired') return res.status(400).json({ error: 'Choose a new unique key (letters, numbers, _)' });
  run(`INSERT INTO plans (key, name, mailboxes, ai_replies, rules, team_members, public, sort) VALUES (?,?,1,100,5,1,0,99)`, key, req.body.name || key);
  audit(req, 'plan_created', `plan:${key}`);
  res.json({ ok: true });
});
r.put('/plans/:key', (req, res) => {
  const p = one('SELECT * FROM plans WHERE key = ?', req.params.key);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  const num = (k) => (b[k] === undefined || b[k] === '' ? (b[k] === '' ? null : p[k]) : Number(b[k]));
  const txt = (k) => (b[k] === undefined ? p[k] : (b[k] || null));
  const features = b.features === undefined ? p.features_json : JSON.stringify(String(b.features).split('\n').map((x) => x.trim()).filter(Boolean));
  run(`UPDATE plans SET name=?, description=?, mailboxes=?, ai_replies=?, rules=?, team_members=?, auto_send=?, features_json=?,
      price_monthly=?, price_yearly=?, price_once=?, stripe_price_monthly=?, stripe_price_yearly=?, stripe_price_once=?, public=?, sort=?, highlight=? WHERE key=?`,
  txt('name') || p.name, txt('description'), num('mailboxes') ?? 0, num('ai_replies') ?? 0, num('rules') ?? 0, num('team_members') ?? 1,
  b.auto_send === undefined ? p.auto_send : (b.auto_send ? 1 : 0), features,
  num('price_monthly'), num('price_yearly'), num('price_once'), txt('stripe_price_monthly'), txt('stripe_price_yearly'), txt('stripe_price_once'),
  b.public === undefined ? p.public : (b.public ? 1 : 0), num('sort') ?? 0, b.highlight === undefined ? p.highlight : (b.highlight ? 1 : 0), p.key);
  audit(req, 'plan_updated', `plan:${p.key}`, b);
  res.json({ ok: true });
});
r.delete('/plans/:key', (req, res) => {
  if (['trial'].includes(req.params.key)) return res.status(400).json({ error: 'The trial plan is required' });
  if (one('SELECT COUNT(*) AS n FROM workspaces WHERE plan = ?', req.params.key).n) return res.status(400).json({ error: 'Plan is in use — hide it instead (uncheck Public)' });
  run('DELETE FROM plans WHERE key = ?', req.params.key);
  audit(req, 'plan_deleted', `plan:${req.params.key}`);
  res.json({ ok: true });
});

// ---------------- Mailboxes (platform-wide monitor) ----------------
r.get('/mailboxes', (req, res) => {
  const where = ['1=1']; const p = [];
  if (req.query.q) { where.push('(mb.email LIKE ? OR w.name LIKE ?)'); p.push(like(req.query.q), like(req.query.q)); }
  if (req.query.errors) where.push('mb.last_error IS NOT NULL');
  res.json(all(`SELECT mb.id, mb.email, mb.provider, mb.auth_type, mb.mode, mb.enabled, mb.last_sync_at, mb.last_error, mb.created_at,
      w.id AS workspace_id, w.name AS workspace_name,
      (SELECT COUNT(*) FROM messages WHERE mailbox_id = mb.id) AS messages
    FROM mailboxes mb JOIN workspaces w ON w.id = mb.workspace_id WHERE ${where.join(' AND ')} ORDER BY mb.last_error IS NULL, mb.id DESC LIMIT 1000`, ...p));
});
r.post('/mailboxes/:id/sync', async (req, res) => res.json(await syncMailbox(int(req.params.id))));
r.put('/mailboxes/:id', (req, res) => {
  run('UPDATE mailboxes SET enabled = ?, mode = COALESCE(?, mode) WHERE id = ?', req.body.enabled ? 1 : 0, req.body.mode || null, int(req.params.id));
  audit(req, 'mailbox_updated', `mailbox:${req.params.id}`, req.body);
  res.json({ ok: true });
});

// ---------------- AI usage & costs ----------------
r.get('/ai-usage', (req, res) => {
  const period = String(req.query.period || new Date().toISOString().slice(0, 7));
  const inP = getNum('ai_input_price'); const outP = getNum('ai_output_price');
  const rows = all(`SELECT u.*, w.name, w.plan, p.ai_replies AS plan_limit FROM usage u JOIN workspaces w ON w.id = u.workspace_id
    LEFT JOIN plans p ON p.key = w.plan WHERE u.period = ? ORDER BY u.input_tokens + u.output_tokens * 5 DESC LIMIT 500`, period)
    .map((x) => ({ ...x, cost: Math.round(((x.input_tokens * inP) + (x.output_tokens * outP)) / 1e4) / 100 }));
  const months = all(`SELECT period, SUM(ai_calls) AS ai_calls, SUM(ai_replies) AS ai_replies, SUM(input_tokens) AS input_tokens,
    SUM(output_tokens) AS output_tokens, SUM(emails_sent) AS emails_sent FROM usage GROUP BY period ORDER BY period DESC LIMIT 12`)
    .map((x) => ({ ...x, cost: Math.round(((x.input_tokens * inP) + (x.output_tokens * outP)) / 1e4) / 100 }));
  res.json({ period, rows, months });
});

// ---------------- Support tickets ----------------
r.get('/tickets', (req, res) => {
  const status = req.query.status || 'open';
  res.json(all(`SELECT t.*, u.email, u.name, (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) AS replies
    FROM tickets t JOIN users u ON u.id = t.user_id WHERE (? = 'all' OR t.status = ?) ORDER BY t.updated_at DESC LIMIT 500`, status, status));
});
r.get('/tickets/:id', (req, res) => {
  const t = one('SELECT t.*, u.email, u.name FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?', int(req.params.id));
  if (!t) return res.status(404).json({ error: 'Not found' });
  t.messages = all('SELECT tm.*, u.email AS author_email FROM ticket_messages tm LEFT JOIN users u ON u.id = tm.author_id WHERE ticket_id = ? ORDER BY tm.id', t.id);
  res.json(t);
});
r.post('/tickets/:id/reply', async (req, res) => {
  const t = one('SELECT t.*, u.email FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?', int(req.params.id));
  if (!t || !req.body.body) return res.status(400).json({ error: 'Message required' });
  run('INSERT INTO ticket_messages (ticket_id, author_id, is_staff, body) VALUES (?,?,1,?)', t.id, req.user.id, String(req.body.body));
  run(`UPDATE tickets SET status=?, updated_at=datetime('now') WHERE id=?`, req.body.close ? 'closed' : 'answered', t.id);
  sendSystemEmail(t.email, `Re: [Ticket #${t.id}] ${t.subject}`, `${req.body.body}\n\n— Support team`).catch(() => {});
  res.json({ ok: true });
});
r.put('/tickets/:id', (req, res) => {
  run(`UPDATE tickets SET status = COALESCE(?, status), priority = COALESCE(?, priority), updated_at = datetime('now') WHERE id = ?`,
    req.body.status || null, req.body.priority || null, int(req.params.id));
  res.json({ ok: true });
});

// ---------------- Announcements ----------------
r.get('/announcements', (req, res) => res.json(all('SELECT * FROM announcements ORDER BY id DESC')));
r.post('/announcements', (req, res) => {
  if (!req.body.message) return res.status(400).json({ error: 'Message required' });
  run('INSERT INTO announcements (message, level, active, starts_at, ends_at) VALUES (?,?,?,?,?)', String(req.body.message),
    ['info', 'warning', 'success'].includes(req.body.level) ? req.body.level : 'info', req.body.active === false ? 0 : 1, req.body.starts_at || null, req.body.ends_at || null);
  audit(req, 'announcement_created', null, req.body.message);
  res.json({ ok: true });
});
r.put('/announcements/:id', (req, res) => {
  run('UPDATE announcements SET active = ? WHERE id = ?', req.body.active ? 1 : 0, int(req.params.id));
  res.json({ ok: true });
});
r.delete('/announcements/:id', (req, res) => { run('DELETE FROM announcements WHERE id = ?', int(req.params.id)); res.json({ ok: true }); });
// Email broadcast to users (e.g. product updates). Sends sequentially to respect SMTP limits.
r.post('/broadcast', async (req, res) => {
  const { subject, body, audience = 'all' } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'Subject and body required' });
  const q = {
    all: 'SELECT email FROM users WHERE suspended = 0',
    paying: `SELECT DISTINCT u.email FROM users u JOIN workspaces w ON w.owner_id = u.id WHERE u.suspended = 0 AND (w.plan = 'lifetime' OR w.subscription_status = 'active') AND w.plan != 'trial'`,
    trial: `SELECT DISTINCT u.email FROM users u JOIN workspaces w ON w.owner_id = u.id WHERE u.suspended = 0 AND w.plan = 'trial'`,
  }[audience];
  if (!q) return res.status(400).json({ error: 'Unknown audience' });
  const list = all(q);
  audit(req, 'broadcast', audience, { subject, recipients: list.length });
  res.json({ queued: list.length });
  for (const u of list) await sendSystemEmail(u.email, subject, body).catch(() => {});
});

// ---------------- Affiliates ----------------
r.get('/referrals', (req, res) => {
  res.json(all(`SELECT u.id, u.email, u.referral_code,
      (SELECT COUNT(*) FROM users x WHERE x.referred_by = u.id) AS signups,
      COALESCE(SUM(p.commission),0) AS earned, COALESCE(SUM(CASE WHEN p.commission_paid = 1 THEN p.commission ELSE 0 END),0) AS paid
    FROM users u LEFT JOIN payments p ON p.referral_user_id = u.id AND p.status = 'paid'
    GROUP BY u.id HAVING signups > 0 OR earned > 0 ORDER BY earned DESC, signups DESC`));
});
r.post('/referrals/:userId/mark-paid', (req, res) => {
  run('UPDATE payments SET commission_paid = 1 WHERE referral_user_id = ? AND status = ?', int(req.params.userId), 'paid');
  audit(req, 'commission_paid', `user:${req.params.userId}`);
  res.json({ ok: true });
});

// ---------------- Logs ----------------
r.get('/audit', (req, res) => {
  const p = []; let where = '1=1';
  if (req.query.q) { where = '(action LIKE ? OR actor_email LIKE ? OR target LIKE ?)'; p.push(like(req.query.q), like(req.query.q), like(req.query.q)); }
  res.json(all(`SELECT * FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT 500`, ...p));
});
r.get('/activity', (req, res) => {
  const p = []; let where = '1=1';
  if (req.query.type) { where = 'a.type = ?'; p.push(req.query.type); }
  res.json(all(`SELECT a.*, w.name AS workspace_name FROM activity a LEFT JOIN workspaces w ON w.id = a.workspace_id WHERE ${where} ORDER BY a.id DESC LIMIT 500`, ...p));
});

// ---------------- Settings ----------------
r.get('/settings', (req, res) => res.json(listSettings()));
r.put('/settings', (req, res) => {
  const keys = SETTINGS.map((s) => s[1]);
  const changed = [];
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!keys.includes(k)) continue;
    const secret = SETTINGS.find((s) => s[1] === k)[5];
    if (secret && v === '') continue; // blank secret field = keep current value
    setSetting(k, v);
    changed.push(k);
  }
  audit(req, 'settings_updated', null, changed);
  res.json({ ok: true, changed });
});
r.post('/settings/clear', (req, res) => {
  setSetting(String(req.body.key), '');
  audit(req, 'setting_cleared', null, req.body.key);
  res.json({ ok: true });
});
r.post('/settings/test-email', async (req, res) => {
  try {
    const result = await sendSystemEmail(req.body.to || req.user.email, 'Test email', 'Your system email settings work. 🎉');
    res.json({ ok: true, logged: Boolean(result?.logged) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------------- System health ----------------
r.get('/health', (req, res) => {
  let dbSize = 0;
  try { dbSize = fs.statSync(config.dbPath).size; } catch { /* in-memory */ }
  res.json({
    version: process.env.npm_package_version || '2.0.0', node: process.version, uptimeSec: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1e6), loadAvg: os.loadavg(), dbSizeMb: Math.round(dbSize / 1e5) / 10,
    worker: workerState, syncIntervalSec: config.syncIntervalSec,
    queue: {
      scheduledReplies: one(`SELECT COUNT(*) AS n FROM replies WHERE status = 'scheduled'`).n,
      pendingApprovals: one(`SELECT COUNT(*) AS n FROM replies WHERE status = 'pending'`).n,
      failedSends24h: one(`SELECT COUNT(*) AS n FROM replies WHERE status = 'failed' AND created_at > datetime('now','-1 day')`).n,
      messageErrors24h: one(`SELECT COUNT(*) AS n FROM messages WHERE status = 'error' AND created_at > datetime('now','-1 day')`).n,
    },
    checks: {
      ai: aiEnabled(), stripe: Boolean(stripe()),
      smtp: Boolean(listSettings().find((s) => s.key === 'smtp_host')?.isSet),
      google: Boolean(listSettings().find((s) => s.key === 'google_client_secret')?.isSet),
      microsoft: Boolean(listSettings().find((s) => s.key === 'microsoft_client_secret')?.isSet),
      https: /^https:/.test(listSettings().find((s) => s.key === 'app_url')?.value || ''),
      productionMode: config.isProd,
    },
  });
});
r.get('/backup', (req, res) => {
  // Consistent online snapshot of the SQLite database.
  const file = `${config.dbPath}.backup-${Date.now()}`;
  if (config.dbPath === ':memory:') return res.status(400).json({ error: 'In-memory database' });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  audit(req, 'backup_downloaded');
  res.download(file, 'mailpilot-backup.db', () => fs.unlink(file, () => {}));
});

export default r;
