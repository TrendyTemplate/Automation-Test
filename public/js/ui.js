// Shared UI toolkit for the customer app and the admin panel. Vanilla ES modules, no dependencies.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Icons (24px stroke icons) ----------
const P = {
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3"/><path d="M7 15h10"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  dollar: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  lifebuoy: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24M14.83 14.83l4.24 4.24M14.83 9.17l4.24-4.24M4.93 19.07l4.24-4.24"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  reply: '<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  wand: '<path d="m15 4-11 11 5 5L20 9z"/><path d="M14 5l5 5"/>',
  logo: '<path d="M4 7.5 12 13l8-5.5"/><path d="M4 6h16v12H4z"/><path d="M14.5 2.5 17 5l-2.5 2.5"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  note: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
};
export const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.info}</svg>`;

// ---------- Brand (set by the server from Admin → Settings) ----------
export const BRAND = document.querySelector('meta[name="app-name"]')?.content || 'MailPilot AI';

// ---------- Formatting ----------
const toDate = (d) => (d ? new Date(/Z$|T|[+-]\d\d:\d\d$/.test(d) ? d : `${String(d).replace(' ', 'T')}Z`) : null);
export const fmtDate = (d) => (d ? toDate(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtDay = (d) => (d ? toDate(d).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
export function ago(d) {
  if (!d) return '—';
  const s = (Date.now() - toDate(d).getTime()) / 1000;
  const fut = s < 0; const a = Math.abs(s);
  const v = a < 60 ? 'just now' : a < 3600 ? `${Math.round(a / 60)}m` : a < 86400 ? `${Math.round(a / 3600)}h` : a < 604800 ? `${Math.round(a / 86400)}d` : toDate(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (v === 'just now' || a >= 604800) return v;
  return fut ? `in ${v}` : `${v} ago`;
}
export const money = (v, cur = 'usd') => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(cur || 'usd').toUpperCase(), maximumFractionDigits: 2 }).format(Number(v || 0)); } catch { return `${cur} ${v}`; }
};
export const num = (v) => Number(v || 0).toLocaleString();
const LABELS = { sales_inquiry: 'Sales', job_application: 'Job application', meeting_request: 'Meeting', awaiting_approval: 'Awaiting approval', ai_reply: 'AI reply', template_reply: 'Template reply', mark_read: 'Mark as read', from_email: 'Sender email', from_domain: 'Sender domain', from_name: 'Sender name', to_email: 'To address', mailbox_id: 'Email account', ai_calls: 'AI actions', sla_breach: 'SLA missed', followup_drafted: 'Follow-up drafted', triage_draft: 'Analysis & draft', 'triage+draft': 'Analysis & draft', ask_inbox: 'Ask AI', learn_style: 'Style learning', follow_up: 'Follow-up', daily_briefing: 'Daily briefing' };
export const label = (v) => { const t = LABELS[v] || String(v ?? '').replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
export const badge = (v, cls) => (v || v === 0 ? `<span class="badge ${esc(cls || v)}">${esc(label(v))}</span>` : '');
const COLORS = ['#5145e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];
export function avatar(name, email, cls = '') {
  const s = String(name || email || '?').trim();
  const initials = (s.match(/\b\p{L}/gu) || [s[0]]).slice(0, 2).join('');
  let h = 0; for (const c of String(email || s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="avatar ${cls}" style="background:${COLORS[h % COLORS.length]}">${esc(initials)}</span>`;
}
export const lead = (s) => (s == null ? '' : `<span class="lead ${s >= 70 ? 'hot' : ''}" title="Lead score ${s}/100">${s >= 70 ? icon('flame', 'sm') : ''}${s}</span>`);

export function formData(form) {
  const d = Object.fromEntries(new FormData(form));
  $$('input[type=checkbox][name]', form).forEach((c) => { d[c.name] = c.checked; });
  return d;
}

// ---------- Toasts ----------
function stack() { let s = $('.toast-stack'); if (!s) { s = document.createElement('div'); s.className = 'toast-stack'; s.setAttribute('role', 'status'); document.body.appendChild(s); } return s; }
export function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = `toast ${isErr ? 'err' : ''}`;
  t.innerHTML = `${icon(isErr ? 'alert' : 'checkCircle')}<div>${esc(msg)}</div>`;
  stack().appendChild(t);
  setTimeout(() => t.remove(), isErr ? 7000 : 4000);
}

// ---------- API ----------
export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET', credentials: 'same-origin',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && !opts.noRedirect) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.hash)}`; throw new Error('Please sign in'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; e.code = data.code; throw e; }
  return data;
}

/** Bind handlers declared with data-act="name" (CSP forbids inline handlers). */
export function bind(handlers, root) {
  $$('[data-act]', root).forEach((el) => {
    if (el.dataset.bound) return;
    const fn = handlers[el.dataset.act];
    if (!fn) return;
    el.dataset.bound = '1';
    const evt = el.tagName === 'FORM' ? 'submit' : (el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type === 'checkbox')) ? 'change' : 'click';
    el.addEventListener(evt, async (e) => {
      if (evt !== 'change') e.preventDefault();
      e.stopPropagation();
      const btn = el.tagName === 'FORM' ? el.querySelector('button[type=submit], button:not([type])') : el.tagName === 'BUTTON' ? el : null;
      const html = btn?.innerHTML;
      if (btn) { btn.disabled = true; if (el.tagName === 'FORM' || btn.classList.contains('primary')) btn.innerHTML = `<span class="spin"></span>${btn.textContent.trim()}`; }
      try { await fn(el, e); } catch (err) { toast(err.message, true); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = html; } }
    });
  });
}

// ---------- Modal / confirm ----------
export function modal(html, onBind, { wide = false, onClose = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.innerHTML = `<div class="modal card ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="btn ghost sm icon-only modal-x" type="button" aria-label="Close">${icon('x')}</button>${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => { if (!wrap.isConnected) return; wrap.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $('.modal-x', wrap).addEventListener('click', close);
  onBind?.($('.modal', wrap), close);
  $('input, textarea, select', wrap)?.focus();
  return close;
}
export function confirmBox(title, text, { danger = false, ok = 'Confirm', input = null } = {}) {
  return new Promise((resolve) => {
    let result = false;
    modal(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>${input ? `<input id="cf-in" placeholder="${esc(input)}" autocomplete="off">` : ''}
      <div class="row mt" style="justify-content:flex-end"><button class="btn" data-x>Cancel</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${esc(ok)}</button></div>`, (el, c) => {
      $('[data-x]', el).addEventListener('click', () => c());
      $('[data-ok]', el).addEventListener('click', () => { result = input ? $('#cf-in', el).value : true; c(); });
      $('#cf-in', el)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { result = e.target.value; c(); } });
    }, { onClose: () => resolve(result) });
  });
}

// ---------- Charts ----------
export function bars(rows, { fmt = (v) => v, height = 150 } = {}) {
  if (!rows.length || rows.every((r) => !r.value)) return `<div class="empty" style="padding:28px">${icon('chart')}<div>No data yet</div></div>`;
  const max = Math.max(1, ...rows.map((r) => r.value || 0));
  return `<div class="chart" style="height:${height}px">${rows.map((r) => `<div class="colb" title="${esc(r.label)}: ${esc(fmt(r.value))}">
    <i style="height:${Math.max(2, ((r.value || 0) / max) * 100)}%"></i><span>${esc(r.short ?? r.label)}</span></div>`).join('')}</div>`;
}
export function hbars(rows, { fmt = (v) => v, cls = '' } = {}) {
  if (!rows.length) return '<p class="hint">No data yet.</p>';
  const max = Math.max(1, ...rows.map((r) => r.value || 0));
  return rows.map((r) => `<div class="hbar"><span class="truncate" title="${esc(r.label)}">${esc(label(r.label))}</span><div class="bar ${cls}"><i style="width:${((r.value || 0) / max) * 100}%"></i></div><span class="hint" style="text-align:right">${esc(fmt(r.value))}</span></div>`).join('');
}

// ---------- Theme ----------
export function applyTheme(t) {
  const theme = t || localStorageGet('theme') || 'system';
  if (theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme);
  localStorageSet('theme', theme);
  return theme;
}
export function localStorageGet(k) { try { return localStorage.getItem(`mp:${k}`); } catch { return null; } }
export function localStorageSet(k, v) { try { localStorage.setItem(`mp:${k}`, v); } catch { /* private mode */ } }

// ---------- Command palette ----------
export function commandPalette(getItems) {
  let open = false;
  const show = async () => {
    if (open) return;
    open = true;
    const el = document.createElement('div');
    el.className = 'cmdk';
    el.innerHTML = `<div class="cmdk-box"><div class="input-icon">${icon('search')}<input placeholder="Search pages, actions, or emails…" aria-label="Command"></div><div class="cmdk-list"></div></div>`;
    document.body.appendChild(el);
    const input = $('input', el); const list = $('.cmdk-list', el);
    let items = []; let idx = 0;
    const close = () => { el.remove(); open = false; };
    const render = async () => {
      items = await getItems(input.value.trim());
      idx = Math.min(idx, Math.max(0, items.length - 1));
      let group = '';
      list.innerHTML = items.map((it, i) => {
        const g = it.group !== group ? `<div class="cmdk-group">${esc(it.group)}</div>` : '';
        group = it.group;
        return `${g}<div class="cmdk-item ${i === idx ? 'on' : ''}" data-i="${i}">${icon(it.icon || 'chevron')}<span class="truncate">${esc(it.label)}</span>${it.hint ? `<span class="k">${esc(it.hint)}</span>` : ''}</div>`;
      }).join('') || '<div class="empty" style="padding:24px">No results</div>';
      $$('.cmdk-item', list).forEach((x) => x.addEventListener('click', () => { close(); items[Number(x.dataset.i)].run(); }));
    };
    let t;
    input.addEventListener('input', () => { clearTimeout(t); idx = 0; t = setTimeout(render, 120); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); e.preventDefault(); render(); }
      if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); e.preventDefault(); render(); }
      if (e.key === 'Enter' && items[idx]) { close(); items[idx].run(); }
      if (e.key === 'Escape') close();
    });
    el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
    input.focus();
    render();
  };
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); show(); }
  });
  return show;
}

/** Dropdown menu anchored to a button. items: [{label, icon, run, danger}] or 'hr' */
export function dropdown(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = items.map((it, i) => (it === 'hr' ? '<hr>' : it.html ? it.html : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon || 'chevron')}${esc(it.label)}</button>`)).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const left = Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth);
  m.style.left = `${Math.max(8, left + window.scrollX)}px`;
  m.style.top = `${r.bottom + 6 + window.scrollY}px`;
  $$('button[data-i]', m).forEach((b) => b.addEventListener('click', () => { m.remove(); items[Number(b.dataset.i)].run(); }));
  $$('a', m).forEach((a) => a.addEventListener('click', () => m.remove()));
  setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', h); } }), 0);
}

export const empty = (ic, title, text = '', action = '') => `<div class="empty">${icon(ic)}<h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${action}</div>`;
export const csvDownload = (path) => { location.href = `/api${path}`; };
export const switchEl = (name, checked, extra = '') => `<label class="switch" ${extra}><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span></span></label>`;
