import { Router } from 'express';
import express from 'express';
import Stripe from 'stripe';
import { config } from '../config.js';
import { one, run, logActivity } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { publicPlans } from '../plans.js';

const stripe = config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null;
const r = Router();

r.get('/plans', (req, res) => res.json({ plans: publicPlans(), trialDays: config.trialDays, stripeEnabled: Boolean(stripe) }));

// Create a Stripe Checkout session. plan: starter|pro|business|lifetime, interval: monthly|yearly
r.post('/checkout', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments are not configured yet (set STRIPE_SECRET_KEY)' });
  const { plan, interval = 'monthly' } = req.body;
  const isLifetime = plan === 'lifetime';
  const priceId = isLifetime ? config.stripe.prices.lifetime : config.stripe.prices[`${plan}_${interval}`];
  if (!priceId) return res.status(400).json({ error: 'Unknown plan or price not configured' });

  const ws = req.workspace;
  let customerId = ws.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: req.user.email, name: ws.name, metadata: { workspace_id: String(ws.id) } });
    customerId = customer.id;
    run('UPDATE workspaces SET stripe_customer_id = ? WHERE id = ?', customerId, ws.id);
  }
  const session = await stripe.checkout.sessions.create({
    mode: isLifetime ? 'payment' : 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${config.appUrl}/app#billing?success=1`,
    cancel_url: `${config.appUrl}/app#billing?canceled=1`,
    allow_promotion_codes: true,
    automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === 'true' },
    client_reference_id: String(ws.id),
    metadata: { workspace_id: String(ws.id), plan, interval: isLifetime ? 'once' : interval },
    ...(isLifetime ? {} : { subscription_data: { metadata: { workspace_id: String(ws.id), plan, interval } } }),
  });
  res.json({ url: session.url });
});

// Customer portal: update card, switch plan, cancel, download invoices.
r.post('/portal', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  if (!stripe || !req.workspace.stripe_customer_id) return res.status(400).json({ error: 'No billing account yet' });
  const s = await stripe.billingPortal.sessions.create({ customer: req.workspace.stripe_customer_id, return_url: `${config.appUrl}/app#billing` });
  res.json({ url: s.url });
});

function planFromPrice(priceId) {
  const entry = Object.entries(config.stripe.prices).find(([, v]) => v && v === priceId);
  if (!entry) return null;
  const [plan, interval] = entry[0].split('_');
  return { plan, interval: interval || 'once' };
}

function applySubscription(sub) {
  const wsId = Number(sub.metadata?.workspace_id) || one('SELECT id FROM workspaces WHERE stripe_customer_id = ?', sub.customer)?.id;
  if (!wsId) return;
  const ws = one('SELECT plan FROM workspaces WHERE id = ?', wsId);
  if (ws?.plan === 'lifetime') return; // lifetime owners keep lifetime even if an old sub lapses
  const item = sub.items?.data?.[0];
  const mapped = planFromPrice(item?.price?.id) || { plan: sub.metadata?.plan, interval: sub.metadata?.interval };
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  run(`UPDATE workspaces SET plan=?, subscription_status=?, billing_interval=?, stripe_subscription_id=?, current_period_end=? WHERE id=?`,
    mapped.plan || 'starter', sub.status, mapped.interval, sub.id, periodEnd ? new Date(periodEnd * 1000).toISOString() : null, wsId);
  logActivity(wsId, 'subscription_updated', { status: sub.status, plan: mapped.plan });
}

// Stripe webhook needs the raw body for signature verification, so it's mounted before express.json().
export const webhookRouter = Router();
webhookRouter.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripe.webhookSecret);
  } catch (e) {
    return res.status(400).send(`Webhook signature error: ${e.message}`);
  }
  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      const wsId = Number(obj.metadata?.workspace_id || obj.client_reference_id);
      if (obj.mode === 'payment' && obj.metadata?.plan === 'lifetime' && obj.payment_status === 'paid') {
        run(`UPDATE workspaces SET plan='lifetime', subscription_status='active', billing_interval='once', current_period_end=NULL WHERE id=?`, wsId);
        logActivity(wsId, 'lifetime_purchased', { session: obj.id });
      } else if (obj.mode === 'subscription' && obj.subscription) {
        applySubscription(await stripe.subscriptions.retrieve(obj.subscription));
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      applySubscription(obj);
      break;
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
