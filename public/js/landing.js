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
