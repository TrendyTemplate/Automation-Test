// Single source of truth for pricing & limits. Prices are display prices (USD);
// actual charging happens through the Stripe Price IDs configured in .env.
export const PLANS = {
  trial: {
    name: 'Free Trial', mailboxes: 2, aiRepliesPerMonth: 100, rules: 5, teamMembers: 1,
    autoSend: true, priceMonthly: 0, priceYearly: 0,
  },
  starter: {
    name: 'Starter', mailboxes: 3, aiRepliesPerMonth: 1000, rules: 20, teamMembers: 1,
    autoSend: true, priceMonthly: 19, priceYearly: 190,
  },
  pro: {
    name: 'Pro', mailboxes: 10, aiRepliesPerMonth: 5000, rules: 100, teamMembers: 5,
    autoSend: true, priceMonthly: 49, priceYearly: 490,
  },
  business: {
    name: 'Business', mailboxes: 50, aiRepliesPerMonth: 25000, rules: 500, teamMembers: 25,
    autoSend: true, priceMonthly: 149, priceYearly: 1490,
  },
  lifetime: {
    // One-time purchase. AI usage is capped monthly so a single payment can't create unbounded API cost.
    name: 'Lifetime', mailboxes: 5, aiRepliesPerMonth: 1500, rules: 50, teamMembers: 2,
    autoSend: true, priceOnce: 299,
  },
  expired: {
    name: 'Expired', mailboxes: 0, aiRepliesPerMonth: 0, rules: 0, teamMembers: 1,
    autoSend: false, priceMonthly: 0, priceYearly: 0,
  },
};

export function effectivePlan(workspace) {
  if (!workspace) return { key: 'expired', ...PLANS.expired };
  const key = workspace.plan;
  if (key === 'lifetime') return { key, ...PLANS.lifetime };
  if (key === 'trial') {
    const ended = workspace.trial_ends_at && new Date(workspace.trial_ends_at) < new Date();
    return ended ? { key: 'expired', ...PLANS.expired } : { key, ...PLANS.trial };
  }
  const active = ['active', 'trialing'].includes(workspace.subscription_status);
  const manualExpired = workspace.billing_interval === 'manual' && workspace.current_period_end &&
    new Date(workspace.current_period_end) < new Date();
  if (!active || manualExpired || !PLANS[key]) return { key: 'expired', ...PLANS.expired };
  return { key, ...PLANS[key] };
}

export function publicPlans() {
  return Object.entries(PLANS)
    .filter(([k]) => !['trial', 'expired'].includes(k))
    .map(([key, p]) => ({ key, ...p }));
}
