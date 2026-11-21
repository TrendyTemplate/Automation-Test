import { esc, icon, applyTheme, localStorageSet, BRAND } from './ui.js';

applyTheme();
const token = new URLSearchParams(location.search).get('token') || '';
const box = document.getElementById('join');

(async () => {
  const res = await fetch(`/api/auth/invite-info?token=${encodeURIComponent(token)}`);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    box.innerHTML = `${icon('alert', 'lg')}<h1 style="font-size:22px;margin-top:10px">Invitation not valid</h1><p class="muted">${esc(d.error || 'This invitation is invalid or has expired.')} Ask your teammate to send a new one.</p><a class="btn" href="/">Go to ${esc(BRAND)}</a>`;
    return;
  }
  // Remember the invite so it is accepted after any sign-in method (including Google / Microsoft).
  localStorageSet('invite', token);
  const q = `invite=${encodeURIComponent(token)}&email=${encodeURIComponent(d.email)}`;
  box.innerHTML = `<span class="brand-mark" style="width:52px;height:52px;margin:0 auto 16px;border-radius:14px">${icon('users', 'lg')}</span>
    <h1 style="font-size:23px">Join ${esc(d.workspace)}</h1>
    <p class="muted">You've been invited to join <b>${esc(d.workspace)}</b> on ${esc(BRAND)} as <b>${esc(d.role)}</b>.<br>Invitation for ${esc(d.email)}.</p>
    ${d.exists ? `<a class="btn primary block lg" href="/login?${q}">Sign in to accept</a>` : `<a class="btn primary block lg" href="/signup?${q}">Create your account</a><p class="hint mt">Already have an account? <a href="/login?${q}">Sign in</a></p>`}`;
})();
