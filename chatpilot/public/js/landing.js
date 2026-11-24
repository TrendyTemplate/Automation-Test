import { icon, esc, money, num, applyTheme } from './ui.js';

applyTheme();
document.getElementById('year').textContent = new Date().getFullYear();
document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));

const FEATURES = [
  ['chat', 'One inbox for every chat', 'Messenger, Instagram and WhatsApp conversations side by side, with stage, lead score and order history.'],
  ['layers', 'Sells from your catalog', 'Prices, stock, sizes and colours from your product list — import hundreds of products from a CSV.'],
  ['card', 'Takes the order', 'Collects items, name, phone and address, shows an exact summary and records the order when the customer confirms.'],
  ['globe', 'Speaks like your customers', 'Bangla, Banglish, English and 40+ languages — always in the customer’s own words and script.'],
  ['shieldCheck', 'Never invents a price', 'Totals are computed by the server. Unknown amounts, links or “never say” words are held for you.'],
  ['userCheck', 'Hands off to you', 'Complaints, refunds and bargaining go to a human, with a Telegram or Slack alert on your phone.'],
  ['checkCircle', 'Draft or Auto-pilot', 'Approve every reply with one click until you trust it, then let it run on its own.'],
  ['reply', 'Brings buyers back', 'One friendly follow-up for customers who went quiet — always inside Meta’s 24-hour window.'],
  ['flame', 'Spots ready buyers', 'Every chat gets a buying-intent score so you know who to call first.'],
  ['flask', 'Test chat', 'Chat as a customer and see exactly what the assistant would say before going live.'],
  ['users', 'Built for teams & agencies', 'Roles, invitations, multiple shops per account and separate billing per client.'],
  ['download', 'Your data, your way', 'Export orders to CSV, use the REST API, or export everything in one click.'],
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
      <ul>${li(`${p.channels} channel${p.channels > 1 ? 's' : ''} (Page, Instagram or WhatsApp)`)}${li(`${num(p.aiRepliesPerMonth)} AI replies / month`)}${li(`${num(p.products)} products`)}${li(`${p.teamMembers} team seat${p.teamMembers > 1 ? 's' : ''}`)}${li('Order taking, hand-off & follow-ups')}${li('Encryption, 2FA & audit logs')}${(p.features || []).map((f) => li(esc(f))).join('')}${once ? li('Pay once, use forever') : ''}</ul>
      <a class="btn ${p.highlight ? 'primary' : ''} block" href="/signup?plan=${encodeURIComponent(p.key)}&interval=${interval}">${once ? 'Get lifetime access' : 'Start free trial'}</a></div>`;
  }).join('');
}
document.querySelectorAll('#interval-toggle button').forEach((b) => b.addEventListener('click', () => {
  interval = b.dataset.i;
  document.querySelectorAll('#interval-toggle button').forEach((x) => x.classList.toggle('on', x === b));
  render();
}));
fetch('/api/billing/plans').then((r) => r.json()).then((d) => { plans = d.plans; render(); }).catch(() => {});

// ---------- Hero demo: a customer chat answered by the assistant ----------
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const SCENES = [
  ['Messenger', [
    ['in', 'hoodie er dam koto? L size ache?'],
    ['out', 'জি আপু, কালো হুডি L সাইজ স্টকে আছে 🙂 দাম ৳1,200। কয়টা নিবেন?'],
    ['in', '2ta nibo. Rahim, 01711-000000, Dhanmondi 5'],
    ['out', 'ধন্যবাদ রহিম ভাই! অর্ডারটা কনফার্ম করবেন?\n• Black Hoodie (L) × 2 = BDT 2,400\nSubtotal: BDT 2,400'],
    ['in', 'ji confirm'],
    ['note', '✓ Order #1043 recorded · stock updated'],
  ]],
  ['WhatsApp', [
    ['in', 'Do you deliver outside Dhaka? Payment?'],
    ['out', 'Yes! Outside Dhaka delivery is ৳130 (2-4 days). Cash on delivery or bKash — whichever you prefer.'],
    ['in', 'Can you give 500 tk discount?'],
    ['note', '🙋 Bargaining below price → handed to you with an alert'],
  ]],
  ['Instagram', [
    ['in', 'ei lipstick ta original?'],
    ['out', 'জি, ১০০% অরিজিনাল — ব্যাচ নম্বর ও এক্সপায়ারি বক্সে দেওয়া থাকে। কোন শেডটা দেখছেন?'],
  ]],
];
const chatEl = document.getElementById('demo-chat');
const platEl = document.getElementById('demo-platform');
const countEl = document.getElementById('demo-count');
const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
const bubble = ([who, text]) => (who === 'note'
  ? `<div class="demo-note">${esc(text)}</div>`
  : `<div class="bubble-row ${who}"><div class="bubble ${who}"><div class="bubble-t">${esc(text)}</div></div></div>`);
async function play() {
  let count = 312;
  for (;;) {
    for (const [plat, lines] of SCENES) {
      platEl.textContent = plat;
      chatEl.innerHTML = '';
      for (const line of lines) {
        if (line[0] === 'out') { chatEl.insertAdjacentHTML('beforeend', '<div class="bubble-row out typing"><div class="bubble out"><span class="dots"><i></i><i></i><i></i></span></div></div>'); await sleep(900); chatEl.querySelector('.typing')?.remove(); }
        chatEl.insertAdjacentHTML('beforeend', bubble(line));
        chatEl.scrollTop = chatEl.scrollHeight;
        await sleep(line[0] === 'in' ? 1100 : 1500);
      }
      countEl.textContent = (++count).toLocaleString();
      if (reduced) return;
      await sleep(2200);
    }
  }
}
play();
void num; void money;
