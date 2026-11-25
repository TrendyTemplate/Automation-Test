import { $, $$, esc, icon, api, toast, applyTheme, commandPalette, dropdown, avatar, localStorageGet, ago, label, BRAND } from './ui.js';
import * as workspace from './views/workspace.js';
import * as account from './views/account.js';
import * as sales from './views/sales.js';
import * as onboard from './views/onboard.js';
import * as ordersView from './views/orders.js';

const ctx = { me: null, view: $('#view'), counts: {} };
const MANAGERS = ['owner', 'admin'];

// Sidebar: daily work first, then setup (owners/admins), then settings. Related pages share one entry + tabs.
const NAV = [
  { id: 'dashboard', label: 'Home', icon: 'home' },
  { id: 'chats', label: 'Chats', icon: 'chat', count: 'chats' },
  { id: 'orders', label: 'Orders', icon: 'card' },
  { id: 'catalog', label: 'Products', icon: 'layers' },
  { id: 'learning', label: 'Learning', icon: 'sparkles' },
  { id: 'saleslab', label: 'Test chat', icon: 'flask' },
  { sep: true, roles: MANAGERS },
  { id: 'channels', label: 'Channels', icon: 'plug', roles: MANAGERS },
  { id: 'brain', label: 'Assistant', icon: 'brain', roles: MANAGERS },
  { id: 'integrations', label: 'Alerts', icon: 'bell', roles: MANAGERS },
  { foot: true },
  { id: 'profile', label: 'Settings', icon: 'settings' },
  { id: 'support', label: 'Help', icon: 'lifebuoy' },
];
const TABS = ['dashboard', 'chats', 'orders', 'catalog']; // phone bottom bar; everything else lives under "More"
// Pages grouped under one sidebar entry, shown as tabs.
const SECTIONS = {
  brain: [['brain', 'Shop & safety', 'brain'], ['knowledge', 'Knowledge base', 'book'], ['delivery', 'Delivery charges', 'send']],
  profile: [['profile', 'Profile', 'users'], ['team', 'Team', 'users'], ['billing', 'Plan & billing', 'card', MANAGERS], ['security', 'Security & privacy', 'lock'], ['referrals', 'Refer & earn', 'gift']],
};
const PARENT = { chat: 'chats', ticket: 'support', invoice: 'orders' };
for (const [parent, tabs] of Object.entries(SECTIONS)) for (const [id] of tabs) PARENT[id] = parent;
const ROLE_ONLY = { channels: MANAGERS, brain: MANAGERS, knowledge: MANAGERS, delivery: MANAGERS, integrations: MANAGERS, billing: MANAGERS };

const ROUTES = {
  dashboard: workspace.dashboard, brain: workspace.brain, knowledge: workspace.knowledge, integrations: workspace.integrations,
  welcome: onboard.welcome, learning: onboard.learning,
  chats: sales.chats, chat: (c, p) => sales.chats(c, p), orders: ordersView.orders, invoice: ordersView.invoice, delivery: ordersView.delivery, catalog: sales.catalog, channels: sales.channels, saleslab: sales.saleslab,
  profile: account.profile, team: account.team, billing: account.billing, security: account.security, referrals: account.referrals, support: account.support, ticket: account.ticket,
};
const allowed = (roles) => !roles || roles.includes(ctx.me?.role);

function renderNav(active) {
  const items = NAV.filter((n) => allowed(n.roles));
  const link = (n) => `<a class="rail-link ${active === n.id ? 'on' : ''}" href="#${n.id}" title="${esc(n.label)}">${icon(n.icon)}<span>${esc(n.label)}</span>${n.count && ctx.counts[n.count] ? `<span class="dot">${ctx.counts[n.count] > 99 ? '99+' : ctx.counts[n.count]}</span>` : ''}</a>`;
  const footAt = items.findIndex((n) => n.foot);
  $('#nav').innerHTML = items.slice(0, footAt).map((n) => (n.sep ? '<div class="rail-sep"></div>' : link(n))).join('');
  $('#rail-foot').innerHTML = items.slice(footAt + 1).map(link).join('')
    + (ctx.me?.user.is_admin ? `<a class="rail-link" href="/admin" title="Admin panel">${icon('server')}<span>Admin</span></a>` : '');
  const tab = (id) => { const n = NAV.find((x) => x.id === id); return `<a href="#${id}" class="${active === id ? 'on' : ''}">${icon(n.icon)}<span>${esc(n.label)}</span>${n.count && ctx.counts[n.count] ? `<span class="dot">${ctx.counts[n.count]}</span>` : ''}</a>`; };
  const more = !TABS.includes(active);
  $('#tabbar').innerHTML = TABS.map(tab).join('') + `<button type="button" id="more-btn" class="${more ? 'on' : ''}">${icon('menu')}<span>More</span></button>`;
  $('#more-btn').addEventListener('click', openMore);
}

function openMore() {
  const items = NAV.filter((n) => n.id && !TABS.includes(n.id) && allowed(n.roles));
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-label="More"><div class="sheet-grid">${items.map((n) => `<a href="#${n.id}">${icon(n.icon)}<span>${esc(n.label)}</span></a>`).join('')}
    ${ctx.me?.user.is_admin ? `<a href="/admin">${icon('server')}<span>Admin</span></a>` : ''}<a href="#" data-x="theme">${icon('moon')}<span>Theme</span></a></div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => {
    if (e.target === bg || e.target.closest('a[href^="#"]:not([data-x])') || e.target.closest('a[href="/admin"]')) close();
    if (e.target.closest('[data-x=theme]')) { e.preventDefault(); close(); setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
  });
}

function sectionTabs(name) {
  const tabs = SECTIONS[PARENT[name] || name];
  if (!tabs) return '';
  return `<nav class="tabs" aria-label="Section">${tabs.filter((t) => allowed(t[3])).map(([id, l, ic]) => `<a href="#${id}" class="${id === name ? 'on' : ''}">${icon(ic, 'sm')}${esc(l)}</a>`).join('')}</nav>`;
}

async function refreshCounts() {
  try {
    const s = await api('/sales/overview');
    ctx.counts = { chats: (s.needsHuman || 0) + (s.drafts || 0) };
  } catch { /* ignore */ }
  renderNav(currentRoute().parent);
}

function currentRoute() {
  const [name, qs] = (location.hash.slice(1) || 'dashboard').split('?');
  const n = ROUTES[name] ? name : 'dashboard';
  return { name: n, params: Object.fromEntries(new URLSearchParams(qs || '')), parent: PARENT[n] || n };
}

let routeSeq = 0;
export async function route() {
  const { name, params, parent } = currentRoute();
  const seq = ++routeSeq;
  renderNav(parent);
  const full = name === 'chats' || name === 'chat';
  $('#content').classList.toggle('full', full);
  $('#banners').hidden = full;
  const keepInbox = false;
  if (!keepInbox) ctx.view.innerHTML = '<div class="skeleton" style="height:28px;width:220px;margin-bottom:18px"></div><div class="grid g4">' + '<div class="skeleton" style="height:96px"></div>'.repeat(4) + '</div>';
  const tab = Object.values(SECTIONS).flat().find((t) => t[0] === name);
  document.title = `${tab?.[1] || NAV.find((n) => n.id === parent)?.label || 'Home'} · ${BRAND}`;
  try {
    if (!allowed(ROLE_ONLY[name])) {
      ctx.view.innerHTML = `<div class="card">${(await import('./ui.js')).empty('lock', 'Owners and admins only', 'Ask the workspace owner if you need changes here.')}</div>`;
    } else {
      await ROUTES[name](ctx, params, name);
      if (seq === routeSeq && SECTIONS[parent]) {
        const h = ctx.view.querySelector('.page-h');
        (h || ctx.view.firstElementChild)?.insertAdjacentHTML(h ? 'afterend' : 'beforebegin', sectionTabs(name));
      }
    }
  } catch (e) {
    if (seq === routeSeq) ctx.view.innerHTML = `<div class="callout bad">${icon('alert')}<div>${esc(e.message)}</div></div>`;
  }
  if (!full) window.scrollTo(0, 0);
  if (!keepInbox) refreshCounts();
}
ctx.route = route;
ctx.refreshCounts = refreshCounts;

export async function loadMe() {
  ctx.me = await api('/auth/me');
  return ctx.me;
}
ctx.loadMe = loadMe;

function renderBanners() {
  const me = ctx.me;
  const b = [];
  for (const a of me.announcements) b.push(`<div class="ann ${esc(a.level)}">${esc(a.message)}</div>`);
  if (me.adminNeeds2fa) b.push(`<div class="callout warn">${icon('lock')}<div>As a platform admin you must <a href="#security">turn on two-factor authentication</a> before using the admin panel.</div></div>`);
  const ep = me.effectivePlan;
  if (ep.key === 'expired') b.push(`<div class="callout bad">${icon('alert')}<div>${ep.suspended ? 'This workspace is suspended. Please contact support.' : 'Your trial or subscription has ended — automation is paused. <a href="#billing">Choose a plan</a> to resume.'}</div></div>`);
  else if (me.workspace.plan === 'trial') {
    const days = Math.max(0, Math.ceil((new Date(me.workspace.trial_ends_at) - Date.now()) / 86400_000));
    b.push(`<div class="callout primary">${icon('sparkles')}<div><b>Free trial:</b> ${days} day${days === 1 ? '' : 's'} left. <a href="#billing">See plans</a></div></div>`);
  }
  $('#banners').innerHTML = b.join('');
}

function themeIcon() {
  const t = localStorageGet('theme') || 'system';
  $('#theme-btn').innerHTML = icon(t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'monitor');
}

async function init() {
  applyTheme();
  $('#brand-mark').innerHTML = icon('logo');
  $('#search-icon').innerHTML = icon('search');
  $('#help-btn').innerHTML = icon('help');
  themeIcon();
  try { await loadMe(); } catch { return; }
  // An invitation link opened before signing in (or via Google/Microsoft sign-in) is accepted now.
  const pendingInvite = localStorageGet('invite');
  if (pendingInvite) {
    (await import('./ui.js')).localStorageSet('invite', '');
    try { await api('/auth/invites/accept', { method: 'POST', body: { token: pendingInvite } }); toast('Invitation accepted — welcome to the team!'); await loadMe(); } catch (e) { toast(e.message, true); }
  }
  const me = ctx.me;
  $('#ws-name').textContent = me.workspace?.name || '';
  if (me.impersonatedBy) $('#imp').innerHTML = `<div class="imp-bar">Support view: you are signed in as ${esc(me.user.email)}. <a href="#" id="stop-imp">End session</a></div>`;
  const sw = $('#ws-switch');
  if (me.workspaces.length > 1) {
    sw.hidden = false; $('#ws-name').hidden = true;
    sw.innerHTML = me.workspaces.map((w) => `<option value="${w.id}" ${w.id === me.workspace.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
    sw.addEventListener('change', async () => { await api(`/auth/workspaces/${sw.value}/switch`, { method: 'POST' }); location.hash = 'dashboard'; location.reload(); });
  }
  const plan = me.effectivePlan;
  const pill = $('#plan-pill');
  pill.textContent = me.workspace.plan === 'trial' && plan.key !== 'expired' ? `Trial · ${Math.max(0, Math.ceil((new Date(me.workspace.trial_ends_at) - Date.now()) / 86400_000))}d left` : plan.key === 'expired' ? 'Plan expired' : plan.name;
  if (!MANAGERS.includes(me.role)) pill.removeAttribute('href');
  $('#user-btn').innerHTML = avatar(me.user.name, me.user.email, 'sm');
  renderBanners();

  const logout = async (e) => { e?.preventDefault?.(); await api('/auth/logout', { method: 'POST' }); location.href = me.impersonatedBy ? '/admin' : '/login'; };
  $('#stop-imp')?.addEventListener('click', logout);
  $('#user-btn').addEventListener('click', (e) => dropdown(e.currentTarget, [
    { html: `<div style="padding:8px 10px"><b>${esc(me.user.name || '')}</b><div class="hint">${esc(me.user.email)}</div></div>` }, 'hr',
    { label: 'Profile', icon: 'users', run: () => { location.hash = 'profile'; } },
    { label: 'Security & privacy', icon: 'lock', run: () => { location.hash = 'security'; } },
    ...(MANAGERS.includes(me.role) ? [{ label: 'Plan & billing', icon: 'card', run: () => { location.hash = 'billing'; } }] : []),
    { label: 'Keyboard shortcuts', icon: 'list', run: showShortcuts },
    ...(me.user.is_admin ? [{ label: 'Admin panel', icon: 'server', run: () => { location.href = '/admin'; } }] : []),
    'hr', { label: 'Sign out', icon: 'logout', run: logout },
  ]));
  const NOTE_ICON = { send_failed: 'alert', payment_failed: 'card', subscription_updated: 'card', order_created: 'card', chat_handoff: 'userCheck', chat_draft: 'file', channel_added: 'plug' };
  const bellBadge = (n) => { $('#bell-btn').innerHTML = icon('bell') + (n ? `<span class="badge bad" style="position:absolute;top:2px;right:0;height:17px;padding:0 5px;font-size:10px">${n > 9 ? '9+' : n}</span>` : ''); };
  bellBadge(me.unreadNotifications);
  $('#bell-btn').addEventListener('click', async (e) => {
    const anchor = e.currentTarget;
    const items = await api('/notifications');
    const hrefOf = (n) => {
      let d = {}; try { d = JSON.parse(n.detail || '{}'); } catch { /* plain text */ }
      if (d.conversation) return `#chats?id=${Number(d.conversation)}`;
      return { order_created: '#orders', payment_failed: '#billing', subscription_updated: '#billing', channel_added: '#channels', send_failed: '#channels' }[n.type] || '#dashboard';
    };
    const summary = (d) => { try { const x = JSON.parse(d); return [x.from || x.to || x.name, x.total != null && `${x.currency || ''} ${x.total}`, x.error].filter(Boolean).join(' — '); } catch { return d || ''; } };
    dropdown(anchor, [
      { html: '<div style="padding:8px 10px"><b>Notifications</b></div>' }, 'hr',
      ...(items.length ? items.slice(0, 12).map((n) => ({ html: `<a href="${hrefOf(n)}" style="align-items:flex-start;${n.unread ? 'background:var(--primary-soft)' : ''}">${icon(NOTE_ICON[n.type] || 'activity', 'sm')}<span style="min-width:0"><b>${esc(label(n.type))}</b><span class="hint" style="display:block;max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(summary(n.detail))}</span><span class="hint small">${ago(n.created_at)}</span></span></a>` }))
        : [{ html: '<div class="hint" style="padding:14px 10px">You\'re all caught up.</div>' }]),
    ]);
    api('/notifications/seen', { method: 'POST' }).then(() => bellBadge(0)).catch(() => {});
  });
  $('#theme-btn').addEventListener('click', (e) => dropdown(e.currentTarget, [
    { label: 'Light', icon: 'sun', run: () => setTheme('light') }, { label: 'Dark', icon: 'moon', run: () => setTheme('dark') }, { label: 'System', icon: 'monitor', run: () => setTheme('system') },
  ]));

  const palette = commandPalette(async (q) => {
    const ql = q.toLowerCase();
    const pages = NAV.filter((n) => n.id && (!ql || n.label.toLowerCase().includes(ql))).map((n) => ({ group: 'Go to', label: n.label, icon: n.icon, run: () => { location.hash = n.id; } }));
    const actions = [
      { label: 'Test how the assistant would answer', icon: 'flask', run: () => { location.hash = 'saleslab'; } },
      { label: 'Connect Messenger / Instagram / WhatsApp', icon: 'chat', run: () => { location.hash = 'channels'; } },
      { label: 'Add products for the sales assistant', icon: 'layers', run: () => { location.hash = 'catalog'; } },
      { label: 'Toggle dark mode', icon: 'moon', run: () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark') },
    ].filter((a) => !ql || a.label.toLowerCase().includes(ql)).map((a) => ({ ...a, group: 'Actions' }));
    let chats = [];
    if (q.length >= 2) {
      const list = await api(`/sales/conversations?limit=8&q=${encodeURIComponent(q)}`).catch(() => []);
      chats = list.map((c) => ({ group: 'Customers', label: `${c.customer_name || c.customer_id} — ${c.intent || c.last_body || ''}`, icon: 'chat', run: () => { location.hash = `chats?id=${c.id}`; } }));
    }
    return [...chats, ...pages, ...actions];
  });
  $('#search-trigger').addEventListener('click', palette);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === '?') showShortcuts();
    if (e.key === '/') { e.preventDefault(); palette(); }
    if (e.key === 'g') { window.__g = Date.now(); return; }
    if (window.__g && Date.now() - window.__g < 800) {
      const map = { c: 'chats', h: 'dashboard', o: 'orders', p: 'catalog' };
      if (map[e.key]) location.hash = map[e.key];
      window.__g = 0;
    }
  });
  window.addEventListener('hashchange', route);
  route();
  startLive();
  setInterval(refreshCounts, 60_000);
}

// ---------- Live updates: new messages, drafts, orders appear without reloading ----------
let liveTimer = null;
function startLive() {
  if (!window.EventSource) { setInterval(liveRefresh, 15_000); return; }
  const es = new EventSource('/api/sales/stream');
  const on = (type, fn) => es.addEventListener(type, (e) => { let d = {}; try { d = JSON.parse(e.data); } catch { /* ignore */ } fn(d); });
  on('message', (d) => { if (d.direction === 'in') alertNew('New customer message'); liveRefresh(); });
  on('handoff', () => { alertNew('A customer needs you'); liveRefresh(); });
  on('order', () => { alertNew('New order 🛒'); liveRefresh(); });
  for (const t of ['draft', 'conversation', 'note']) on(t, liveRefresh);
}
function liveRefresh() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    refreshCounts();
    const { name } = currentRoute();
    const typing = document.activeElement?.matches('textarea, input') && document.activeElement.value;
    const modalOpen = document.querySelector('.modal-bg');
    if (['chats', 'chat', 'orders', 'dashboard'].includes(name) && !typing && !modalOpen) route();
  }, 400);
}
let audioCtx = null;
function alertNew(text) {
  if (!document.hidden) return;
  try { // short "ding" (no audio file needed)
    audioCtx ||= new AudioContext();
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.15, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.4);
  } catch { /* autoplay blocked */ }
  if (window.Notification?.permission === 'granted') { try { new Notification(text, { icon: '/favicon.svg', tag: 'chatpilot' }); } catch { /* not allowed */ } }
  document.title = `● ${document.title.replace(/^● /, '')}`;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = document.title.replace(/^● /, ''); });

function setTheme(t) {
  applyTheme(t);
  themeIcon();
  api('/auth/profile', { method: 'PUT', body: { ui_theme: t } }).catch(() => {});
}

function showShortcuts() {
  import('./ui.js').then(({ modal }) => modal(`<h2>Keyboard shortcuts</h2><dl class="kv mt">
    <dt><kbd>Ctrl</kbd> <kbd>K</kbd> / <kbd>/</kbd></dt><dd>Search & command palette</dd>
    <dt><kbd>g</kbd> then <kbd>c</kbd> / <kbd>h</kbd> / <kbd>o</kbd> / <kbd>p</kbd></dt><dd>Go to Conversations / Home / Orders / Products</dd>
    <dt><kbd>?</kbd></dt><dd>This help</dd></dl>`));
}

window.addEventListener('unhandledrejection', (e) => { if (e.reason?.message) toast(e.reason.message, true); });
init();
