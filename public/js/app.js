import { $, $$, esc, icon, api, toast, applyTheme, commandPalette, dropdown, avatar, localStorageGet, ago, label, BRAND } from './ui.js';
import * as home from './views/home.js';
import * as inbox from './views/inbox.js';
import * as crm from './views/crm.js';
import * as setup from './views/setup.js';
import * as account from './views/account.js';
import * as automation from './views/automation.js';

const ctx = { me: null, view: $('#view'), counts: {} };
const MANAGERS = ['owner', 'admin'];

// Sidebar: daily work first, then setup (owners/admins), then settings. Related pages share one entry + tabs.
const NAV = [
  { id: 'dashboard', label: 'Home', icon: 'home' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', count: 'inbox' },
  { id: 'approvals', label: 'Approvals', icon: 'checkCircle', count: 'approvals' },
  { id: 'tasks', label: 'Tasks', icon: 'listCheck', count: 'tasks' },
  { id: 'automation', label: 'Automation Center', icon: 'workflow' },
  { id: 'ask', label: 'Ask AI', icon: 'sparkles' },
  { id: 'contacts', label: 'Contacts & leads', icon: 'users' },
  { id: 'analytics', label: 'Analytics', icon: 'chart' },
  { group: 'Setup', roles: MANAGERS },
  { id: 'mailboxes', label: 'Email accounts', icon: 'mail', roles: MANAGERS },
  { id: 'brain', label: 'AI training', icon: 'brain', roles: MANAGERS },
  { id: 'integrations', label: 'Alerts & API', icon: 'plug', roles: MANAGERS },
  { group: 'Tools' },
  { id: 'declutter', label: 'Declutter', icon: 'archive' },
  { group: 'Account' },
  { id: 'profile', label: 'Settings', icon: 'settings' },
  { id: 'support', label: 'Help & support', icon: 'lifebuoy' },
];
// Pages grouped under one sidebar entry, shown as tabs.
const SECTIONS = {
  brain: [['brain', 'Business & voice', 'wand'], ['knowledge', 'Knowledge base', 'book'], ['templates', 'Templates', 'file']],
  automation: [['automation', 'Live pipeline', 'activity'], ['recipes', 'Recipes', 'sparkles', MANAGERS], ['rules', 'Rules', 'zap', MANAGERS], ['autopilot', 'Autopilot & safety', 'shieldCheck', MANAGERS], ['simulator', 'Test lab', 'flask']],
  profile: [['profile', 'Profile', 'users'], ['team', 'Team', 'users'], ['billing', 'Plan & billing', 'card', MANAGERS], ['security', 'Security & privacy', 'lock'], ['referrals', 'Refer & earn', 'gift']],
};
const PARENT = { message: 'inbox', contact: 'contacts', ticket: 'support' };
for (const [parent, tabs] of Object.entries(SECTIONS)) for (const [id] of tabs) PARENT[id] = parent;
const ROLE_ONLY = { mailboxes: MANAGERS, brain: MANAGERS, knowledge: MANAGERS, templates: MANAGERS, autopilot: MANAGERS, rules: MANAGERS, recipes: MANAGERS, integrations: MANAGERS, billing: MANAGERS };

const ROUTES = {
  dashboard: home.dashboard, ask: home.ask, approvals: home.approvals,
  inbox: inbox.inbox, message: inbox.inbox,
  contacts: crm.contacts, contact: crm.contact, analytics: crm.analytics, declutter: crm.declutter, simulator: crm.simulator,
  mailboxes: setup.mailboxes, brain: setup.brain, autopilot: setup.autopilot, knowledge: setup.knowledge, templates: setup.templates,
  rules: setup.rules, integrations: setup.integrations,
  automation: automation.automation, recipes: automation.recipes, tasks: automation.tasks,
  profile: account.profile, team: account.team, billing: account.billing, security: account.security, referrals: account.referrals, support: account.support, ticket: account.ticket,
};
const allowed = (roles) => !roles || roles.includes(ctx.me?.role);

function renderNav(active) {
  $('#nav').innerHTML = NAV.filter((n) => allowed(n.roles)).map((n) => (n.group ? `<div class="nav-group">${esc(n.group)}</div>`
    : `<a class="nav-link ${active === n.id ? 'on' : ''}" href="#${n.id}">${icon(n.icon)}<span>${esc(n.label)}</span>${n.count && ctx.counts[n.count] ? `<span class="badge ${n.count === 'approvals' ? 'warn' : 'info'}">${ctx.counts[n.count]}</span>` : ''}</a>`)).join('')
    + (ctx.me?.user.is_admin ? `<div class="nav-group">Platform</div><a class="nav-link" href="/admin">${icon('server')}<span>Admin panel</span></a>` : '');
}

function sectionTabs(name) {
  const tabs = SECTIONS[PARENT[name] || name];
  if (!tabs) return '';
  return `<nav class="tabs" aria-label="Section">${tabs.filter((t) => allowed(t[3])).map(([id, l, ic]) => `<a href="#${id}" class="${id === name ? 'on' : ''}">${icon(ic, 'sm')}${esc(l)}</a>`).join('')}</nav>`;
}

async function refreshCounts() {
  try {
    const [q, c, t] = await Promise.all([api('/replies?status=queue'), api('/messages/counts'), api('/tasks/counts')]);
    ctx.counts = { approvals: q.length, inbox: c.unassigned || 0, ...c, tasks: t.open || 0 };
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
  $('#side').classList.remove('open');
  const full = name === 'inbox' || name === 'message';
  $('#content').classList.toggle('full', full);
  $('#banners').hidden = full;
  const keepInbox = full && document.getElementById('inbox-root');
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
  $('#menu-btn').innerHTML = icon('menu');
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
    sw.hidden = false;
    sw.innerHTML = me.workspaces.map((w) => `<option value="${w.id}" ${w.id === me.workspace.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
    sw.addEventListener('change', async () => { await api(`/auth/workspaces/${sw.value}/switch`, { method: 'POST' }); location.hash = 'dashboard'; location.reload(); });
  }
  const plan = me.effectivePlan;
  $('#side-foot').innerHTML = `<div class="usage-mini"><div class="row" style="justify-content:space-between"><b>${esc(plan.name)} plan</b>${MANAGERS.includes(me.role) ? `<a href="#billing">${me.workspace.plan === 'trial' || plan.key === 'expired' ? 'Upgrade' : 'Manage'}</a>` : `<span class="hint">${esc(label(me.role))}</span>`}</div></div>`;
  $('#user-btn').innerHTML = `${avatar(me.user.name, me.user.email, 'sm')}<span class="truncate" style="max-width:140px">${esc(me.user.name || me.user.email)}</span>${icon('chevron', 'sm')}`;
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
  const NOTE_ICON = { sync_error: 'alert', send_failed: 'alert', phishing_blocked: 'shield', sla_breach: 'clock', payment_failed: 'card', followup_drafted: 'reply', draft_created: 'file', auto_reply_sent: 'send', mailbox_added: 'mail', subscription_updated: 'card', assigned: 'userCheck' };
  const bellBadge = (n) => { $('#bell-btn').innerHTML = icon('bell') + (n ? `<span class="badge bad" style="position:absolute;top:2px;right:0;height:17px;padding:0 5px;font-size:10px">${n > 9 ? '9+' : n}</span>` : ''); };
  bellBadge(me.unreadNotifications);
  $('#bell-btn').addEventListener('click', async (e) => {
    const anchor = e.currentTarget;
    const items = await api('/notifications');
    const hrefOf = (n) => {
      let d = {}; try { d = JSON.parse(n.detail || '{}'); } catch { /* plain text */ }
      if (d.message) return `#message?id=${Number(d.message)}`;
      return { sync_error: '#mailboxes', send_failed: '#approvals', payment_failed: '#billing', subscription_updated: '#billing', mailbox_added: '#mailboxes', sla_breach: '#inbox?view=overdue' }[n.type] || '#dashboard';
    };
    const summary = (d) => { try { const x = JSON.parse(d); return [x.subject, x.to || x.from || x.email, x.error].filter(Boolean).join(' — '); } catch { return d || ''; } };
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
