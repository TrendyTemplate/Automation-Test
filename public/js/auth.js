const form = document.getElementById('auth-form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err');
  err.textContent = '';
  const body = Object.fromEntries(new FormData(form));
  const res = await fetch(`/api/auth/${form.dataset.mode}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { err.textContent = data.error || 'Something went wrong'; return; }
  // Carry a chosen plan from the pricing page through to billing.
  const q = new URLSearchParams(location.search);
  location.href = q.get('plan') ? `/app#billing?plan=${encodeURIComponent(q.get('plan'))}&interval=${encodeURIComponent(q.get('interval') || 'monthly')}` : '/app';
});
