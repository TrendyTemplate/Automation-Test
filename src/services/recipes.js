// Automation recipes: proven, one-click playbooks. Each builds a normal rule (editable afterwards).
// params: values the customer must supply when installing (validated by validateRule afterwards).
const cat = (value) => ({ field: 'category', op: 'equals', value });

export const RECIPES = [
  {
    key: 'lead_fast_lane', group: 'Sales', icon: 'zap', title: 'Lead fast-lane',
    description: 'Sales inquiries get an instant, knowledge-based answer drafted and a call link offered — speed wins deals.',
    build: () => ({ conditions: { match: 'all', items: [cat('sales_inquiry')] },
      actions: [{ type: 'ai_reply', mode: 'draft', instructions: 'Answer the question from the knowledge base, then offer a short call using the booking link if one exists.' }] }),
  },
  {
    key: 'hot_lead_ping', group: 'Sales', icon: 'bell', title: 'Hot-lead ping to Slack / CRM',
    description: 'Every sales inquiry is posted to your Slack, Zapier, Make or CRM webhook with the extracted phone, company and budget.',
    params: [{ name: 'url', label: 'Webhook URL (https://…)', type: 'url' }],
    build: (p) => ({ stop_processing: false, conditions: { match: 'all', items: [cat('sales_inquiry')] }, actions: [{ type: 'webhook', url: p.url }] }),
  },
  {
    key: 'angry_customer', group: 'Support', icon: 'alert', title: 'Angry-customer rescue',
    description: 'Negative or complaint emails are assigned to you and get a careful apology draft that never promises refunds.',
    build: (p, ctx) => ({ conditions: { match: 'any', items: [cat('complaint'), { field: 'sentiment', op: 'equals', value: 'negative' }] },
      actions: [{ type: 'assign', user_id: ctx.userId }, { type: 'ai_reply', mode: 'draft', instructions: 'Apologise sincerely, acknowledge the specific problem, promise a personal follow-up within 24 hours. Do not promise refunds or compensation.' }] }),
  },
  {
    key: 'support_autopilot', group: 'Support', icon: 'lifebuoy', title: 'Support FAQ autopilot',
    description: 'Routine support questions are answered automatically — safety checks still hold back anything uncertain.',
    build: () => ({ conditions: { match: 'all', items: [cat('support')] }, actions: [{ type: 'ai_reply', mode: 'auto' }] }),
  },
  {
    key: 'billing_to_finance', group: 'Operations', icon: 'card', title: 'Invoices to accounting',
    description: 'Billing and invoice emails are forwarded to your accountant or finance inbox automatically.',
    params: [{ name: 'to', label: 'Forward to (email)', type: 'email' }],
    build: (p) => ({ stop_processing: false, conditions: { match: 'all', items: [cat('billing')] }, actions: [{ type: 'forward', to: p.to }] }),
  },
  {
    key: 'meeting_booker', group: 'Operations', icon: 'calendar', title: 'Meeting booker',
    description: 'Meeting requests get a friendly reply with your booking link so nobody plays calendar ping-pong.',
    build: () => ({ conditions: { match: 'all', items: [cat('meeting_request')] }, actions: [{ type: 'ai_reply', mode: 'draft', instructions: 'Offer the booking link and two sentences of context. Keep it short.' }] }),
  },
  {
    key: 'hiring_ack', group: 'Operations', icon: 'users', title: 'Job-application acknowledgement',
    description: 'Applicants get a polite “we received it, we reply within 5 business days” — automatically.',
    build: () => ({ conditions: { match: 'all', items: [cat('job_application')] }, actions: [{ type: 'ai_reply', mode: 'auto', instructions: 'Thank them, confirm we received the application and that we reply within 5 business days. No other promises.' }] }),
  },
  {
    key: 'partner_snooze', group: 'Focus', icon: 'clock', title: 'Cold pitches wait 3 days',
    description: 'Partnership and sponsorship pitches are snoozed for 72 hours so they don’t break your focus.',
    build: () => ({ conditions: { match: 'all', items: [cat('partnership')] }, actions: [{ type: 'snooze', hours: 72 }] }),
  },
  {
    key: 'newsletter_silence', group: 'Focus', icon: 'archive', title: 'Newsletter silence',
    description: 'Newsletters and notifications are marked read and archived — no AI cost, no noise.',
    build: () => ({ conditions: { match: 'any', items: [cat('newsletter'), cat('notification')] }, actions: [{ type: 'mark_read' }, { type: 'ignore' }] }),
  },
  {
    key: 'urgent_alert', group: 'Focus', icon: 'bell', title: 'Urgent → instant alert',
    description: 'Anything the AI marks urgent is pushed to your Slack/Teams/Discord webhook within seconds.',
    params: [{ name: 'url', label: 'Webhook URL (https://…)', type: 'url' }],
    build: (p) => ({ stop_processing: false, conditions: { match: 'all', items: [{ field: 'priority', op: 'equals', value: 'urgent' }] }, actions: [{ type: 'webhook', url: p.url }] }),
  },
];

export function publicRecipes(installed = new Set()) {
  return RECIPES.map(({ build, ...r }) => ({ ...r, params: r.params || [], installed: installed.has(r.key) }));
}

export function buildRecipe(key, params = {}, ctx = {}) {
  const r = RECIPES.find((x) => x.key === key);
  if (!r) return null;
  const p = Object.fromEntries((r.params || []).map((x) => [x.name, String(params[x.name] ?? '').trim()]));
  const built = r.build(p, ctx);
  return { name: r.title, enabled: true, stop_processing: built.stop_processing !== false, conditions: built.conditions, actions: built.actions, recipe_key: r.key };
}
