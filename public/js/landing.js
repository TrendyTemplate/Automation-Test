document.getElementById('year').textContent = new Date().getFullYear();
let interval = 'monthly';
let plans = [];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  const el = document.getElementById('pricing-cards');
  el.innerHTML = plans.map((p) => {
    const once = p.priceOnce && !p.priceMonthly;
    const amount = once ? p.priceOnce : interval === 'yearly' ? p.priceYearly : p.priceMonthly;
    const per = once ? 'one-time' : interval === 'yearly' ? '/year' : '/month';
    return `<div class="card price ${p.highlight ? 'featured' : ''}">
      <h3>${esc(p.name)} ${p.highlight ? '<span class="badge active">Most popular</span>' : ''}</h3>
      <p class="hint" style="margin:0">${esc(p.description || '')}</p>
      <div class="amt">$${amount ?? '—'}<small> ${per}</small></div>
      <ul>
        <li>${p.mailboxes} email accounts</li>
        <li>${p.aiRepliesPerMonth.toLocaleString()} AI replies / month</li>
        <li>${p.rules} automation rules</li>
        <li>${p.teamMembers} team member${p.teamMembers > 1 ? 's' : ''}</li>
        <li>Autopilot, approvals & follow-ups</li>
        ${(p.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}
        ${once ? '<li>Pay once, use forever</li>' : ''}
      </ul>
      <a class="btn ${p.highlight ? 'primary' : ''}" href="/signup?plan=${p.key}&interval=${interval}">${once ? 'Get lifetime access' : 'Start free trial'}</a>
    </div>`;
  }).join('');
}

document.querySelectorAll('#interval-toggle button').forEach((b) => b.addEventListener('click', () => {
  interval = b.dataset.i;
  document.querySelectorAll('#interval-toggle button').forEach((x) => x.classList.toggle('on', x === b));
  render();
}));

fetch('/api/billing/plans').then((r) => r.json()).then((d) => { plans = d.plans; render(); });
