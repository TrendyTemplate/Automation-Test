import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
const { ruleMatches, validateRule } = await import('../src/services/rules.js');
const { isAutomatedEmail, withinBusinessHours } = await import('../src/services/safety.js');
const { encrypt, decrypt } = await import('../src/crypto.js');
const { effectivePlan } = await import('../src/plans.js');
const { fallbackTriage } = await import('../src/services/ai.js');

test('encrypt/decrypt roundtrip', () => {
  const c = encrypt('app-password-123');
  assert.notEqual(c, 'app-password-123');
  assert.equal(decrypt(c), 'app-password-123');
});

test('rules: all/any matching and domain field', () => {
  const msg = { from_email: 'ceo@bigclient.com', subject: 'Urgent: invoice', text_body: 'hi', category: 'billing', mailbox_id: 1 };
  assert.ok(ruleMatches(msg, { match: 'all', items: [{ field: 'from_domain', op: 'equals', value: 'bigclient.com' }, { field: 'subject', op: 'contains', value: 'urgent' }] }));
  assert.ok(!ruleMatches(msg, { match: 'all', items: [{ field: 'category', op: 'equals', value: 'support' }, { field: 'subject', op: 'contains', value: 'urgent' }] }));
  assert.ok(ruleMatches(msg, { match: 'any', items: [{ field: 'category', op: 'equals', value: 'support' }, { field: 'subject', op: 'regex', value: '^urgent' }] }));
  assert.equal(validateRule({ name: 'x', conditions: { items: [] }, actions: [{ type: 'webhook', url: 'http://x' }] }), 'webhook action needs an https:// url');
  assert.equal(validateRule({ name: 'x', conditions: { items: [] }, actions: [{ type: 'ignore' }] }), null);
});

test('safety: detects automated senders', () => {
  assert.ok(isAutomatedEmail({ fromEmail: 'no-reply@shop.com', headers: {} }));
  assert.ok(isAutomatedEmail({ fromEmail: 'news@x.com', headers: { 'list-unsubscribe': '<mailto:u@x.com>' } }));
  assert.ok(isAutomatedEmail({ fromEmail: 'bob@x.com', headers: { 'auto-submitted': 'auto-replied' } }));
  assert.ok(!isAutomatedEmail({ fromEmail: 'bob@x.com', headers: { 'auto-submitted': 'no' } }));
  assert.ok(!isAutomatedEmail({ fromEmail: 'customer@gmail.com', headers: {} }));
});

test('safety: business hours', () => {
  const bh = JSON.stringify({ tz: 'UTC', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' });
  assert.ok(withinBusinessHours(bh, new Date('2026-11-23T10:00:00Z'))); // Monday
  assert.ok(!withinBusinessHours(bh, new Date('2026-11-23T18:00:00Z')));
  assert.ok(!withinBusinessHours(bh, new Date('2026-11-22T10:00:00Z'))); // Sunday
  assert.ok(withinBusinessHours(null));
});

test('plans: trial expiry and subscription status', () => {
  assert.equal(effectivePlan({ plan: 'trial', trial_ends_at: new Date(Date.now() + 1e7).toISOString() }).key, 'trial');
  assert.equal(effectivePlan({ plan: 'trial', trial_ends_at: new Date(Date.now() - 1e7).toISOString() }).key, 'expired');
  assert.equal(effectivePlan({ plan: 'pro', subscription_status: 'active' }).key, 'pro');
  assert.equal(effectivePlan({ plan: 'pro', subscription_status: 'canceled' }).key, 'expired');
  assert.equal(effectivePlan({ plan: 'lifetime' }).key, 'lifetime');
  assert.equal(effectivePlan({ plan: 'pro', subscription_status: 'active', billing_interval: 'manual', current_period_end: '2000-01-01' }).key, 'expired');
});

test('fallback triage classifies common emails', () => {
  assert.equal(fallbackTriage({ subject: 'Pricing for 10 seats?', text_body: 'Can I get a quote' }).category, 'sales_inquiry');
  assert.equal(fallbackTriage({ subject: 'App not working', text_body: 'I get an error' }).category, 'support');
  assert.equal(fallbackTriage({ subject: 'URGENT refund', text_body: 'charge' }).priority, 'urgent');
});
