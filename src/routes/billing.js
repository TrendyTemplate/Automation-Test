import { Router } from 'express';
import express from 'express';
import Stripe from 'stripe';
import { one, all, run, logActivity } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { publicPlans, getPlan, allPlans } from '../plans.js';
import { getSetting, getBool, getNum, appUrl } from '../settings.js';
import { notifyAdmins } from '../services/notify.js';

// Pick up Stripe price IDs from env the first time (admins can edit them in Plans afterwards).
for (const [env, key, col] of [
  ['STRIPE_PRICE_STARTER_MONTHLY', 'starter', 'stripe_price_monthly'], ['STRIPE_PRICE_STARTER_YEARLY', 'starter', 'stripe_price_yearly'],
  ['STRIPE_PRICE_PRO_MONTHLY', 'pro', 'stripe_price_monthly'], ['STRIPE_PRICE_PRO_YEARLY', 'pro', 'stripe_price_yearly'],
  ['STRIPE_PRICE_BUSINESS_MONTHLY', 'business', 'stripe_price_monthly'], ['STRIPE_PRICE_BUSINESS_YEARLY', 'business', 'stripe_price_yearly'],
  ['STRIPE_PRICE_LIFETIME', 'lifetime', 'stripe_price_once'],
]) {
  if (process.env[env]) run(`UPDATE plans SET ${col} = ? WHERE key = ? AND (${col} IS NULL OR ${col} = '')`, process.env[env], key);
}

let stripeClient = null; let stripeKey = '';
export function stripe() {
  const k = getSetting('stripe_secret_key');
  if (!k) return null;
  if (k !== stripeKey) { stripeClient = new Stripe(k); stripeKey = k; }
  return stripeClient;
}

const r = Router();

r.get('/plans', (req, res) => res.json({
  plans: publicPlans(), trialDays: getNum('trial_days'), stripeEnabled: Boolean(stripe()),
  manualInstructions: getSetting('manual_payment_instructions'),
}));

r.post('/checkout', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  const s = stripe();
  if (!s) return res.status(503).json({ error: 'Online payments are not configured yet' });
  const { plan: planKey, interval = 'monthly' } = req.body;
  const plan = getPlan(planKey);
  if (!plan || !plan.public || planKey === 'trial') return res.status(400).json({ error: 'Unknown plan' });
  const isOnce = Boolean(plan.priceOnce) && !plan.priceMonthly;
  const priceId = isOnce ? plan.stripe.once : plan.stripe[interval];
  if (!priceId) return res.status(400).json({ error: 'This plan is not available for online payment yet' });

  const ws = req.workspace;
  let customerId = ws.stripe_customer_id;
  if (!customerId) {
    const customer = await s.customers.create({ email: req.user.email, name: ws.name, metadata: { workspace_id: String(ws.id) } });
    customerId = customer.id;
    run('UPDATE workspaces SET stripe_customer_id = ? WHERE id = ?', customerId, ws.id);
  }
  const meta = { workspace_id: String(ws.id), plan: plan.key, interval: isOnce ? 'once' : interval };
  const session = await s.checkout.sessions.create({
    mode: isOnce ? 'payment' : 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl()}/app#billing?success=1`,
    cancel_url: `${appUrl()}/app#billing?canceled=1`,
    allow_promotion_codes: true,
    automatic_tax: { enabled: getBool('stripe_automatic_tax') },
    client_reference_id: String(ws.id),
    metadata: meta,
    ...(isOnce ? {} : { subscription_data: { metadata: meta } }),
  });
  res.json({ url: session.url });
});

r.post('/portal', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  const s = stripe();
  if (!s || !req.workspace.stripe_customer_id) return res.status(400).json({ error: 'No billing account yet' });
  const p = await s.billingPortal.sessions.create({ customer: req.workspace.stripe_customer_id, return_url: `${appUrl()}/app#billing` });
  res.json({ url: p.url });
});

r.get('/payments', requireAuth, (req, res) => {
  res.json(all(`SELECT id, amount, currency, method, plan, interval, status, created_at FROM payments WHERE workspace_id = ? ORDER BY id DESC LIMIT 100`, req.workspace.id));
});

function planFromPrice(priceId) {
  for (const p of allPlans()) {
    if (p.stripe.monthly === priceId) return { plan: p.key, interval: 'monthly' };
    if (p.stripe.yearly === priceId) return { plan: p.key, interval: 'yearly' };
    if (p.stripe.once === priceId) return { plan: p.key, interval: 'once' };
  }
  return null;
}

/** Record revenue + affiliate commission. Exported so admins can record manual (bKash/bank) payments the same way. */
export function recordPayment({ workspaceId, amount, currency = 'usd', method, plan, interval, reference, note }) {
  if (reference && one('SELECT id FROM payments WHERE reference = ?', reference)) return null; // idempotent (webhook retries)
  const ws = workspaceId ? one('SELECT owner_id FROM workspaces WHERE id = ?', workspaceId) : null;
  const owner = ws ? one('SELECT referred_by FROM users WHERE id = ?', ws.owner_id) : null;
  const commission = owner?.referred_by ? Math.round(amount * getNum('referral_commission_pct')) / 100 : 0;
  const res = run(`INSERT INTO payments (workspace_id, amount, currency, method, plan, interval, reference, note, referral_user_id, commission)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, workspaceId, amount, currency, method, plan, interval, reference, note, owner?.referred_by || null, commission);
  return Number(res.lastInsertRowid);
}

function applySubscription(sub) {
  const wsId = Number(sub.metadata?.workspace_id) || one('SELECT id FROM workspaces WHERE stripe_customer_id = ?', sub.customer)?.id;
  if (!wsId) return;
  const ws = one('SELECT plan FROM workspaces WHERE id = ?', wsId);
  if (ws?.plan === 'lifetime') return;
  const item = sub.items?.data?.[0];
  const mapped = planFromPrice(item?.price?.id) || { plan: sub.metadata?.plan, interval: sub.metadata?.interval };
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  run(`UPDATE workspaces SET plan=?, subscription_status=?, billing_interval=?, stripe_subscription_id=?, current_period_end=? WHERE id=?`,
    mapped.plan || 'starter', sub.status, mapped.interval, sub.id, periodEnd ? new Date(periodEnd * 1000).toISOString() : null, wsId);
  logActivity(wsId, 'subscription_updated', { status: sub.status, plan: mapped.plan });
}

export const webhookRouter = Router();
webhookRouter.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const s = stripe();
  if (!s) return res.status(503).end();
  let event;
  try {
    event = s.webhooks.constructEvent(req.body, req.headers['stripe-signature'], getSetting('stripe_webhook_secret'));
  } catch (e) {
    return res.status(400).send(`Webhook signature error: ${e.message}`);
  }
  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      const wsId = Number(obj.metadata?.workspace_id || obj.client_reference_id);
      if (obj.mode === 'payment' && obj.payment_status === 'paid') {
        run(`UPDATE workspaces SET plan=?, subscription_status='active', billing_interval='once', current_period_end=NULL WHERE id=?`, obj.metadata?.plan || 'lifetime', wsId);
        recordPayment({ workspaceId: wsId, amount: (obj.amount_total || 0) / 100, currency: obj.currency, method: 'stripe', plan: obj.metadata?.plan, interval: 'once', reference: obj.payment_intent || obj.id });
        logActivity(wsId, 'lifetime_purchased', { session: obj.id });
        notifyAdmins('New lifetime purchase', `Workspace #${wsId} paid ${(obj.amount_total || 0) / 100} ${obj.currency}`).catch(() => {});
      } else if (obj.mode === 'subscription' && obj.subscription) {
        applySubscription(await s.subscriptions.retrieve(obj.subscription));
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      applySubscription(obj);
      break;
    case 'invoice.paid': {
      if (!obj.amount_paid) break;
      const ws = one('SELECT id, plan, billing_interval FROM workspaces WHERE stripe_customer_id = ?', obj.customer);
      recordPayment({ workspaceId: ws?.id || null, amount: obj.amount_paid / 100, currency: obj.currency, method: 'stripe', plan: ws?.plan, interval: ws?.billing_interval, reference: obj.id });
      notifyAdmins('Payment received', `${obj.amount_paid / 100} ${obj.currency} from ${obj.customer_email || obj.customer}`).catch(() => {});
      break;
    }
    case 'charge.refunded': {
      run(`UPDATE payments SET status='refunded' WHERE reference IN (?, ?)`, obj.payment_intent, obj.invoice);
      break;
    }
    case 'invoice.payment_failed': {
      const ws = one('SELECT id FROM workspaces WHERE stripe_customer_id = ?', obj.customer);
      if (ws) logActivity(ws.id, 'payment_failed', { invoice: obj.id });
      break;
    }
    default: break;
  }
  res.json({ received: true });
});

export default r;
