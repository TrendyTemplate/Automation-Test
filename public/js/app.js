const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => (d ? new Date(d.endsWith('Z') || d.includes('T') ? d : `${d}Z`).toLocaleString() : '—');
const badge = (v) => (v ? `<span class="badge ${esc(v)}">${esc(String(v).replace(/_/g, ' '))}</span>` : '');
let me = null;

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { location.href = '/login'; throw new Error('Not signed in'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = `toast ${isErr ? 'err' : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// Bind click handlers declared as data-act="name" (CSP forbids inline handlers).
function bind(handlers, root = view) {
  root.querySelectorAll('[data-act]').forEach((el) => {
    const fn = handlers[el.dataset.act];
    if (fn) el.addEventListener(el.tagName === 'FORM' ? 'submit' : 'click', async (e) => {
      e.preventDefault();
      if (el.tagName === 'BUTTON') el.disabled = true;
      try { await fn(el, e); } catch (err) { toast(err.message, true); } finally { if (el.tagName === 'BUTTON') el.disabled = false; }
    });
  });
}
const formData = (form) => Object.fromEntries(new FormData(form));

// ---------------- Views ----------------
const views = {};

views.dashboard = async () => {
  const d = await api('/dashboard');
  const c = d.counts;
  const pct = Math.min(100, Math.round((d.usage.ai_replies / Math.max(1, d.plan.aiRepliesPerMonth)) * 100));
  const max = Math.max(1, ...d.daily.map((x) => x.received));
  view.innerHTML = `
    <h1>Dashboard</h1>
    ${!d.aiEnabled ? '<div class="banner">AI is not configured on this server yet (ANTHROPIC_API_KEY). Emails are sorted with basic keyword rules only.</div>' : ''}
    ${d.mailboxes === 0 ? '<div class="banner">👋 Start by <a href="#mailboxes">connecting your first email account</a>, then <a href="#settings">describe your business</a> so the AI can reply accurately.</div>' : ''}
    <div class="grid g4">
      <div class="card stat"><div class="n">${c.total || 0}</div><div class="l">Emails processed</div></div>
      <div class="card stat"><div class="n">${c.last24h || 0}</div><div class="l">Last 24 hours</div></div>
      <div class="card stat"><div class="n">${c.replied || 0}</div><div class="l">Replied</div></div>
      <div class="card stat"><div class="n">${c.awaiting_approval || 0}</div><div class="l">Awaiting approval</div></div>
      <div class="card stat"><div class="n">${c.urgent || 0}</div><div class="l">Urgent</div></div>
      <div class="card stat"><div class="n">${(d.minutesSaved / 60).toFixed(1)}h</div><div class="l">Time saved (est.)</div></div>
    </div>
    <div class="split" style="margin-top:16px">
      <div class="card">
        <h3>Last 14 days</h3>
        ${d.daily.length ? d.daily.map((x) => `<div class="row" style="margin:6px 0"><span class="hint" style="width:86px">${x.day}</span>
          <div class="bar" style="flex:1"><i style="width:${(x.received / max) * 100}%"></i></div><span style="width:70px;text-align:right">${x.received} / ${x.replied || 0}↩</span></div>`).join('') : '<p class="hint">No emails yet.</p>'}
      </div>
      <div class="card">
        <h3>Categories (30 days)</h3>
        ${d.byCategory.length ? d.byCategory.map((x) => `<div class="row" style="margin:6px 0">${badge(x.category)}<span class="spacer"></span>${x.n}</div>`).join('') : '<p class="hint">No data yet.</p>'}
      </div>
      <div class="card">
        <h3>Plan usage — ${esc(d.plan.name)}</h3>
        <p class="hint">AI replies this month: ${d.usage.ai_replies} / ${d.plan.aiRepliesPerMonth}</p>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <p class="hint">Emails sent: ${d.usage.emails_sent} · Email accounts: ${d.mailboxes} / ${d.plan.mailboxes}</p>
      </div>
      <div class="card">
        <h3>Recent activity</h3>
        ${d.activity.map((a) => `<div class="hint" style="margin:4px 0">${fmtDate(a.created_at)} · <b>${esc(a.type.replace(/_/g, ' '))}</b> ${esc(summarize(a.detail))}</div>`).join('') || '<p class="hint">Nothing yet.</p>'}
      </div>
    </div>`;
};
function summarize(detail) {
  try { const d = JSON.parse(detail); return [d.to || d.from || d.email, d.subject, d.error].filter(Boolean).join(' — '); } catch { return detail || ''; }
}

views.inbox = async (params) => {
  const mailboxes = await api('/mailboxes');
  const q = new URLSearchParams(params);
  const msgs = await api(`/messages?${q}`);
  const opt = (name, values, cur) => `<select name="${name}"><option value="">All ${name.replace('_id', '')}</option>${values.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  view.innerHTML = `
    <h1>Unified inbox</h1>
    <form class="row card" data-act="filter" style="margin-bottom:16px">
      <input name="q" placeholder="Search subject, sender, summary…" value="${esc(params.q || '')}" style="flex:2;min-width:180px">
      ${opt('mailbox_id', mailboxes.map((m) => [m.id, m.email]), params.mailbox_id)}
      ${opt('status', ['new', 'triaged', 'drafted', 'replied', 'ignored', 'error'].map((s) => [s, s]), params.status)}
      ${opt('priority', ['urgent', 'high', 'normal', 'low'].map((s) => [s, s]), params.priority)}
      <button class="btn">Filter</button>
    </form>
    <div class="card table-wrap"><table>
      <thead><tr><th>From</th><th>Subject / AI summary</th><th>Category</th><th>Priority</th><th>Status</th><th>Received</th></tr></thead>
      <tbody>${msgs.map((m) => `<tr class="click" data-id="${m.id}">
        <td><b>${esc(m.from_name || m.from_email)}</b><div class="hint">${esc(m.from_email)}</div><div class="hint">→ ${esc(m.mailbox_email)}</div></td>
        <td><b>${esc(m.subject)}</b><div class="hint">${esc(m.summary || '')}</div></td>
        <td>${badge(m.category)}</td><td>${badge(m.priority)}</td><td>${badge(m.status)}</td>
        <td class="hint">${fmtDate(m.received_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="hint">No emails yet. New mail is checked every couple of minutes.</td></tr>'}
      </tbody></table></div>`;
  bind({ filter: (f) => { const p = new URLSearchParams(Object.entries(formData(f)).filter(([, v]) => v)); location.hash = `inbox?${p}`; } });
  view.querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', () => { location.hash = `message?id=${tr.dataset.id}`; }));
};

views.message = async ({ id }) => {
  const m = await api(`/messages/${id}`);
  const pending = m.replies.find((r) => ['pending', 'failed'].includes(r.status));
  view.innerHTML = `
    <a href="#inbox">← Back to inbox</a>
    <h1 style="margin-top:10px">${esc(m.subject || '(no subject)')}</h1>
    <div class="row" style="margin-bottom:12px">${badge(m.category)} ${badge(m.priority)} ${badge(m.sentiment)} ${badge(m.status)} ${m.language ? badge(m.language) : ''}
      ${m.confidence != null ? `<span class="hint">AI confidence ${(m.confidence * 100).toFixed(0)}%</span>` : ''}</div>
    <div class="split">
      <div class="card">
        <p><b>${esc(m.from_name)}</b> &lt;${esc(m.from_email)}&gt;<br><span class="hint">to ${esc(m.mailbox_email)} · ${fmtDate(m.received_at)}</span></p>
        ${m.summary ? `<p class="banner">AI summary: ${esc(m.summary)}</p>` : ''}
        <pre class="mail">${esc(m.text_body)}</pre>
      </div>
      <div class="card">
        <h3>Reply</h3>
        ${m.replies.filter((r) => r.status === 'sent').map((r) => `<div class="banner">Sent ${fmtDate(r.sent_at)} (${r.source}):<pre class="mail">${esc(r.body)}</pre></div>`).join('')}
        ${pending?.error ? `<p class="hint">⚠ ${esc(pending.error)}</p>` : ''}
        <form data-act="send">
          <label>Subject</label><input name="subject" value="${esc(pending?.subject || `Re: ${m.subject || ''}`)}">
          <label>Message</label><textarea name="body" style="min-height:220px">${esc(pending?.body || '')}</textarea>
          <div class="row" style="margin-top:12px">
            <button class="btn primary">${pending ? 'Approve & send' : 'Send reply'}</button>
            ${pending ? '<button class="btn" type="button" data-act="reject">Discard draft</button>' : ''}
          </div>
        </form>
        <form data-act="redraft" style="margin-top:18px">
          <label>Ask AI to (re)write the reply</label>
          <div class="row"><input name="instructions" placeholder="e.g. offer a 10% discount, keep it short" style="flex:1"><button class="btn">✨ Draft</button></div>
        </form>
      </div>
    </div>`;
  bind({
    send: async (f) => {
      const d = formData(f);
      if (!d.body.trim()) throw new Error('Write a message first');
      if (pending) await api(`/replies/${pending.id}/approve`, { method: 'POST', body: d });
      else await api(`/messages/${m.id}/reply`, { method: 'POST', body: d });
      toast('Reply sent'); route();
    },
    reject: async () => { await api(`/replies/${pending.id}/reject`, { method: 'POST' }); toast('Draft discarded'); route(); },
    redraft: async (f) => {
      if (pending) await api(`/replies/${pending.id}/reject`, { method: 'POST' });
      await api(`/messages/${m.id}/draft`, { method: 'POST', body: formData(f) });
      toast('New draft ready'); route();
    },
  });
};

views.approvals = async () => {
  const list = await api('/replies?status=pending');
  view.innerHTML = `
    <h1>Approval queue</h1>
    <p class="hint">AI-drafted replies waiting for a human. Edit if needed, then send with one click.</p>
    ${list.map((r) => `
      <div class="card" style="margin-bottom:14px">
        <div class="row"><b>${esc(r.from_name || r.from_email)}</b><span class="hint">${esc(r.from_email)} → ${esc(r.mailbox_email)}</span><span class="spacer"></span>${badge(r.category)} ${badge(r.priority)}</div>
        <p style="margin:6px 0"><b>${esc(r.original_subject)}</b> — <span class="hint">${esc(r.summary || '')}</span></p>
        ${r.error ? `<p class="hint">⚠ ${esc(r.error)}</p>` : ''}
        <details><summary class="hint">Show original email</summary><pre class="mail">${esc(r.original_body)}</pre></details>
        <form data-act="approve" data-id="${r.id}">
          <input type="hidden" name="subject" value="${esc(r.subject)}">
          <textarea name="body" style="margin-top:10px">${esc(r.body)}</textarea>
          <div class="row" style="margin-top:10px">
            <button class="btn primary">Approve & send</button>
            <button class="btn" type="button" data-act="reject" data-id="${r.id}">Discard</button>
            <a class="btn" href="#message?id=${r.message_id}">Open</a>
          </div>
        </form>
      </div>`).join('') || '<div class="card hint">🎉 Nothing waiting for approval.</div>'}`;
  bind({
    approve: async (f) => { await api(`/replies/${f.dataset.id}/approve`, { method: 'POST', body: formData(f) }); toast('Sent'); route(); },
    reject: async (b) => { await api(`/replies/${b.dataset.id}/reject`, { method: 'POST' }); route(); },
  });
};

views.mailboxes = async () => {
  const [list, providers] = await Promise.all([api('/mailboxes'), api('/providers')]);
  view.innerHTML = `
    <h1>Email accounts</h1>
    <div class="card table-wrap" style="margin-bottom:16px"><table>
      <thead><tr><th>Account</th><th>Mode</th><th>Status</th><th>Last check</th><th></th></tr></thead>
      <tbody>${list.map((m) => `<tr>
        <td><b>${esc(m.email)}</b><div class="hint">${esc(m.label || providers[m.provider]?.name || m.provider)}</div></td>
        <td><select data-mode="${m.id}">${['off', 'draft', 'auto'].map((x) => `<option value="${x}" ${m.mode === x ? 'selected' : ''}>${{ off: 'Off (sort only)', draft: 'Draft (I approve)', auto: 'Auto-pilot' }[x]}</option>`).join('')}</select></td>
        <td>${m.last_error ? `<span class="badge error" title="${esc(m.last_error)}">error</span><div class="hint">${esc(m.last_error).slice(0, 120)}</div>` : m.enabled ? badge('active') : badge('paused')}</td>
        <td class="hint">${fmtDate(m.last_sync_at)}</td>
        <td class="row"><button class="btn sm" data-act="sync" data-id="${m.id}">Check now</button>
          <button class="btn sm" data-act="toggle" data-id="${m.id}" data-en="${m.enabled}">${m.enabled ? 'Pause' : 'Resume'}</button>
          <button class="btn sm danger" data-act="del" data-id="${m.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="5" class="hint">No accounts connected yet.</td></tr>'}
      </tbody></table></div>
    <div class="card">
      <h3>Connect an email account</h3>
      <form data-act="add">
        <div class="grid g2">
          <div><label>Provider</label><select name="provider" id="provider">${Object.entries(providers).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('')}</select>
            <p class="hint" id="provider-help"></p></div>
          <div><label>Display name (optional)</label><input name="label" placeholder="Support team"></div>
          <div><label>Email address</label><input name="email" type="email" required></div>
          <div><label>Password / App password</label><input name="password" type="password" required></div>
        </div>
        <div id="custom-fields" class="grid g2" hidden>
          <div><label>IMAP host</label><input name="imap_host" placeholder="mail.yourdomain.com"></div>
          <div><label>IMAP port</label><input name="imap_port" value="993"></div>
          <div><label>SMTP host</label><input name="smtp_host" placeholder="mail.yourdomain.com"></div>
          <div><label>SMTP port</label><input name="smtp_port" value="465"></div>
          <div><label>Username (if different from email)</label><input name="username"></div>
        </div>
        <label>Reply mode</label>
        <select name="mode"><option value="draft">Draft — AI writes, I approve (recommended to start)</option><option value="auto">Auto-pilot — AI sends when confident</option><option value="off">Off — just sort and summarize</option></select>
        <button class="btn primary" style="margin-top:14px">Test & connect</button>
      </form>
    </div>`;
  const sel = $('#provider');
  const upd = () => { $('#provider-help').textContent = providers[sel.value].help; $('#custom-fields').hidden = sel.value !== 'custom'; };
  sel.addEventListener('change', upd); upd();
  view.querySelectorAll('[data-mode]').forEach((s) => s.addEventListener('change', async () => {
    try { await api(`/mailboxes/${s.dataset.mode}`, { method: 'PATCH', body: { mode: s.value } }); toast('Mode updated'); } catch (e) { toast(e.message, true); }
  }));
  bind({
    add: async (f) => { toast('Testing connection…'); await api('/mailboxes', { method: 'POST', body: formData(f) }); toast('Connected! Fetching recent emails…'); route(); },
    sync: async (b) => { const r = await api(`/mailboxes/${b.dataset.id}/sync`, { method: 'POST' }); toast(r.error ? `Error: ${r.error}` : `Checked: ${r.stored ?? 0} new`, Boolean(r.error)); route(); },
    toggle: async (b) => { await api(`/mailboxes/${b.dataset.id}`, { method: 'PATCH', body: { enabled: b.dataset.en !== '1' } }); route(); },
    del: async (b) => { if (confirm('Remove this account and its stored emails?')) { await api(`/mailboxes/${b.dataset.id}`, { method: 'DELETE' }); route(); } },
  });
};

views.rules = async () => {
  const [rules, meta, templates] = await Promise.all([api('/rules'), api('/rules/meta'), api('/templates')]);
  const describe = (r) => `${r.conditions.items.map((c) => `${c.field} ${c.op.replace('_', ' ')} "${c.value}"`).join(r.conditions.match === 'any' ? ' OR ' : ' AND ') || 'every email'} → ${r.actions.map((a) => a.type.replace('_', ' ') + (a.to ? ` ${a.to}` : '') + (a.mode ? ` (${a.mode})` : '')).join(', ')}`;
  view.innerHTML = `
    <h1>Automation rules</h1>
    <p class="hint">Rules run top to bottom on every new email. Without a matching rule, the account's reply mode decides what happens.</p>
    <div class="card" style="margin-bottom:16px">${rules.map((r) => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--border)">
      <b>${esc(r.name)}</b><span class="hint" style="flex:1">${esc(describe(r))}</span>${r.enabled ? badge('active') : badge('off')}
      <button class="btn sm danger" data-act="del" data-id="${r.id}">Delete</button></div>`).join('') || '<p class="hint">No rules yet.</p>'}</div>
    <div class="card">
      <h3>New rule</h3>
      <form data-act="add">
        <label>Name</label><input name="name" required placeholder="Complaints go to manager">
        <label>When</label>
        <div class="row"><select name="field" style="flex:1">${meta.fields.map((f) => `<option>${f}</option>`).join('')}</select>
          <select name="op" style="flex:1">${meta.ops.map((o) => `<option>${o}</option>`).join('')}</select>
          <input name="value" style="flex:2" placeholder="value, e.g. complaint or @bigclient.com"></div>
        <p class="hint">Categories: ${meta.categories.join(', ')}</p>
        <label>Then</label>
        <div class="row"><select name="action" id="act-type" style="flex:1">${meta.actions.map((a) => `<option>${a}</option>`).join('')}</select>
          <select name="mode" style="flex:1"><option value="">use account mode</option><option value="draft">draft</option><option value="auto">auto-send</option></select>
          <input name="param" id="act-param" style="flex:2" placeholder="extra AI instructions / forward email / webhook URL"></div>
        <select name="template_id" id="tpl" hidden>${templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
        <button class="btn primary" style="margin-top:14px">Save rule</button>
      </form>
    </div>`;
  const at = $('#act-type');
  at.addEventListener('change', () => { $('#tpl').hidden = at.value !== 'template_reply'; });
  bind({
    add: async (f) => {
      const d = formData(f);
      const action = { type: d.action };
      if (d.mode) action.mode = d.mode;
      if (d.action === 'ai_reply' && d.param) action.instructions = d.param;
      if (d.action === 'forward') action.to = d.param;
      if (d.action === 'webhook') action.url = d.param;
      if (d.action === 'template_reply') action.template_id = Number(d.template_id);
      await api('/rules', { method: 'POST', body: { name: d.name, conditions: { match: 'all', items: d.value ? [{ field: d.field, op: d.op, value: d.value }] : [] }, actions: [action] } });
      toast('Rule saved'); route();
    },
    del: async (b) => { await api(`/rules/${b.dataset.id}`, { method: 'DELETE' }); route(); },
  });
};

function crudView(path, title, intro, fields) {
  return async () => {
    const list = await api(`/${path}`);
    view.innerHTML = `
      <h1>${title}</h1><p class="hint">${intro}</p>
      ${list.map((x) => `<div class="card" style="margin-bottom:12px"><form data-act="save" data-id="${x.id}">
        ${fields.map(([k, label, ta]) => `<label>${label}</label>${ta ? `<textarea name="${k}">${esc(x[k])}</textarea>` : `<input name="${k}" value="${esc(x[k])}">`}`).join('')}
        <div class="row" style="margin-top:10px"><button class="btn">Save</button><button class="btn danger" type="button" data-act="del" data-id="${x.id}">Delete</button></div>
      </form></div>`).join('')}
      <div class="card"><h3>Add new</h3><form data-act="add">
        ${fields.map(([k, label, ta]) => `<label>${label}</label>${ta ? `<textarea name="${k}"></textarea>` : `<input name="${k}">`}`).join('')}
        <button class="btn primary" style="margin-top:12px">Add</button></form></div>`;
    bind({
      add: async (f) => { await api(`/${path}`, { method: 'POST', body: formData(f) }); toast('Added'); route(); },
      save: async (f) => { await api(`/${path}/${f.dataset.id}`, { method: 'PUT', body: formData(f) }); toast('Saved'); },
      del: async (b) => { await api(`/${path}/${b.dataset.id}`, { method: 'DELETE' }); route(); },
    });
  };
}
views.knowledge = crudView('knowledge', 'Knowledge base',
  'The AI only states facts found here: prices, packages, policies, shipping times, opening hours, FAQs, links. The more you add, the more emails can be answered automatically.',
  [['title', 'Title'], ['content', 'Content', true]]);
views.templates = crudView('templates', 'Reply templates',
  'Canned replies for rules. Tags: {{first_name}}, {{name}}, {{email}}, {{subject}}.',
  [['name', 'Name'], ['subject', 'Subject (blank = Re: original)'], ['body', 'Body', true]]);

views.settings = async () => {
  const s = await api('/settings');
  view.innerHTML = `
    <h1>AI & brand settings</h1>
    <form class="card" data-act="save">
      <div class="grid g2">
        <div><label>Workspace name</label><input name="name" value="${esc(s.name)}"></div>
        <div><label>Business / brand name</label><input name="business_name" value="${esc(s.business_name)}"></div>
      </div>
      <label>What does your business do? (who you serve, products, services)</label>
      <textarea name="business_description">${esc(s.business_description)}</textarea>
      <div class="grid g2">
        <div><label>Reply tone</label><input name="reply_tone" value="${esc(s.reply_tone)}" placeholder="friendly and professional"></div>
        <div><label>Fallback language</label><input name="default_language" value="${esc(s.default_language)}" placeholder="auto, en, bn, es…"></div>
        <div><label>Auto-send minimum confidence (0–1)</label><input name="auto_send_min_confidence" type="number" step="0.05" min="0" max="1" value="${esc(s.auto_send_min_confidence)}"></div>
        <div><label>Business hours for auto-send (JSON, blank = 24/7)</label><input name="business_hours" value="${esc(s.business_hours)}" placeholder='{"tz":"Asia/Dhaka","days":[1,2,3,4,5,6],"start":"09:00","end":"21:00"}'></div>
      </div>
      <label>Email signature</label><textarea name="signature" style="min-height:80px">${esc(s.signature)}</textarea>
      <button class="btn primary" style="margin-top:14px">Save settings</button>
    </form>
    <form class="card" data-act="pw" style="margin-top:16px">
      <h3>Change password</h3>
      <div class="grid g2"><div><label>Current</label><input type="password" name="current"></div><div><label>New</label><input type="password" name="next" minlength="8"></div></div>
      <button class="btn" style="margin-top:12px">Update password</button>
    </form>`;
  bind({
    save: async (f) => { await api('/settings', { method: 'PUT', body: formData(f) }); toast('Settings saved'); },
    pw: async (f) => { await api('/auth/change-password', { method: 'POST', body: formData(f) }); toast('Password updated'); f.reset(); },
  });
};

views.team = async () => {
  const list = await api('/team');
  view.innerHTML = `
    <h1>Team</h1>
    <div class="card" style="margin-bottom:16px"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
      ${list.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${badge(u.role)}</td>
        <td>${u.role !== 'owner' ? `<button class="btn sm danger" data-act="del" data-id="${u.id}">Remove</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <form class="card" data-act="add"><h3>Add a teammate</h3><p class="hint">Your teammate signs up first, then you add them by email.</p>
      <div class="row"><input name="email" type="email" placeholder="teammate@company.com" style="flex:2" required>
      <select name="role" style="flex:1"><option value="member">Member (handle emails)</option><option value="admin">Admin (manage settings)</option></select>
      <button class="btn primary">Add</button></div></form>`;
  bind({
    add: async (f) => { await api('/team', { method: 'POST', body: formData(f) }); toast('Added'); route(); },
    del: async (b) => { await api(`/team/${b.dataset.id}`, { method: 'DELETE' }); route(); },
  });
};

views.billing = async (params) => {
  const [{ plans, stripeEnabled }, info] = await Promise.all([fetch('/api/billing/plans').then((r) => r.json()), api('/auth/me')]);
  const ws = info.workspace;
  let interval = params.interval || 'monthly';
  if (params.success) toast('Payment successful — thank you! Your plan will update in a few seconds.');
  const render = () => {
    view.innerHTML = `
      <h1>Billing</h1>
      <div class="card" style="margin-bottom:16px">
        <div class="row"><div><b>Current plan:</b> ${esc(info.effectivePlan.name)} ${badge(ws.subscription_status || (ws.plan === 'trial' ? 'trial' : ''))}
          <div class="hint">${ws.plan === 'trial' ? `Trial ends ${fmtDate(ws.trial_ends_at)}` : ws.plan === 'lifetime' ? 'Lifetime license — no renewals' : ws.current_period_end ? `Renews ${fmtDate(ws.current_period_end)} (${esc(ws.billing_interval)})` : ''}</div></div>
          <span class="spacer"></span>${ws.plan !== 'trial' && ws.plan !== 'lifetime' ? '<button class="btn" data-act="portal">Manage subscription & invoices</button>' : ''}</div>
      </div>
      ${!stripeEnabled ? '<div class="banner">Online payments are not configured yet. Contact support to upgrade.</div>' : ''}
      <div style="text-align:center;margin-bottom:16px"><div class="toggle">
        <button data-i="monthly" class="${interval === 'monthly' ? 'on' : ''}">Monthly</button><button data-i="yearly" class="${interval === 'yearly' ? 'on' : ''}">Yearly (2 months free)</button></div></div>
      <div class="grid g4">${plans.map((p) => {
        const life = p.key === 'lifetime';
        const amt = life ? p.priceOnce : interval === 'yearly' ? p.priceYearly : p.priceMonthly;
        const current = ws.plan === p.key && (life || ws.billing_interval === interval);
        return `<div class="card price ${params.plan === p.key ? 'featured' : ''}"><h3>${esc(p.name)}</h3>
          <div class="amt">$${amt}<small> ${life ? 'once' : interval === 'yearly' ? '/yr' : '/mo'}</small></div>
          <ul><li>${p.mailboxes} accounts</li><li>${p.aiRepliesPerMonth.toLocaleString()} AI replies/mo</li><li>${p.rules} rules</li><li>${p.teamMembers} seats</li></ul>
          <button class="btn primary" data-act="buy" data-plan="${p.key}" ${current || !stripeEnabled ? 'disabled' : ''}>${current ? 'Current plan' : life ? 'Buy lifetime' : 'Choose'}</button></div>`;
      }).join('')}</div>`;
    view.querySelectorAll('.toggle button').forEach((b) => b.addEventListener('click', () => { interval = b.dataset.i; render(); }));
    bind({
      buy: async (b) => { const r = await api('/billing/checkout', { method: 'POST', body: { plan: b.dataset.plan, interval } }); location.href = r.url; },
      portal: async () => { const r = await api('/billing/portal', { method: 'POST' }); location.href = r.url; },
    });
  };
  render();
};

views.admin = async () => {
  const [o, list] = await Promise.all([api('/admin/overview'), api('/admin/workspaces')]);
  view.innerHTML = `
    <h1>Platform admin</h1>
    <div class="grid g4">
      <div class="card stat"><div class="n">${o.users}</div><div class="l">Users</div></div>
      <div class="card stat"><div class="n">${o.workspaces}</div><div class="l">Workspaces</div></div>
      <div class="card stat"><div class="n">${o.mailboxes}</div><div class="l">Mailboxes</div></div>
      <div class="card stat"><div class="n">$${Math.round(o.mrr)}</div><div class="l">Est. MRR</div></div>
      <div class="card stat"><div class="n">${o.usage?.ai_calls || 0}</div><div class="l">AI calls this month</div></div>
      <div class="card stat"><div class="n">${((o.usage?.input_tokens || 0) / 1e6).toFixed(2)}M / ${((o.usage?.output_tokens || 0) / 1e6).toFixed(2)}M</div><div class="l">Tokens in / out</div></div>
    </div>
    <div class="card table-wrap" style="margin-top:16px"><table><thead><tr><th>Workspace</th><th>Owner</th><th>Plan</th><th>Accounts</th><th>Emails</th><th>Grant plan</th></tr></thead><tbody>
      ${list.map((w) => `<tr><td>${esc(w.name)}<div class="hint">#${w.id} · ${fmtDate(w.created_at)}</div></td><td>${esc(w.owner_email)}</td>
        <td>${badge(w.plan)} ${badge(w.subscription_status)}</td><td>${w.mailboxes}</td><td>${w.messages}</td>
        <td><form class="row" data-act="grant" data-id="${w.id}"><select name="plan">${['starter', 'pro', 'business', 'lifetime', 'trial'].map((p) => `<option>${p}</option>`).join('')}</select>
          <input name="days" placeholder="days" style="width:70px"><button class="btn sm">Apply</button></form></td></tr>`).join('')}
    </tbody></table></div>`;
  bind({ grant: async (f) => { await api(`/admin/workspaces/${f.dataset.id}/plan`, { method: 'POST', body: formData(f) }); toast('Plan updated'); route(); } });
};

// ---------------- Router ----------------
async function route() {
  const [name, qs] = (location.hash.slice(1) || 'dashboard').split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  document.querySelectorAll('.side a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${name}`));
  $('#side').classList.remove('open');
  view.innerHTML = '<p class="hint">Loading…</p>';
  try { await (views[name] || views.dashboard)(params); } catch (e) { view.innerHTML = `<div class="card err-text">${esc(e.message)}</div>`; }
  api('/replies?status=pending').then((l) => { $('#pending-count').textContent = l.length; }).catch(() => {});
}

async function init() {
  me = await api('/auth/me');
  $('#admin-link').hidden = !me.user.is_admin;
  const ep = me.effectivePlan;
  if (ep.key === 'expired') $('#plan-banner').innerHTML = '<div class="banner">⚠ Your trial or subscription has ended — email automation is paused. <a href="#billing">Choose a plan</a> to resume.</div>';
  else if (me.workspace.plan === 'trial') {
    const days = Math.max(0, Math.ceil((new Date(me.workspace.trial_ends_at) - Date.now()) / 86400_000));
    $('#plan-banner').innerHTML = `<div class="banner">Free trial: ${days} day(s) left. <a href="#billing">Upgrade</a></div>`;
  }
  $('#logout').addEventListener('click', async (e) => { e.preventDefault(); await api('/auth/logout', { method: 'POST' }); location.href = '/'; });
  $('#menu-btn').addEventListener('click', () => $('#side').classList.toggle('open'));
  window.addEventListener('hashchange', route);
  route();
}
init();
