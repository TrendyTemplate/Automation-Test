import { makeStore, fakeAi, poFixture, startServer } from './helpers.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { drainJobs, enqueue, registerJob } from '../src/core/jobs.js';
import { setMailTransport } from '../src/core/notify.js';
import { http } from '../src/connectors/http.js';
import { get, run } from '../src/db.js';
import { rateLimit } from '../src/ratelimit.js';

const srv = await startServer();
after(() => srv.close());

// Capture outgoing email.
const sent = [];
const json = nodemailer.createTransport({ jsonTransport: true });
setMailTransport({ sendMail: async (m) => { const r = await json.sendMail(m); sent.push(JSON.parse(r.message)); return r; } });

const slackPosts = [];
http.safeFetch = async (url, opts) => { slackPosts.push({ url, body: JSON.parse(opts.body) }); return new Response('ok', { status: 200 }); };

const upload = (call, content, type = 'application/pdf') => call('/api/pos', { method: 'POST', body: Buffer.from(content), headers: { 'Content-Type': type, 'X-Filename': 'po.pdf' } });

test('settings validate Slack and email, and are reported back', async () => {
  const s = makeStore();
  const call = srv.client(s.apiKey);
  assert.equal((await call('/api/settings', { method: 'PATCH', body: { slack_webhook_url: 'https://evil.example.com/x' } })).status, 400);
  assert.equal((await call('/api/settings', { method: 'PATCH', body: { notify_email: 'nope' } })).status, 400);
  assert.equal((await call('/api/settings', { method: 'PATCH', body: { slack_webhook_url: 'https://hooks.slack.com/services/T0/B0/xyz', notify_email: 'team@tea.co', confirm_buyer: true } })).status, 200);
  const me = (await call('/api/me')).data;
  assert.equal(me.settings.slack_webhook_url, 'set', 'webhook secret is not echoed back');
  assert.equal(me.settings.notify_email, 'team@tea.co');
  assert.equal(me.settings.confirm_buyer, true);
  assert.equal(me.plan.id, 'pro');
});

test('a PO needing review alerts Slack and email; an approved order is confirmed to the buyer in-thread', async () => {
  const s = makeStore();
  const call = srv.client(s.apiKey);
  await call('/api/settings', { method: 'PATCH', body: { slack_webhook_url: 'https://hooks.slack.com/services/T0/B0/xyz', notify_email: 'team@tea.co', confirm_buyer: true, confirm_message: 'Ships within 3 days.' } });
  fakeAi(poFixture({ po_number: 'AL-1', lines: [{ code: '', description: 'Raw Wildflower Honey', quantity: 2, unit: '', unit_price: null }] }));
  const raw = ['From: Dana Lee <dana@cornergrocer.com>', 'Subject: PO AL-1', 'Message-ID: <po-al-1@cornergrocer.com>', 'Content-Type: text/plain', '', 'Please send 2 honey.'].join('\r\n');
  await srv.client(null)(`/inbound/${s.inbound}`, { method: 'POST', body: Buffer.from(raw) });
  slackPosts.length = 0; sent.length = 0;
  await drainJobs();
  assert.equal(slackPosts.length, 1);
  assert.match(slackPosts[0].body.text, /PO AL-1 from Corner Grocer needs review: 1 unclear match/);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, [{ address: 'team@tea.co', name: '' }]);

  const poId = get('SELECT id FROM purchase_orders WHERE store_id = ? ORDER BY id DESC', s.id).id;
  const po = (await call(`/api/pos/${poId}`)).data;
  const jar = (await call('/api/catalog?q=HON-RAW-250')).data.find((i) => i.sku === 'HON-RAW-250');
  await call(`/api/pos/${poId}/lines/${po.lines[0].id}`, { method: 'PATCH', body: { external_id: jar.external_id } });
  assert.equal((await call(`/api/pos/${poId}/approve`, { method: 'POST' })).status, 200);
  sent.length = 0;
  await drainJobs();
  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.deepEqual(mail.to, [{ address: 'dana@cornergrocer.com', name: '' }]);
  assert.equal(mail.subject, 'Re: PO AL-1');
  assert.equal(mail.inReplyTo, '<po-al-1@cornergrocer.com>');
  assert.match(mail.text, /2 × Raw Wildflower Honey — 250 g jar \(HON-RAW-250\)/);
  assert.match(mail.text, /Ships within 3 days\./);
  await drainJobs();
  assert.equal(sent.length, 1, 'confirmation is sent once');
});

test('plan limits block new orders but never drop incoming POs', async () => {
  const s = makeStore({ plan: 'free' });
  const call = srv.client(s.apiKey);
  const lines = [{ code: 'MUG-CER-01', description: '', quantity: 1, unit: '', unit_price: null }];
  for (let i = 0; i < 5; i += 1) {
    fakeAi(poFixture({ po_number: `L-${i}`, lines }));
    const r = await upload(call, '%PDF');
    assert.equal((await call(`/api/pos/${r.data.id}/approve`, { method: 'POST' })).status, 200);
  }
  fakeAi(poFixture({ po_number: 'L-6', lines }));
  const r = await upload(call, '%PDF');
  assert.equal(r.status, 201, 'the PO is still saved');
  const blocked = await call(`/api/pos/${r.data.id}/approve`, { method: 'POST' });
  assert.equal(blocked.status, 402);
  assert.match(blocked.data.error, /Free plan includes 5 orders/);
  assert.equal((await call(`/api/pos/${r.data.id}`)).data.status, 'ready', 'still waiting, not failed');
  assert.equal((await call('/api/me')).data.plan.used, 5);
});

test('jobs retry with backoff and give up after repeated failures', async () => {
  let calls = 0;
  registerJob('flaky_test', async () => { calls += 1; throw new Error('boom'); });
  const id = enqueue('flaky_test');
  await drainJobs();
  let job = get('SELECT * FROM jobs WHERE id = ?', id);
  assert.equal(job.status, 'queued');
  assert.equal(job.attempts, 1);
  for (let i = 0; i < 4; i += 1) { run("UPDATE jobs SET run_at = datetime('now') WHERE id = ?", id); await drainJobs(); }
  job = get('SELECT * FROM jobs WHERE id = ?', id);
  assert.equal(job.status, 'failed');
  assert.equal(calls, 5);
  assert.equal(job.payload, '{}');
});

test('rate limiter answers 429 with Retry-After', () => {
  const prev = process.env.DISABLE_RATE_LIMIT;
  process.env.DISABLE_RATE_LIMIT = 'false';
  const mw = rateLimit({ windowMs: 60_000, max: 2 });
  const results = [];
  const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { results.push(c); return this; }, json() { return this; } };
  for (let i = 0; i < 3; i += 1) mw({ ip: '1.2.3.4' }, res, () => results.push(200));
  process.env.DISABLE_RATE_LIMIT = prev;
  assert.deepEqual(results, [200, 200, 429]);
  assert.ok(Number(res.headers['Retry-After']) > 0);
});

test('signup for non-Shopify stores', async () => {
  const anon = srv.client(null);
  assert.equal((await anon('/signup', { method: 'POST', body: { store_name: 'X', platform: 'shopify' } })).status, 400);
  const r = await anon('/signup', { method: 'POST', body: { store_name: 'Bean Bros', platform: 'csv', currency: 'eur' } });
  assert.equal(r.status, 201);
  assert.match(r.data.api_key, /^od_[0-9a-f]{48}$/);
  assert.match(r.headers.get('set-cookie'), /od_store=/);
  const me = (await srv.client(r.data.api_key)('/api/me')).data;
  assert.equal(me.name, 'Bean Bros');
  assert.equal(me.currency, 'EUR');
  assert.equal(me.plan.id, 'free');
});
