import { icon, esc, money, num, applyTheme } from './ui.js';

applyTheme();
document.getElementById('year').textContent = new Date().getFullYear();
document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));

const FEATURES = [
  ['inbox', 'Every inbox in one place', 'Gmail, Outlook, Yahoo, Zoho and any custom-domain email in one unified, searchable inbox.'],
  ['wand', 'Writes like you', 'Learns your style from your sent mail and improves from every edit you make.'],
  ['shieldCheck', 'Earned, safe autopilot', 'Auto-sends only proven categories, with safety checks and an undo window.'],
  ['sparkles', 'Ask your inbox', '“Which customers are waiting for a quote?” — answers with links to the exact emails.'],
  ['flame', 'Lead radar & mini-CRM', 'Buying-intent score plus extracted company, phone, budget and deadline for every sender.'],
  ['reply', 'Follow-ups that close deals', 'Quiet leads get a friendly, ready-to-approve follow-up after the days you choose.'],
  ['users', 'Team inbox', 'Assign emails, internal notes, @mentions, SLA timers and “someone else is replying” warnings.'],
  ['globe', 'Any language, both ways', 'Replies in the customer’s language; translate emails and preview replies in yours.'],
  ['clip', 'Reads attachments', 'Understands PDF orders, invoices, briefs and screenshots — without storing them.'],
  ['bell', 'Briefings & instant alerts', 'A morning summary plus Telegram/Slack alerts for urgent, angry, VIP and phishing emails.'],
  ['archive', 'One-click declutter', 'See every newsletter and robot sender; unsubscribe or block in one click.'],
  ['workflow', 'Live Automation Center', 'Watch every email flow through your pipeline in real time — and stop any auto-reply before it goes out.'],
  ['listCheck', 'Emails become tasks', '“Send the quote by Friday” turns into a task with a due date, linked to the email, assignable to your team.'],
  ['zap', 'Recipes & plain-language rules', 'Switch on proven playbooks in one click, or just type what you want automated.'],
  ['flask', 'Test lab', 'Paste any email and see exactly what the AI would do before you trust it.'],
];
document.getElementById('feature-grid').innerHTML = FEATURES.map(([ic, t, d]) => `<div class="card feat"><div class="fi">${icon(ic)}</div><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('');

let interval = 'monthly';
let plans = [];
function render() {
  document.getElementById('pricing-cards').innerHTML = plans.map((p) => {
    const once = p.priceOnce && !p.priceMonthly;
    const amount = once ? p.priceOnce : interval === 'yearly' ? p.priceYearly : p.priceMonthly;
    const per = once ? 'one-time' : interval === 'yearly' ? '/ year' : '/ month';
    const li = (t) => `<li>${icon('check', 'sm')}<span>${t}</span></li>`;
    return `<div class="card price-card ${p.highlight ? 'featured' : ''}">
      <div class="row"><h3 style="margin:0">${esc(p.name)}</h3>${p.highlight ? '<span class="badge info">Most popular</span>' : ''}</div>
      <p class="hint" style="margin:0">${esc(p.description || '')}</p>
      <div><span class="amt">${amount == null ? '—' : money(amount)}</span> <span class="hint">${per}</span></div>
      <ul>${li(`${p.mailboxes} email accounts`)}${li(`${num(p.aiRepliesPerMonth)} AI replies / month`)}${li(`${p.rules} automation rules`)}${li(`${p.teamMembers} team seat${p.teamMembers > 1 ? 's' : ''}`)}${li('Safe autopilot, approvals & follow-ups')}${li('Encryption, 2FA & audit logs')}${(p.features || []).map((f) => li(esc(f))).join('')}${once ? li('Pay once, use forever') : ''}</ul>
      <a class="btn ${p.highlight ? 'primary' : ''} block" href="/signup?plan=${encodeURIComponent(p.key)}&interval=${interval}">${once ? 'Get lifetime access' : 'Start free trial'}</a></div>`;
  }).join('');
}
document.querySelectorAll('#interval-toggle button').forEach((b) => b.addEventListener('click', () => {
  interval = b.dataset.i;
  document.querySelectorAll('#interval-toggle button').forEach((x) => x.classList.toggle('on', x === b));
  render();
}));
fetch('/api/billing/plans').then((r) => r.json()).then((d) => { plans = d.plans; render(); }).catch(() => {});

// ---------- Live hero demo: emails arrive and get handled, step by step ----------
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const SCENES = [
  { from: 'Sarah · BigCorp', subj: 'Group trip for 25 people', body: 'Hi! We’d like a quote for a 25-person company retreat to Bali in March. Budget around $40,000…',
    tags: [['info', 'Sales'], ['high', 'High'], ['ok', 'Lead 92']], why: 'group size, date & budget given',
    draft: 'Hi Sarah, thanks for thinking of us! Our 7-night Bali package is $1,290 per person including hotel, breakfast and transfers…',
    checks: ['Price found in knowledge base', 'Links approved', 'No hidden instructions', '91% confident'], task: 'Send Bali group quote by Friday',
    end: ['ok', 'Auto-sending in 4:00 · Undo'] },
  { from: 'Carlos Méndez', subj: '¿Precio del paquete?', body: 'Hola, ¿cuánto cuesta el paquete premium para dos personas?',
    tags: [['info', 'Sales'], ['normal', 'Spanish']], why: 'pricing question, replied in Spanish',
    draft: 'Hola Carlos, ¡gracias por escribirnos! El paquete premium para dos personas cuesta $2,180…',
    checks: ['Replied in the customer’s language', 'Price verified', '94% confident'], end: ['ok', 'Sent automatically'] },
  { from: 'IT Security ⚠', subj: 'Password expires today', body: 'Your mailbox password expires today. Verify your account here to avoid suspension…',
    tags: [['bad', 'Phishing'], ['high', 'Look-alike domain']], why: 'credential request from micros0ft-support.co',
    checks: ['Look-alike sender domain', 'Credential harvesting pattern'], end: ['bad', 'Blocked — never answered'] },
  { from: 'Ahmed R.', subj: 'Booking still not confirmed!!', body: 'This is the third time I’m writing. My booking is still not confirmed and I fly on Monday.',
    tags: [['bad', 'Complaint'], ['urgent', 'Urgent'], ['warn', 'Angry']], why: 'repeated contact, travel date close',
    draft: 'Hi Ahmed, I’m truly sorry for the wait. I’m checking your booking personally right now…',
    checks: ['Automation “Angry-customer rescue” ran', 'Assigned to you', 'Slack alert sent'], task: 'Confirm Ahmed’s booking before Monday',
    end: ['warn', 'Waiting for your approval'] },
];
const listEl = document.getElementById('demo-list');
const readEl = document.getElementById('demo-read');
const countEl = document.getElementById('demo-count');
let count = 1284;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
function renderScene(sc, stage) {
  readEl.innerHTML = `<div class="demo-from"><b>${esc(sc.from)}</b><span class="hint">${esc(sc.subj)}</span></div>
    <div class="mock-mail">${esc(sc.body)}</div>
    ${stage >= 1 ? `<div class="row demo-in">${sc.tags.map(([c, t]) => `<span class="badge ${c}">${esc(t)}</span>`).join('')}<span class="hint">Why: ${esc(sc.why)}</span></div>` : `<div class="demo-think"><span class="dots"><i></i><i></i><i></i></span> AI is reading…</div>`}
    ${stage >= 2 && sc.draft ? `<div class="mock-draft demo-in"><div class="row hint">${icon('sparkles', 'sm')}AI draft · written in your style</div><p style="margin:8px 0">${esc(sc.draft)}</p></div>` : ''}
    ${stage >= 3 ? `<div class="mock-checks">${sc.checks.map((c, i) => `<span class="demo-in" style="animation-delay:${i * 120}ms">${sc.end[0] === 'bad' ? '⚠' : '✓'} ${esc(c)}</span>`).join('')}</div>` : ''}
    ${stage >= 4 && sc.task ? `<div class="demo-task demo-in">${icon('listCheck', 'sm')} Task created: <b>${esc(sc.task)}</b></div>` : ''}
    ${stage >= 4 ? `<div class="demo-end ${sc.end[0]} demo-in">${icon(sc.end[0] === 'bad' ? 'shield' : sc.end[0] === 'ok' ? 'send' : 'clock', 'sm')}${esc(sc.end[1])}</div>` : ''}`;
}
async function runDemo() {
  if (!listEl || !readEl) return;
  for (let i = 0; ; i = (i + 1) % SCENES.length) {
    const sc = SCENES[i];
    listEl.insertAdjacentHTML('afterbegin', `<div class="mock-row on new"><b>${esc(sc.from)}</b><span>${esc(sc.subj)}</span></div>`);
    [...listEl.children].slice(1).forEach((r) => r.classList.remove('on'));
    while (listEl.children.length > 5) listEl.lastElementChild.remove();
    for (let st = 0; st <= 4; st++) { renderScene(sc, st); await sleep(st === 0 ? 1100 : 900); }
    count += 1 + Math.floor(Math.random() * 3);
    countEl.textContent = count.toLocaleString();
    if (reduced) { renderScene(SCENES[0], 4); return; }
    await sleep(2600);
  }
}
// Seed the list so the inbox never looks empty, then start the loop when visible.
if (listEl) {
  listEl.innerHTML = [['Priya Sharma', 'Change my travel dates'], ['Stripe', 'Payment received'], ['Newsletter', 'Weekly digest']]
    .map(([f, s]) => `<div class="mock-row"><b>${esc(f)}</b><span>${esc(s)}</span></div>`).join('');
  runDemo();
}

// ---------- Plain-language automation demo ----------
const NL = [
  { text: 'When a customer is angry, assign it to me and draft an apology', when: ['Sentiment is negative', 'or category is complaint'], then: ['Assign to you', 'AI drafts an apology (you approve)'] },
  { text: 'Forward every invoice to accounts@mycompany.com', when: ['Category is billing'], then: ['Forward to accounts@mycompany.com'] },
  { text: 'If something is urgent, ping our Slack right away', when: ['Priority is urgent'], then: ['Post to your Slack webhook'] },
];
const nlText = document.getElementById('nl-text');
const nlRule = document.getElementById('nl-rule');
async function runNl() {
  if (!nlText) return;
  for (let i = 0; ; i = (i + 1) % NL.length) {
    const x = NL[i];
    nlRule.innerHTML = ''; nlText.textContent = '';
    if (reduced) nlText.textContent = x.text;
    else for (const ch of x.text) { nlText.textContent += ch; await sleep(28); }
    await sleep(500);
    nlRule.innerHTML = `<div class="nl-col demo-in"><span class="nl-k">When</span>${x.when.map((w) => `<span class="nl-chip">${esc(w)}</span>`).join('')}</div>
      <div class="nl-arrow demo-in">${icon('chevron', 'sm')}</div>
      <div class="nl-col demo-in" style="animation-delay:.2s"><span class="nl-k">Then</span>${x.then.map((w) => `<span class="nl-chip then">${esc(w)}</span>`).join('')}</div>
      <div class="nl-ok demo-in" style="animation-delay:.4s">${icon('checkCircle', 'sm')} Rule ready — review & turn on</div>`;
    if (reduced) return;
    await sleep(3800);
  }
}
runNl();
