// Browser end-to-end (Playwright): a new customer signs up, connects a real (local) IMAP/SMTP mailbox through
// the UI, receives an email, approves the AI draft, and the reply is delivered. Also checks XSS safety,
// every page rendering without errors, keyboard/command palette, dark mode and mobile layout.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PW, fakeAnthropic, triage, imapServer, smtpServer, rawEmail, until } from './helpers.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

const XSS = '<img src=x onerror="window.__xss=1">';
const ai = await fakeAnthropic(() => triage({ reply_body: 'Hi! Our Pro plan is $49 per month.', summary: `Asks about pricing ${XSS}` }));
process.env.DB_PATH = ':memory:';
process.env.ALLOW_PRIVATE_MAIL_HOSTS = 'true';
process.env.ANTHROPIC_BASE_URL = ai.url;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.AUTH_RATE_LIMIT = '500';
process.env.NODE_ENV = 'test';
const imap = await imapServer({ port: 3143, user: 'ui@test.local' });
const smtp = await smtpServer({ port: 3025, user: 'ui@test.local' });
const { createApp } = await import('../src/server.js');
const { one } = await import('../src/db.js');

let server; let base; let browser;
before(async () => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; if (chromium) browser = await chromium.launch(); });
after(async () => { await browser?.close(); server.close(); ai.close(); await imap.close(); await smtp.close(); });

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
  await page.waitForURL('**/app');
  await page.waitForSelector('text=Finish setting up');

  // Knowledge base entry via modal
  await page.goto(`${base}/app#knowledge`);
  await page.click('[data-act=new]');
  await page.fill('.modal [name=title]', 'Pricing');
  await page.fill('.modal [name=content]', 'Pro plan: $49 per month.');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.card input[value="Pricing"]');

  // Connect the mailbox through the UI
  await page.goto(`${base}/app#mailboxes`);
  await page.click('[data-act=add] >> nth=0');
  await page.selectOption('.modal [name=provider]', 'custom');
  await page.fill('.modal [name=email]', 'ui@test.local');
  await page.fill('.modal [name=password]', 'imap-pass');
  await page.fill('.modal [name=imap_host]', '127.0.0.1'); await page.fill('.modal [name=imap_port]', '3143');
  await page.fill('.modal [name=smtp_host]', '127.0.0.1'); await page.fill('.modal [name=smtp_port]', '3025');
  // local test servers are plain-text; the API defaults custom providers to TLS, so send explicit flags
  await page.evaluate(() => {
    const f = document.querySelector('.modal form');
    for (const [n, v] of [['imap_secure', ''], ['smtp_secure', '']]) { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); }
  });
  await page.route('**/api/mailboxes', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = JSON.parse(route.request().postData());
    body.imap_secure = false; body.smtp_secure = false;
    return route.continue({ postData: JSON.stringify(body) });
  });
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('text=ui@test.local');
  await page.unroute('**/api/mailboxes');

  // An email arrives with an XSS payload in subject and body
  imap.deliver(rawEmail({ from: `Evil <evil@attacker.example>`, to: 'ui@test.local', subject: `Price? ${XSS}`, body: `<script>window.__xss=2</script> How much is Pro?`, messageId: '<ui1@attacker.example>' }));
  await page.click('[data-act=sync]');
  await until(() => one(`SELECT id FROM replies WHERE status = 'pending'`));

  // Inbox → open email → approve draft
  await page.goto(`${base}/app#inbox`);
  await page.waitForSelector('.mrow');
  await page.click('.mrow');
  await page.waitForSelector('#reply-body');
  assert.match(await page.inputValue('#reply-body'), /\$49 per month/);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'no script from email content executed');
  assert.ok((await page.textContent('.reader')).includes('<img src=x'), 'HTML is shown as text, not rendered');
  await page.fill('#reply-body', 'Hi! Pro is $49 per month. Thanks for asking.');
  await page.click('form[data-act=send] button[type=submit]');
  await page.waitForSelector('text=Reply sent');
  await until(() => smtp.received.length === 1);
  assert.equal(smtp.received[0].envelope.rcptTo[0].address, 'evil@attacker.example');
  assert.match(smtp.received[0].parsed.text, /Thanks for asking/);

  // Every page renders; no console errors
  for (const v of ['dashboard', 'approvals', 'ask', 'contacts', 'analytics', 'mailboxes', 'brain', 'autopilot', 'knowledge', 'rules', 'templates', 'simulator', 'declutter', 'integrations', 'profile', 'team', 'billing', 'security', 'referrals', 'support']) {
    await page.goto(`${base}/app#${v}`);
    await page.waitForSelector('.page-h h1', { timeout: 5000 });
  }
  // Grouped sections show their tabs
  await page.goto(`${base}/app#knowledge`);
  await page.waitForSelector('.tabs a.on:has-text("Knowledge base")');
  await page.goto(`${base}/app#team`);
  await page.waitForSelector('.tabs a:has-text("Security & privacy")');
  // Command palette finds the email
  await page.goto(`${base}/app#dashboard`);
  await page.waitForSelector('.page-h');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Price');
  await page.waitForSelector('.cmdk-item:has-text("Price?")');
  await page.keyboard.press('Escape');

  // Security: enable 2FA in the UI
  await page.goto(`${base}/app#security`);
  await page.click('[data-act=setup2fa]');
  await page.waitForSelector('img[alt="QR code for 2FA"]');

  // Dark mode toggle persists
  await page.click('#theme-btn');
  await page.click('.menu button:has-text("Dark")');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');

  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.deepEqual(errors, []);
});

test('team invitation: invite → /join → sign up → member of the team with limited menu', { skip: !chromium && 'playwright not installed' }, async () => {
  const owner = await browser.newPage();
  await owner.goto(`${base}/login`);
  await owner.fill('#email', 'uma@ui.test'); await owner.fill('#password', PW);
  await owner.click('#auth-form button[type=submit]'); await owner.waitForURL('**/app');
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
  await guest.waitForURL('**/app');
  await guest.waitForSelector('#ws-name:has-text("UI Shop")');
  const nav = await guest.textContent('#nav');
  assert.ok(!nav.includes('Email accounts') && !nav.includes('Alerts & API'), 'members do not see setup pages');
  assert.ok(nav.includes('Inbox') && nav.includes('Settings'));
  await guest.goto(`${base}/app#mailboxes`);
  await guest.waitForSelector('text=Owners and admins only');
  assert.deepEqual(errors, []);
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
  assert.ok((await page.locator('#pricing-cards .price-card').count()) >= 3);
  assert.deepEqual(errors, []);
});
