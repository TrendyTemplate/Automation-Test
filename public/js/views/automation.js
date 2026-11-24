// Automation Center (live pipeline), Recipes (one-click automations) and Tasks (AI-extracted action items).
import { $, esc, icon, api, toast, bind, formData, modal, confirmBox, ago, fmtDate, num, empty, label } from '../ui.js';

const FEED = {
  auto_reply_sent: ['send', 'ok', 'Auto-reply sent'], reply_approved_sent: ['checkCircle', 'ok', 'Approved & sent'], followup_sent: ['reply', 'ok', 'Follow-up sent'],
  draft_created: ['file', 'info', 'Draft ready for review'], rule_fired: ['zap', 'primary', 'Automation ran'], tasks_extracted: ['listCheck', 'primary', 'Tasks created'],
  phishing_blocked: ['shield', 'bad', 'Phishing blocked'], send_failed: ['alert', 'bad', 'Send failed'], sync_error: ['alert', 'bad', 'Sync problem'], error: ['alert', 'bad', 'Processing error'],
  automation_installed: ['sparkles', 'primary', 'Automation installed'], auto_send_cancelled: ['x', 'warn', 'Auto-send cancelled'], sla_breach: ['clock', 'warn', 'Response target missed'],
  chat_auto_reply: ['chat', 'ok', 'Chat answered by AI'], chat_approved_sent: ['chat', 'ok', 'Chat reply approved & sent'], chat_draft: ['chat', 'info', 'Chat reply ready for review'],
  chat_handoff: ['userCheck', 'warn', 'Chat needs a human'], order_created: ['card', 'ok', 'New order from chat'], channel_added: ['plug', 'info', 'Channel connected'],
  forwarded: ['send', 'info', 'Forwarded'], assigned: ['userCheck', 'info', 'Assigned'], mailbox_added: ['mail', 'info', 'Email account connected'], followup_drafted: ['reply', 'info', 'Follow-up drafted'],
};
function feedText(a) {
  let d = {};
  try { d = JSON.parse(a.detail || '{}'); } catch { /* plain */ }
  const parts = [d.rule && `“${d.rule}”`, d.count && `${d.count} to-do${d.count > 1 ? 's' : ''}`, d.to || d.from, d.subject, d.by && `by ${d.by}`, d.error].filter(Boolean);
  return parts.join(' · ');
}
const feedRow = (a, fresh = false) => {
  const [ic, tone, t] = FEED[a.type] || ['activity', 'info', label(a.type)];
  let link = '';
  try { const d = JSON.parse(a.detail || '{}'); if (d.message) link = `#message?id=${Number(d.message)}`; else if (d.conversation) link = `#chats?id=${Number(d.conversation)}`; } catch { /* none */ }
  return `<a class="feed-row ${fresh ? 'fresh' : ''}" ${link ? `href="${link}"` : ''} data-id="${a.id}"><span class="feed-ic ${tone}">${icon(ic, 'sm')}</span>
    <span class="feed-t"><b>${esc(t)}</b><span class="hint truncate">${esc(feedText(a))}</span></span><span class="hint nowrap">${ago(a.created_at)}</span></a>`;
};

function countdown(iso) {
  const s = Math.max(0, Math.round((new Date(iso) - Date.now()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

export async function automation(ctx, params) {
  const range = ['24h', '7d', '30d'].includes(params.range) ? params.range : '7d';
  const d = await api(`/automation/overview?range=${range}`);
  const s = d.stages;
  const canManage = ['owner', 'admin'].includes(ctx.me.role);
  const node = (ic, n, l, tone = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="flow-node ${tone}"><span class="flow-ic">${icon(ic)}</span><b>${num(n)}</b><span>${esc(l)}</span></${href ? 'a' : 'div'}>`;
  const link = '<span class="flow-link" aria-hidden="true"><i></i></span>';
  const ready = d.readiness;
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Automation Center</h1><p>Watch your email pipeline work in real time — what arrived, what the AI and your automations did, and what is waiting for a human.</p></div>
      <div class="actions"><div class="seg" role="tablist">${['24h', '7d', '30d'].map((r) => `<a href="#automation?range=${r}" class="${r === range ? 'on' : ''}">${r}</a>`).join('')}</div>
      ${canManage ? `<a class="btn primary" href="#recipes">${icon('sparkles')}Add automation</a>` : ''}</div></div>
    <div class="card flow-card"><div class="card-h"><h3>${icon('workflow')} Live pipeline</h3><span class="live-dot" title="Updates every few seconds">Live</span><span class="spacer"></span>
      <span class="hint">Automation rate</span><b class="auto-rate">${d.automationRate}%</b></div>
      <div class="flow">
        ${node('inbox', s.received, 'Emails arrived', '', '#inbox')}${link}
        ${node('zap', s.rules_fired, 'Automations ran', 'primary', canManage ? '#rules' : '')}${link}
        ${node('brain', s.ai_read, 'Read by AI', 'primary')}${link}
        ${node('shieldCheck', s.held, 'Held by safety checks', 'warn', '#approvals')}${link}
        <div class="flow-outcomes">
          ${node('send', s.auto_sent, 'Sent automatically', 'ok')}
          ${node('checkCircle', s.approved_sent, 'Approved by you', 'ok')}
          ${node('archive', s.filtered, 'Filtered (no reply needed)', '')}
          ${node('shield', s.phishing, 'Phishing blocked', 'bad')}
        </div>
      </div>
      <div class="flow-foot"><span>${icon('listCheck', 'sm')} <b>${num(s.tasks)}</b> tasks pulled out of emails</span><span>${icon('file', 'sm')} <b>${num(s.drafted)}</b> replies drafted</span>
        <span>${icon('clock', 'sm')} ≈ <b>${(d.minutesSaved / 60).toFixed(1)}h</b> of work automated</span></div></div>

    <div class="split mt">
      <div class="card"><div class="card-h"><h3>${icon('activity')} Live activity</h3><span class="spacer"></span><span class="hint">Click an item to open the email</span></div>
        <div id="feed" class="feed">${d.feed.map((a) => feedRow(a)).join('') || empty('activity', 'Waiting for the first email', 'As soon as mail arrives you will see every step here.')}</div></div>
      <div class="col" style="gap:16px">
        <div class="card"><div class="card-h"><h3>${icon('clock')} About to send</h3><span class="spacer"></span><span class="hint">Human-like delay · you can stop it</span></div>
          <div id="upcoming">${d.upcoming.map((u) => `<div class="row nowrap upcoming" style="padding:8px 0;border-bottom:1px solid var(--border)">
            <span class="countdown" data-at="${esc(u.scheduled_at)}">${countdown(u.scheduled_at)}</span>
            <a class="truncate" style="flex:1;color:inherit" href="#message?id=${u.message_id}"><b>${esc(u.from_name || u.from_email)}</b><div class="hint truncate">${esc(u.subject || '')}</div></a>
            <button class="btn xs" data-act="now" data-id="${u.id}">Send now</button><button class="btn xs ghost danger" data-act="cancel" data-id="${u.id}">Stop</button></div>`).join('') || '<p class="hint">Nothing queued. Autopilot replies wait here for a few minutes before they go out.</p>'}</div></div>
        <div class="card"><div class="card-h"><h3>${icon('target')} Automation readiness</h3><span class="spacer"></span><b>${ready.score}%</b></div>
          <div class="bar ${ready.score < 50 ? 'warn' : ''}"><i style="width:${ready.score}%"></i></div>
          <div class="mt-s">${ready.checks.map((c) => `<a class="ready-row ${c.ok ? 'ok' : ''}" href="${c.href}">${icon(c.ok ? 'checkCircle' : 'circle', 'sm')}<span>${esc(c.label)}</span>${c.ok ? '' : icon('chevron', 'sm')}</a>`).join('')}</div></div>
      </div>
    </div>
    <div class="card mt"><div class="card-h"><h3>${icon('zap')} Automation performance</h3><span class="spacer"></span>${canManage ? '<a class="hint" href="#rules">Manage rules →</a>' : ''}</div>
      ${d.rules.length ? `<table class="table"><thead><tr><th>Automation</th><th>Status</th><th class="num">Times ran</th><th>Last ran</th></tr></thead><tbody>
        ${d.rules.map((r) => `<tr><td><b>${esc(r.name)}</b>${r.recipe_key ? ' <span class="badge info">Recipe</span>' : ''}</td><td>${r.enabled ? '<span class="badge ok">On</span>' : '<span class="badge">Off</span>'}</td><td class="num">${num(r.hits)}</td><td class="hint">${r.last_hit_at ? ago(r.last_hit_at) : 'never'}</td></tr>`).join('')}</tbody></table>`
    : empty('zap', 'No automations yet', 'Install a recipe or describe one in plain words — it takes 10 seconds.', canManage ? `<a class="btn primary" href="#recipes">${icon('sparkles')}Browse recipes</a>` : '')}</div>`;

  const act = async (b, action) => {
    await api(`/automation/scheduled/${b.dataset.id}/${action}`, { method: 'POST' });
    toast(action === 'now' ? 'Sent' : 'Stopped — moved to Approvals'); ctx.route(); ctx.refreshCounts();
  };
  bind({ now: (b) => act(b, 'now'), cancel: (b) => act(b, 'cancel') }, ctx.view);

  // Live updates: new activity every 5s, countdowns every second. Stops when the page is left.
  const root = ctx.view.firstElementChild;
  let last = d.feed[0]?.id || 0;
  const tick = setInterval(() => {
    if (!root.isConnected) { clearInterval(tick); return; }
    for (const el of ctx.view.querySelectorAll('.countdown')) el.textContent = countdown(el.dataset.at);
  }, 1000);
  const poll = setInterval(async () => {
    if (!root.isConnected) { clearInterval(poll); return; }
    if (document.hidden) return;
    try {
      const n = await api(`/automation/overview?range=${range}&after=${last}`);
      if (!root.isConnected) return;
      if (n.feed.length) {
        last = n.feed[0].id;
        const feed = $('#feed');
        if (feed.querySelector('.empty')) feed.innerHTML = '';
        feed.insertAdjacentHTML('afterbegin', n.feed.map((a) => feedRow(a, true)).join(''));
        while (feed.children.length > 60) feed.lastElementChild.remove();
        const nodes = ctx.view.querySelectorAll('.flow-node b');
        const vals = [n.stages.received, n.stages.rules_fired, n.stages.ai_read, n.stages.held, n.stages.auto_sent, n.stages.approved_sent, n.stages.filtered, n.stages.phishing];
        nodes.forEach((b, i) => { if (b.textContent !== num(vals[i])) { b.textContent = num(vals[i]); b.parentElement.classList.add('bump'); setTimeout(() => b.parentElement.classList.remove('bump'), 900); } });
        ctx.view.querySelector('.auto-rate').textContent = `${n.automationRate}%`;
      }
    } catch { /* offline: try again next tick */ }
  }, 5000);
}

// ---------- Recipes + "describe it" ----------
export async function recipes(ctx) {
  const list = await api('/recipes');
  const groups = [...new Set(list.map((r) => r.group))];
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Automation recipes</h1><p>Proven playbooks that run on every new email. Install in one click, edit any time under Rules.</p></div></div>
    <form class="card describe mb" data-act="describe"><div class="row nowrap">${icon('sparkles')}<b>Describe an automation in plain words</b><span class="badge info">AI</span></div>
      <p class="hint">For example: “When an invoice arrives from @supplier.com, forward it to accounts@mycompany.com” or “If a customer is angry, assign it to me and draft an apology”.</p>
      <div class="row nowrap"><input name="text" maxlength="1500" placeholder="When … then …" style="flex:1"><button class="btn primary" type="submit">${icon('wand')}Build it</button></div></form>
    ${groups.map((g) => `<h4 class="section-title">${esc(g)}</h4><div class="grid g3">${list.filter((r) => r.group === g).map((r) => `
      <div class="card recipe ${r.installed ? 'installed' : ''}"><div class="row nowrap"><span class="recipe-ic">${icon(r.icon)}</span><b style="flex:1">${esc(r.title)}</b>${r.installed ? '<span class="badge ok">Active</span>' : ''}</div>
        <p class="hint">${esc(r.description)}</p>
        ${r.installed ? '<a class="btn sm" href="#rules">Edit in Rules</a>' : `<button class="btn sm primary" data-act="install" data-key="${esc(r.key)}">${icon('plus', 'sm')}Turn on</button>`}</div>`).join('')}</div>`).join('')}`;

  bind({
    install: async (b) => {
      const r = list.find((x) => x.key === b.dataset.key);
      const go = async (params = {}) => { await api(`/recipes/${r.key}/install`, { method: 'POST', body: { params } }); toast(`“${r.title}” is now running`); ctx.route(); };
      if (!r.params.length) return go();
      modal(`<h2>${esc(r.title)}</h2><p class="hint">${esc(r.description)}</p><form data-act="p">${r.params.map((p) => `<label>${esc(p.label)}</label><input name="${esc(p.name)}" type="${esc(p.type)}" required>`).join('')}
        <button class="btn primary mt" type="submit">Turn on</button></form>`, (el, close) => bind({ p: async (f) => { await go(formData(f)); close(); } }, el));
    },
    describe: async (f) => {
      const { text } = formData(f);
      const out = await api('/rules/from-text', { method: 'POST', body: { text } });
      if (!out.understood) { toast(out.question || 'Could you describe it a bit more specifically?', true); return; }
      sessionStorage.setItem('mp:draft-rule', JSON.stringify(out.rule));
      if (out.error) toast(`Almost there — please check: ${out.error}`, true);
      location.hash = '#rules?draft=1';
    },
  }, ctx.view);
}

// ---------- Tasks ----------
export async function tasks(ctx, params) {
  const status = params.status === 'done' ? 'done' : 'open';
  const mine = params.mine === '1';
  const [list, counts, team] = await Promise.all([api(`/tasks?status=${status}${mine ? '&mine=1' : ''}`), api('/tasks/counts'), api('/team')]);
  const tab = (href, l, n, on) => `<a href="${href}" class="${on ? 'on' : ''}">${esc(l)}${n ? ` <span class="badge">${n}</span>` : ''}</a>`;
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Tasks</h1><p>Action items the AI pulled out of your emails — quotes to send, orders to ship, calls to make — plus your own to-dos.</p></div>
      <div class="actions"><button class="btn primary" data-act="new">${icon('plus')}New task</button></div></div>
    <div class="seg mb">${tab('#tasks', 'Open', counts.open, status === 'open' && !mine)}${tab('#tasks?mine=1', 'Assigned to me', counts.mine, mine)}${tab('#tasks?status=done', 'Done', counts.done, status === 'done')}</div>
    <div class="card pad-0">${list.map((t) => `<div class="task-row ${t.done ? 'done' : ''}">
      <label class="switch-check"><input type="checkbox" data-act="toggle" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Done"></label>
      <div style="flex:1;min-width:0"><b>${esc(t.title)}</b>${t.source === 'ai' ? ` <span class="hint" title="Created by AI from an email">${icon('sparkles', 'sm')}</span>` : ''}
        <div class="hint truncate">${t.due_text ? `${icon('calendar', 'sm')} ${esc(t.due_text)} · ` : ''}${t.message_id ? `<a href="#message?id=${t.message_id}">${esc(t.from_name || t.from_email || '')}: ${esc(t.subject || '(no subject)')}</a>` : 'Manual task'} · ${ago(t.created_at)}</div></div>
      <button class="btn sm ghost" data-act="assign" data-id="${t.id}">${icon('userCheck', 'sm')}${esc(t.assignee || 'Assign')}</button>
      <button class="btn sm ghost danger icon-only" data-act="del" data-id="${t.id}" aria-label="Delete task">${icon('trash', 'sm')}</button></div>`).join('')
    || `<div style="padding:8px">${empty('listCheck', status === 'done' ? 'Nothing completed yet' : 'All clear', status === 'done' ? '' : 'When an email asks you to do something, the AI adds it here automatically.')}</div>`}</div>`;
  const { dropdown } = await import('../ui.js');
  bind({
    toggle: async (c) => { await api(`/tasks/${c.dataset.id}`, { method: 'PATCH', body: { done: c.checked } }); toast(c.checked ? 'Nice — task done' : 'Task reopened'); ctx.route(); },
    del: async (b) => { if (await confirmBox('Delete this task?', '', { danger: true, ok: 'Delete' })) { await api(`/tasks/${b.dataset.id}`, { method: 'DELETE' }); ctx.route(); } },
    assign: (b) => dropdown(b, [...team.members.map((u) => ({ label: u.name || u.email, icon: 'userCheck', run: async () => { await api(`/tasks/${b.dataset.id}`, { method: 'PATCH', body: { assigned_to: u.id } }); ctx.route(); } })),
      'hr', { label: 'Unassign', icon: 'x', run: async () => { await api(`/tasks/${b.dataset.id}`, { method: 'PATCH', body: { assigned_to: null } }); ctx.route(); } }]),
    new: () => modal(`<h2>New task</h2><form data-act="save"><label>What needs to be done?</label><input name="title" required maxlength="200">
      <label>Due (optional)</label><input name="due_text" maxlength="80" placeholder="e.g. Friday, 25 Nov"><button class="btn primary mt" type="submit">Add task</button></form>`,
    (el, close) => bind({ save: async (f) => { await api('/tasks', { method: 'POST', body: formData(f) }); close(); toast('Task added'); ctx.route(); } }, el)),
  }, ctx.view);
}

export { fmtDate };
