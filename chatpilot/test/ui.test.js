// Browser end-to-end (Playwright): a new shop signs up, adds products, connects a Messenger page, a customer message
// arrives through the signed Meta webhook, the owner approves the AI draft, and the reply goes out through the Graph API.
// Also checks XSS safety, every page rendering without errors, the command palette, dark mode and mobile layout.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import crypto from 'node:crypto';
import { PW, fakeAnthropic } from './helpers.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

const XSS = '<img src=x onerror="window.__xss=1">';
const ai = await fakeAnthropic(() => ({
  reply: 'Hi! The Black Hoodie is BDT 1,200.', language: 'en', intent: `price question ${XSS}`, stage: 'interested', lead_score: 75,
  summary: `Asks about the hoodie ${XSS}`, order_status: 'none', order: { items: [], customer_name: '', phone: '', address: '', note: '' },
  handoff: false, handoff_reason: '', confidence: 0.9, unsupported_claims: false,
}));
const sent = [];
const graph = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') return res.end('{"name":"UI Shop Page"}');
    sent.push(JSON.parse(b)); res.end(`{"message_id":"m_${sent.length}"}`);
  });
});
await new Promise((r) => graph.listen(0, '127.0.0.1', r));
process.env.DB_PATH = ':memory:';
process.env.ANTHROPIC_BASE_URL = ai.url;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.META_GRAPH_URL = `http://127.0.0.1:${graph.address().port}`;
process.env.SALES_DEBOUNCE_MS = '0';
process.env.AUTH_RATE_LIMIT = '500';
process.env.NODE_ENV = 'test';
const { createApp } = await import('../src/server.js');
const { one } = await import('../src/db.js');
const { flushSales } = await import('../src/services/sales.js');

let server; let base; let browser;
before(async () => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; if (chromium) browser = await chromium.launch(); });
after(async () => { await browser?.close(); server.close(); ai.close(); graph.close(); });
const SECRET = '0123456789abcdef0123456789abcdef';

test('full customer journey in the browser', { skip: !chromium && 'playwright not installed' }, async () => {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push(`unexpected dialog: ${d.message()}`); d.dismiss(); });

  // Sign up — weak password rejected first
  await page.goto(`${base}/signup`);
  await page.fill('#name', 'Uma Tester'); await page.fill('#company', 'UI Shop'); await page.fill('#email', 'uma@ui.test');
  await page.fill('#password', 'short');
  await page.click('#auth-form button[type=submit]');
  await page.waitForSelector('#err:has-text("10 characters")');
  await page.fill('#password', PW);
  await page.click('#auth-form button[type=submit]');
  await page.waitForURL(/\/app(#.*)?$/);
  await page.waitForURL('**/app#welcome');
  await page.waitForSelector('h1:has-text("Connect your Facebook Page")');

  // Add a product through the modal
  await page.goto(`${base}/app#catalog`);
  await page.click('[data-act=add]');
  await page.fill('.modal [name=name]', 'Black Hoodie');
  await page.fill('.modal [name=price]', '1200');
  await page.fill('.modal [name=stock]', '10');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('td:has-text("Black Hoodie")');

  // Knowledge base: one-click idea
  await page.goto(`${base}/app#knowledge`);
  await page.click('[data-act=idea] >> nth=0');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.card input[value="Delivery charges"]');

  // Connect a Messenger page (token checked against the fake Graph API)
  await page.goto(`${base}/app#channels`);
  await page.click('[data-act=add]');
  await page.fill('.modal [name=external_id]', '1098765432');
  await page.fill('.modal [name=access_token]', 'EAAPAGE-TOKEN');
  await page.fill('.modal [name=app_secret]', SECRET);
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('h3:has-text("UI Shop Page")');
  const verify = await page.textContent('dd code >> nth=1');
  const ok = await fetch(`${base}/api/social/webhook?hub.mode=subscribe&hub.verify_token=${verify.trim()}&hub.challenge=777`);
  assert.equal(await ok.text(), '777');
  // Comment rules: add a keyword reply through the form
  await page.click('[data-act=rules]');
  await page.check('.modal [name=hide_phones]');
  await page.fill('.modal [name=w0]', 'price, dam');
  await page.fill('.modal [name=p0]', 'Inbox check korun');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.modal', { state: 'detached' });
  const rules = JSON.parse(one('SELECT comment_rules FROM channels WHERE external_id = ?', '1098765432').comment_rules);
  assert.deepEqual([rules.hide_phones, rules.triggers[0].words, rules.triggers[0].public], [true, ['price', 'dam'], 'Inbox check korun']);

  // A customer writes (with an XSS payload) through the signed webhook
  const payload = JSON.stringify({ object: 'page', entry: [{ id: '1098765432', messaging: [{ sender: { id: 'psid-ui' }, recipient: { id: '1098765432' }, timestamp: Date.now(), message: { mid: 'mid.ui1', text: `dam koto? ${XSS}<script>window.__xss=2</script>` } }] }] });
  const hook = await fetch(`${base}/api/social/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', SECRET).update(payload).digest('hex')}` }, body: payload });
  assert.equal(hook.status, 200);
  await flushSales();
  assert.equal(sent.length, 0, 'new channels start in Draft mode');

  // Conversations → open chat → edit & approve the AI draft
  await page.goto(`${base}/app#chats`);
  await page.click('.citem');
  await page.waitForSelector('textarea[data-draft]');
  assert.match(await page.inputValue('textarea[data-draft]'), /BDT 1,200/);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'no script from customer content executed');
  assert.ok((await page.textContent('.bubbles')).includes('<img src=x'), 'HTML is shown as text, not rendered');
  await page.fill('textarea[data-draft]', 'Hi! The Black Hoodie is BDT 1,200. Which size?');
  await page.click('[data-act=approve]');
  await page.waitForSelector('.bubble-t:has-text("Which size?")');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].recipient, { id: 'psid-ui' });
  assert.match(sent[0].message.text, /Which size\?/);
  assert.ok(one(`SELECT id FROM chat_messages WHERE status = 'sent' AND source = 'ai'`));

  // Test chat answers without sending anything
  await page.goto(`${base}/app#saleslab`);
  await page.fill('[name=text]', 'hoodie ache?');
  await page.press('[name=text]', 'Enter');
  await page.waitForSelector('#lab-b .bubble.out');
  assert.equal(sent.length, 1);

  // Every page renders; no console errors
  for (const v of ['dashboard', 'welcome', 'learning', 'chats', 'orders', 'customers', 'analytics', 'couriers', 'delivery', 'hours', 'payments', 'broadcasts', 'catalog', 'saleslab', 'channels', 'brain', 'knowledge', 'integrations', 'profile', 'team', 'billing', 'security', 'referrals', 'support']) {
    await page.goto(`${base}/app#${v}`);
    await page.waitForSelector('h1', { timeout: 5000 });
  }
  // Grouped sections show their tabs
  await page.goto(`${base}/app#knowledge`);
  await page.waitForSelector('.tabs a.on:has-text("Knowledge base")');
  await page.goto(`${base}/app#team`);
  await page.waitForSelector('.tabs a:has-text("Security & privacy")');
  // Command palette finds the customer
  await page.goto(`${base}/app#dashboard`);
  await page.waitForSelector('.page-h');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('price');
  await page.waitForSelector('.cmdk-item:has-text("price question")');
  await page.keyboard.press('Escape');

  // Security: enable 2FA in the UI
  await page.goto(`${base}/app#security`);
  await page.click('[data-act=setup2fa]');
  await page.waitForSelector('img[alt="QR code for 2FA"]');

  // Dark mode toggle persists
  await page.click('#theme-btn');
  await page.click('.menu button:has-text("Dark")');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');

  // Bangla interface: menu and headings change, customer messages don't
  await page.goto(`${base}/app#profile`);
  await page.selectOption('#ui-lang', 'bn');
  await page.waitForSelector('#nav a:has-text("অর্ডার")');
  await page.goto(`${base}/app#orders`);
  await page.waitForSelector('h1:has-text("অর্ডার")');
  await page.goto(`${base}/app#chats`);
  await page.waitForSelector('.convo-list');
  assert.match(await page.textContent('.convo-list'), /The Black Hoodie is BDT 1,200/, 'chat text untouched');
  await page.evaluate(() => localStorage.setItem('mp:lang', 'en'));

  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.deepEqual(errors, []);
});

test('team invitation: invite → /join → sign up → member of the team with limited menu', { skip: !chromium && 'playwright not installed' }, async () => {
  const owner = await browser.newPage();
  await owner.goto(`${base}/login`);
  await owner.fill('#email', 'uma@ui.test'); await owner.fill('#password', PW);
  await owner.click('#auth-form button[type=submit]'); await owner.waitForURL(/\/app(#.*)?$/);
  const wsId = await owner.evaluate(async () => (await (await fetch('/api/auth/me')).json()).workspace.id);
  const { run } = await import('../src/db.js');
  run(`UPDATE workspaces SET plan='pro', subscription_status='active', billing_interval='monthly' WHERE id = ?`, wsId);
  const token = await owner.evaluate(async () => (await (await fetch('/api/team/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nia@ui.test', role: 'member' }) })).json()).token);
  const guest = await (await browser.newContext()).newPage();
  const errors = [];
  guest.on('pageerror', (e) => errors.push(e.message));
  await guest.goto(`${base}/join?token=${token}`);
  await guest.click('text=Create your account');
  await guest.waitForFunction(() => document.getElementById('email')?.value === 'nia@ui.test', null, { timeout: 5000 });
  assert.equal(await guest.evaluate(() => document.getElementById('email').readOnly), true, 'invited email is locked');
  await guest.fill('#name', 'Nia'); await guest.fill('#password', PW);
  await guest.click('#auth-form button[type=submit]');
  await guest.waitForURL(/\/app(#.*)?$/);
  await guest.waitForFunction(() => /UI Shop/.test(document.getElementById('ws-name').textContent) || /UI Shop/.test(document.querySelector('#ws-switch option:checked')?.textContent || ''));
  const nav = (await guest.textContent('#nav')) + (await guest.textContent('#rail-foot'));
  assert.ok(!nav.includes('Channels') && !nav.includes('Alerts & API'), 'members do not see setup pages');
  assert.ok(nav.includes('Chats') && nav.includes('Settings'));
  await guest.goto(`${base}/app#channels`);
  await guest.waitForSelector('text=Owners and admins only');
  assert.deepEqual(errors, []);
});

test('phone layout: bottom tab bar, More sheet, chat opens full screen', { skip: !chromium && 'playwright not installed' }, async () => {
  const ctxp = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctxp.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/login`);
  await page.fill('#email', 'uma@ui.test'); await page.fill('#password', PW);
  await page.click('#auth-form button[type=submit]'); await page.waitForURL(/\/app(#.*)?$/);
  await page.waitForSelector('#tabbar a:has-text("Chats")');
  assert.equal(await page.isVisible('#rail'), false, 'rail is hidden on phones');
  await page.click('#more-btn');
  await page.click('.sheet a:has-text("Channels")');
  await page.waitForSelector('h1:has-text("Channels")');
  await page.click('#tabbar a:has-text("Chats")');
  await page.click('.citem');
  await page.waitForSelector('.convo.reading .chat-head');
  assert.equal(await page.isVisible('.convo-list'), false, 'list hides while reading');
  await page.click('.chat-back');
  await page.waitForSelector('.convo:not(.reading) .convo-list');
  for (const v of ['dashboard', 'welcome', 'learning', 'chats', 'orders', 'customers', 'analytics', 'couriers', 'catalog', 'saleslab', 'channels', 'brain', 'billing', 'security']) {
    await page.goto(`${base}/app#${v}`);
    await page.waitForSelector('h1');
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    const wide = w > 391 ? await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > 392).slice(0, 4).map((e) => `${e.tagName}.${e.className}`).join(' | ')) : '';
    assert.ok(w <= 391, `#${v} overflows: ${w}px ${wide}`);
  }
  assert.deepEqual(errors, []);
  await ctxp.close();
});

test('public pages: no horizontal overflow on phones, no errors', { skip: !chromium && 'playwright not installed' }, async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const u of ['/', '/login', '/signup', '/forgot', '/security', '/terms', '/privacy']) {
    await page.goto(base + u);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 376, `${u} overflows: ${w}px`);
  }
  await page.goto(`${base}/`);
  await page.waitForSelector('#pricing-cards .price-card');
  await page.waitForSelector('#demo-chat .bubble.out', { timeout: 8000 });
  assert.ok((await page.locator('#pricing-cards .price-card').count()) >= 3);
  assert.deepEqual(errors, []);
});
