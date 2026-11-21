import { $, $$, esc, icon, api, toast, applyTheme, commandPalette, dropdown, avatar, localStorageGet } from './ui.js';
import * as home from './views/home.js';
import * as inbox from './views/inbox.js';
import * as crm from './views/crm.js';
import * as setup from './views/setup.js';
import * as account from './views/account.js';

const ctx = { me: null, view: $('#view'), counts: {} };

const NAV = [
  { id: 'dashboard', label: 'Home', icon: 'home' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', count: 'inbox' },
  { id: 'approvals', label: 'Approvals', icon: 'checkCircle', count: 'approvals' },
  { id: 'ask', label: 'Ask AI', icon: 'sparkles' },
  { id: 'contacts', label: 'Contacts & leads', icon: 'users' },
  { id: 'analytics', label: 'Analytics', icon: 'chart' },
  { group: 'Automation' },
  { id: 'mailboxes', label: 'Email accounts', icon: 'mail' },
  { id: 'brain', label: 'AI brain', icon: 'brain' },
  { id: 'autopilot', label: 'Autopilot & safety', icon: 'shieldCheck' },
  { id: 'knowledge', label: 'Knowledge base', icon: 'book' },
  { id: 'rules', label: 'Rules', icon: 'zap' },
  { id: 'templates', label: 'Templates', icon: 'file' },
  { id: 'simulator', label: 'Test lab', icon: 'flask' },
  { id: 'declutter', label: 'Declutter', icon: 'archive' },
  { id: 'integrations', label: 'Alerts & API', icon: 'plug' },
  { group: 'Workspace' },
  { id: 'team', label: 'Team', icon: 'users' },
  { id: 'billing', label: 'Plan & billing', icon: 'card' },
  { id: 'security', label: 'Security & privacy', icon: 'lock' },
  { id: 'referrals', label: 'Refer & earn', icon: 'gift' },
  { id: 'support', label: 'Help & support', icon: 'lifebuoy' },
];
const ROUTES = {
  dashboard: home.dashboard, ask: home.ask, approvals: home.approvals,
  inbox: inbox.inbox, message: inbox.inbox,
  contacts: crm.contacts, contact: crm.contact, analytics: crm.analytics, declutter: crm.declutter, simulator: crm.simulator,
  mailboxes: setup.mailboxes, brain: setup.brain, autopilot: setup.autopilot, knowledge: setup.knowledge, templates: setup.templates,
  rules: setup.rules, integrations: setup.integrations,
  team: account.team, billing: account.billing, security: account.security, referrals: account.referrals, support: account.support, ticket: account.ticket,
};
const PARENT = { message: 'inbox', contact: 'contacts', ticket: 'support' };

function renderNav(active) {
  $('#nav').innerHTML = NAV.map((n) => (n.group ? `<div class="nav-group">${esc(n.group)}</div>`
    : `<a class="nav-link ${active === n.id ? 'on' : ''}" href="#${n.id}">${icon(n.icon)}<span>${esc(n.label)}</span>${n.count && ctx.counts[n.count] ? `<span class="badge ${n.count === 'approvals' ? 'warn' : 'info'}">${ctx.counts[n.count]}</span>` : ''}</a>`)).join('')
    + (ctx.me?.user.is_admin ? `<div class="nav-group">Platform</div><a class="nav-link" href="/admin">${icon('server')}<span>Admin panel</span></a>` : '');
}

async function refreshCounts() {
  try {
    const [q, c] = await Promise.all([api('/replies?status=queue'), api('/messages/counts')]);
    ctx.counts = { approvals: q.length, inbox: c.unassigned || 0, ...c };
  } catch { /* ignore */ }
  renderNav(currentRoute().parent);
}

function currentRoute() {
  const [name, qs] = (location.hash.slice(1) || 'dashboard').split('?');
  return { name: ROUTES[name] ? name : 'dashboard', params: Object.fromEntries(new URLSearchParams(qs || '')), parent: PARENT[name] || name };
}

let routeSeq = 0;
export async function route() {
  const { name, params, parent } = currentRoute();
  const seq = ++routeSeq;
  renderNav(parent);
  $('#side').classList.remove('open');
  const full = name === 'inbox' || name === 'message';
  $('#content').classList.toggle('full', full);
  $('#banners').hidden = full;
  const keepInbox = full && document.getElementById('inbox-root');
  if (!keepInbox) ctx.view.innerHTML = '<div class="skeleton" style="height:28px;width:220px;margin-bottom:18px"></div><div class="grid g4">' + '<div class="skeleton" style="height:96px"></div>'.repeat(4) + '</div>';
  document.title = `${NAV.find((n) => n.id === parent)?.label || 'Home'} · MailPilot AI`;
  try {
    await ROUTES[name](ctx, params, name);
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
  $('#menu-btn').innerHTML = icon('menu');
  $('#search-icon').innerHTML = icon('search');
  $('#help-btn').innerHTML = icon('help');
  themeIcon();
  try { await loadMe(); } catch { return; }
  const me = ctx.me;
  $('#ws-name').textContent = me.workspace?.name || '';
  if (me.impersonatedBy) $('#imp').innerHTML = `<div class="imp-bar">Support view: you are signed in as ${esc(me.user.email)}. <a href="#" id="stop-imp">End session</a></div>`;
  const sw = $('#ws-switch');
  if (me.workspaces.length > 1) {
    sw.hidden = false;
    sw.innerHTML = me.workspaces.map((w) => `<option value="${w.id}" ${w.id === me.workspace.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
    sw.addEventListener('change', async () => { await api(`/auth/workspaces/${sw.value}/switch`, { method: 'POST' }); location.hash = 'dashboard'; location.reload(); });
  }
  const plan = me.effectivePlan;
  $('#side-foot').innerHTML = `<div class="usage-mini"><div class="row" style="justify-content:space-between"><b>${esc(plan.name)} plan</b><a href="#billing">${me.workspace.plan === 'trial' || plan.key === 'expired' ? 'Upgrade' : 'Manage'}</a></div></div>`;
  $('#user-btn').innerHTML = `${avatar(me.user.name, me.user.email, 'sm')}<span class="truncate" style="max-width:140px">${esc(me.user.name || me.user.email)}</span>${icon('chevron', 'sm')}`;
  renderBanners();

  const logout = async (e) => { e?.preventDefault?.(); await api('/auth/logout', { method: 'POST' }); location.href = me.impersonatedBy ? '/admin' : '/login'; };
  $('#stop-imp')?.addEventListener('click', logout);
  $('#user-btn').addEventListener('click', (e) => dropdown(e.currentTarget, [
    { html: `<div style="padding:8px 10px"><b>${esc(me.user.name || '')}</b><div class="hint">${esc(me.user.email)}</div></div>` }, 'hr',
    { label: 'Security & privacy', icon: 'lock', run: () => { location.hash = 'security'; } },
    { label: 'Plan & billing', icon: 'card', run: () => { location.hash = 'billing'; } },
    { label: 'Keyboard shortcuts', icon: 'list', run: showShortcuts },
    ...(me.user.is_admin ? [{ label: 'Admin panel', icon: 'server', run: () => { location.href = '/admin'; } }] : []),
    'hr', { label: 'Sign out', icon: 'logout', run: logout },
  ]));
  $('#theme-btn').addEventListener('click', (e) => dropdown(e.currentTarget, [
    { label: 'Light', icon: 'sun', run: () => setTheme('light') }, { label: 'Dark', icon: 'moon', run: () => setTheme('dark') }, { label: 'System', icon: 'monitor', run: () => setTheme('system') },
  ]));
  $('#menu-btn').addEventListener('click', () => $('#side').classList.toggle('open'));

  const palette = commandPalette(async (q) => {
    const ql = q.toLowerCase();
    const pages = NAV.filter((n) => n.id && (!ql || n.label.toLowerCase().includes(ql))).map((n) => ({ group: 'Go to', label: n.label, icon: n.icon, run: () => { location.hash = n.id; } }));
    const actions = [
      { label: 'Connect an email account', icon: 'plus', run: () => { location.hash = 'mailboxes'; } },
      { label: 'Ask AI about my inbox', icon: 'sparkles', run: () => { location.hash = 'ask'; } },
      { label: 'Test how the AI would reply', icon: 'flask', run: () => { location.hash = 'simulator'; } },
      { label: 'Toggle dark mode', icon: 'moon', run: () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark') },
    ].filter((a) => !ql || a.label.toLowerCase().includes(ql)).map((a) => ({ ...a, group: 'Actions' }));
    let mails = [];
    if (q.length >= 2) {
      const [msgs, contacts] = await Promise.all([api(`/messages?view=all&limit=6&q=${encodeURIComponent(q)}`).catch(() => []), api(`/contacts?q=${encodeURIComponent(q)}`).catch(() => [])]);
      mails = [...msgs.map((m) => ({ group: 'Emails', label: `${m.subject || '(no subject)'} — ${m.from_name || m.from_email}`, icon: 'mail', run: () => { location.hash = `message?id=${m.id}`; } })),
        ...contacts.slice(0, 4).map((c) => ({ group: 'Contacts', label: `${c.name || c.email} ${c.company ? `· ${c.company}` : ''}`, icon: 'users', run: () => { location.hash = `contact?id=${c.id}`; } }))];
    }
    return [...mails, ...pages, ...actions];
  });
  $('#search-trigger').addEventListener('click', palette);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === '?') showShortcuts();
    if (e.key === '/') { e.preventDefault(); palette(); }
    if (e.key === 'g') { window.__g = Date.now(); return; }
    if (window.__g && Date.now() - window.__g < 800) {
      const map = { i: 'inbox', h: 'dashboard', a: 'approvals', c: 'contacts' };
      if (map[e.key]) location.hash = map[e.key];
      window.__g = 0;
    }
  });
  window.addEventListener('hashchange', route);
  route();
  setInterval(refreshCounts, 60_000);
}

function setTheme(t) {
  applyTheme(t);
  themeIcon();
  api('/auth/profile', { method: 'PUT', body: { ui_theme: t } }).catch(() => {});
}

function showShortcuts() {
  import('./ui.js').then(({ modal }) => modal(`<h2>Keyboard shortcuts</h2><dl class="kv mt">
    <dt><kbd>Ctrl</kbd> <kbd>K</kbd> / <kbd>/</kbd></dt><dd>Search & command palette</dd>
    <dt><kbd>g</kbd> then <kbd>i</kbd> / <kbd>h</kbd> / <kbd>a</kbd> / <kbd>c</kbd></dt><dd>Go to Inbox / Home / Approvals / Contacts</dd>
    <dt><kbd>j</kbd> / <kbd>k</kbd></dt><dd>Next / previous email (inbox)</dd>
    <dt><kbd>e</kbd></dt><dd>Mark done</dd><dt><kbd>s</kbd></dt><dd>Star</dd><dt><kbd>r</kbd></dt><dd>Focus reply</dd>
    <dt><kbd>?</kbd></dt><dd>This help</dd></dl>`));
}

window.addEventListener('unhandledrejection', (e) => { if (e.reason?.message) toast(e.reason.message, true); });
init();
