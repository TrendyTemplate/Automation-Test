import { applyTheme } from './ui.js';

applyTheme();
const form = document.getElementById('auth-form');
const q = new URLSearchParams(location.search);
const err = document.getElementById('err');

const MESSAGES = {
  provider_disabled: 'That sign-in option is not enabled.', expired: 'The sign-in took too long — please try again.', bad_state: 'Sign-in could not be verified — please try again.',
  suspended: 'This account has been suspended.', signups_closed: 'Sign-ups are currently closed.',
  account_exists_use_password: 'An account with this email already exists. Sign in with your password first.',
  access_denied: 'Sign-in was cancelled.', failed: 'This verification link is invalid or has expired.',
};
if (q.get('error') && err) err.textContent = MESSAGES[q.get('error')] || q.get('error').slice(0, 200);
if (q.get('verify') === 'failed' && err) err.textContent = MESSAGES.failed;

// Only allow same-site relative redirects after login (prevents open-redirect phishing).
function nextUrl() {
  const n = q.get('next');
  if (n && /^\/(app|admin)([/#?]|$)/.test(n)) return n;
  if (q.get('plan')) return `/app#billing?plan=${encodeURIComponent(q.get('plan'))}&interval=${encodeURIComponent(q.get('interval') || 'monthly')}`;
  return '/app';
}

const G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6C12.3 13.6 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.4 0-11.7-4.1-13.6-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>';
const MS = '<svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>';
const box = document.querySelector('.oauth-buttons');
if (box) {
  fetch('/api/auth/providers').then((r) => r.json()).then((p) => {
    const btns = [];
    if (p.google?.login) btns.push(`<a class="btn oauth" href="/api/oauth/google/login">${G} Continue with Google</a>`);
    if (p.microsoft?.login) btns.push(`<a class="btn oauth" href="/api/oauth/microsoft/login">${MS} Continue with Microsoft</a>`);
    if (btns.length) box.innerHTML = `${btns.join('')}<div class="divider"><span>or with email</span></div>`;
  }).catch(() => {});
}

// Password strength meter (client-side hint only; the server enforces the real policy).
const pw = form?.querySelector('input[type=password][autocomplete=new-password]');
if (pw && document.getElementById('pw-meter')) {
  pw.addEventListener('input', () => {
    const v = pw.value;
    let score = 0;
    if (v.length >= 10) score++; if (v.length >= 14) score++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++; if (/\d/.test(v)) score++; if (/[^A-Za-z0-9]/.test(v)) score++;
    const pct = [5, 25, 45, 65, 85, 100][score];
    const color = score <= 1 ? 'var(--bad)' : score <= 3 ? 'var(--warn)' : 'var(--ok)';
    const m = document.getElementById('pw-meter');
    m.style.width = `${pct}%`; m.style.background = color;
    document.getElementById('pw-hint').textContent = v.length < 10 ? `${10 - v.length} more character(s) needed` : score <= 2 ? 'Okay — add numbers or symbols to make it stronger' : 'Strong password';
  });
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function show2fa(pending) {
  form && (form.hidden = true);
  document.querySelector('.oauth-buttons')?.setAttribute('hidden', '');
  const f2 = document.getElementById('twofa-form');
  f2.hidden = false;
  f2.querySelector('input').focus();
  f2.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await post('/api/auth/login/2fa', { pending, code: new FormData(f2).get('code') }); location.href = nextUrl(); } catch (x) { document.getElementById('err2').textContent = x.message; }
  });
}
if (q.get('twofa') && document.getElementById('twofa-form')) show2fa(q.get('twofa'));

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const body = Object.fromEntries(new FormData(form));
  const mode = form.dataset.mode;
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  const label = btn.textContent;
  btn.innerHTML = `<span class="spin"></span>${label}`;
  try {
    if (mode === 'forgot') {
      await post('/api/auth/forgot', body);
      form.innerHTML = '<div class="callout ok">If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.</div>';
      return;
    }
    if (mode === 'reset') {
      await post('/api/auth/reset', { ...body, token: q.get('token') });
      form.innerHTML = '<div class="callout ok">Password updated. <a href="/login">Sign in</a></div>';
      return;
    }
    if (mode === 'signup' && q.get('ref')) body.ref = q.get('ref');
    const data = await post(`/api/auth/${mode}`, body);
    if (data.need2fa) { show2fa(data.pending); return; }
    location.href = nextUrl();
  } catch (x) {
    err.textContent = x.message;
  } finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = label; } }
});
