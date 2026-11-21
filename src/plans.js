import { all, one } from './db.js';

function rowToPlan(r) {
  return {
    key: r.key, name: r.name, description: r.description,
    mailboxes: r.mailboxes, aiRepliesPerMonth: r.ai_replies, rules: r.rules, teamMembers: r.team_members,
    autoSend: Boolean(r.auto_send), features: r.features_json ? JSON.parse(r.features_json) : [],
    priceMonthly: r.price_monthly, priceYearly: r.price_yearly, priceOnce: r.price_once,
    stripe: { monthly: r.stripe_price_monthly, yearly: r.stripe_price_yearly, once: r.stripe_price_once },
    public: Boolean(r.public), highlight: Boolean(r.highlight), sort: r.sort,
  };
}

export const getPlan = (key) => { const r = one('SELECT * FROM plans WHERE key = ?', key); return r ? rowToPlan(r) : null; };
export const allPlans = () => all('SELECT * FROM plans ORDER BY sort, key').map(rowToPlan);

const EXPIRED = { key: 'expired', name: 'Expired', mailboxes: 0, aiRepliesPerMonth: 0, rules: 0, teamMembers: 1, autoSend: false };

/** The plan a workspace is entitled to right now, including admin overrides. */
export function effectivePlan(ws) {
  if (!ws || ws.suspended) return { ...EXPIRED, suspended: Boolean(ws?.suspended) };
  let key = ws.plan;
  if (key === 'trial') {
    if (ws.trial_ends_at && new Date(ws.trial_ends_at) < new Date()) return EXPIRED;
  } else if (key !== 'lifetime') {
    const active = ['active', 'trialing', 'past_due'].includes(ws.subscription_status);
    const manualExpired = ws.billing_interval === 'manual' && ws.current_period_end && new Date(ws.current_period_end) < new Date();
    if (!active || manualExpired) return EXPIRED;
  }
  const plan = getPlan(key);
  if (!plan) return EXPIRED;
  let override = {};
  try { override = ws.limits_override_json ? JSON.parse(ws.limits_override_json) : {}; } catch { /* ignore */ }
  return { ...plan, ...override, key };
}

export function publicPlans() {
  return allPlans().filter((p) => p.public && p.key !== 'trial').map(({ stripe, ...p }) => p);
}

// Legacy export used by older code paths.
export const PLANS = new Proxy({}, { get: (_, k) => getPlan(String(k)) });
