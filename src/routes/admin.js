import { Router } from 'express';
import { all, one, run } from '../db.js';
import { PLANS } from '../plans.js';

const r = Router();

r.get('/overview', (req, res) => {
  const period = new Date().toISOString().slice(0, 7);
  res.json({
    users: one('SELECT COUNT(*) AS n FROM users').n,
    workspaces: one('SELECT COUNT(*) AS n FROM workspaces').n,
    mailboxes: one('SELECT COUNT(*) AS n FROM mailboxes').n,
    byPlan: all(`SELECT plan, subscription_status, COUNT(*) AS n FROM workspaces GROUP BY plan, subscription_status`),
    usage: one(`SELECT SUM(ai_calls) AS ai_calls, SUM(ai_replies) AS ai_replies, SUM(emails_sent) AS emails_sent,
      SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens FROM usage WHERE period = ?`, period),
    // Rough monthly recurring revenue from active subscriptions using display prices.
    mrr: all(`SELECT plan, billing_interval, COUNT(*) AS n FROM workspaces WHERE subscription_status='active' AND plan NOT IN ('lifetime','trial') GROUP BY plan, billing_interval`)
      .reduce((sum, x) => sum + x.n * (x.billing_interval === 'yearly' ? (PLANS[x.plan]?.priceYearly || 0) / 12 : (PLANS[x.plan]?.priceMonthly || 0)), 0),
  });
});

r.get('/workspaces', (req, res) => {
  res.json(all(`SELECT w.id, w.name, w.plan, w.subscription_status, w.billing_interval, w.trial_ends_at, w.current_period_end, w.created_at,
      u.email AS owner_email,
      (SELECT COUNT(*) FROM mailboxes WHERE workspace_id = w.id) AS mailboxes,
      (SELECT COUNT(*) FROM messages WHERE workspace_id = w.id) AS messages
    FROM workspaces w JOIN users u ON u.id = w.owner_id ORDER BY w.id DESC LIMIT 500`));
});

// Manually grant a plan (e.g. a customer paid by bank transfer / bKash / PayPal invoice).
r.post('/workspaces/:id/plan', (req, res) => {
  const { plan, days } = req.body;
  if (!PLANS[plan] || plan === 'expired') return res.status(400).json({ error: 'Unknown plan' });
  const end = days ? new Date(Date.now() + Number(days) * 86400_000).toISOString() : null;
  if (plan === 'trial') run(`UPDATE workspaces SET plan='trial', trial_ends_at=? WHERE id=?`, end, Number(req.params.id));
  else run(`UPDATE workspaces SET plan=?, subscription_status='active', billing_interval=?, current_period_end=? WHERE id=?`,
    plan, plan === 'lifetime' ? 'once' : 'manual', end, Number(req.params.id));
  res.json({ ok: true });
});

export default r;
