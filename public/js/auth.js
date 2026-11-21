const form = document.getElementById('auth-form');
const q = new URLSearchParams(location.search);
const err = document.getElementById('err');

const MESSAGES = {
  provider_disabled: 'That sign-in option is not enabled.', expired: 'The sign-in took too long, please try again.',
  suspended: 'This account has been suspended.', signups_closed: 'Sign-ups are currently closed.',
  account_exists_use_password: 'An account with this email already exists. Log in with your password, then link Microsoft from Settings.',
  access_denied: 'Sign-in was cancelled.', failed: 'Email verification link is invalid or expired.',
};
if (q.get('error') && err) err.textContent = MESSAGES[q.get('error')] || q.get('error');
if (q.get('verify') === 'failed' && err) err.textContent = MESSAGES.failed;

const ICONS = {
  google: '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6C12.3 13.6 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.4 0-11.7-4.1-13.6-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>',
  microsoft: '<svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>',
};

const box = document.querySelector('.oauth-buttons');
if (box) {
  fetch('/api/auth/providers').then((r) => r.json()).then((p) => {
    const btns = [];
    if (p.google?.login) btns.push(`<a class="btn block oauth" href="/api/oauth/google/login">${ICONS.google} Continue with Google</a>`);
    if (p.microsoft?.login) btns.push(`<a class="btn block oauth" href="/api/oauth/microsoft/login">${ICONS.microsoft} Continue with Microsoft</a>`);
    if (btns.length) box.innerHTML = `${btns.join('')}<div class="divider"><span>or with email</span></div>`;
  }).catch(() => {});
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function afterLogin() {
  location.href = q.get('plan') ? `/app#billing?plan=${encodeURIComponent(q.get('plan'))}&interval=${encodeURIComponent(q.get('interval') || 'monthly')}` : '/app';
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const body = Object.fromEntries(new FormData(form));
  const mode = form.dataset.mode;
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    if (mode === 'forgot') {
      await post('/api/auth/forgot', body);
      form.innerHTML = '<p>If an account exists for that email, a reset link is on its way. Check your inbox (and spam folder).</p>';
      return;
    }
    if (mode === 'reset') {
      await post('/api/auth/reset', { ...body, token: q.get('token') });
      form.innerHTML = '<p>Password updated. <a href="/login">Log in</a></p>';
      return;
    }
    if (mode === 'signup' && q.get('ref')) body.ref = q.get('ref');
    const data = await post(`/api/auth/${mode}`, body);
    if (data.need2fa) {
      form.hidden = true;
      const f2 = document.getElementById('twofa-form');
      f2.hidden = false;
      f2.querySelector('input').focus();
      f2.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try { await post('/api/auth/login/2fa', { pending: data.pending, code: new FormData(f2).get('code') }); afterLogin(); } catch (x) { document.getElementById('err2').textContent = x.message; }
      });
      return;
    }
    afterLogin();
  } catch (x) {
    err.textContent = x.message;
  } finally { btn.disabled = false; }
});
