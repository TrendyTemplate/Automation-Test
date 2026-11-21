document.getElementById('year').textContent = new Date().getFullYear();
let interval = 'monthly';
let plans = [];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  const el = document.getElementById('pricing-cards');
  el.innerHTML = plans.map((p) => {
    const life = p.key === 'lifetime';
    const amount = life ? p.priceOnce : interval === 'yearly' ? p.priceYearly : p.priceMonthly;
    const per = life ? 'one-time' : interval === 'yearly' ? '/year' : '/month';
    return `<div class="card price ${p.key === 'pro' ? 'featured' : ''}">
      <h3>${esc(p.name)} ${p.key === 'pro' ? '<span class="badge active">Most popular</span>' : ''}</h3>
      <div class="amt">$${amount}<small> ${per}</small></div>
      <ul>
        <li>${p.mailboxes} email accounts</li>
        <li>${p.aiRepliesPerMonth.toLocaleString()} AI replies / month</li>
        <li>${p.rules} automation rules</li>
        <li>${p.teamMembers} team member${p.teamMembers > 1 ? 's' : ''}</li>
        <li>Auto-pilot & approval queue</li>
        ${life ? '<li>Pay once, use forever</li>' : ''}
      </ul>
      <a class="btn ${p.key === 'pro' ? 'primary' : ''}" href="/signup?plan=${p.key}&interval=${interval}">${life ? 'Buy lifetime' : 'Start free trial'}</a>
    </div>`;
  }).join('');
}

document.querySelectorAll('#interval-toggle button').forEach((b) => b.addEventListener('click', () => {
  interval = b.dataset.i;
  document.querySelectorAll('#interval-toggle button').forEach((x) => x.classList.toggle('on', x === b));
  render();
}));

fetch('/api/billing/plans').then((r) => r.json()).then((d) => { plans = d.plans; render(); });
