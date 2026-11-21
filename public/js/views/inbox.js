import { $, $$, esc, icon, api, toast, bind, formData, badge, lead, avatar, ago, fmtDate, empty, dropdown, modal, label } from '../ui.js';

const VIEWS = [
  ['inbox', 'Inbox', 'inbox'], ['mine', 'Assigned to me', 'mine'], ['unassigned', 'Unassigned', 'unassigned'], ['overdue', 'Overdue', 'overdue'],
  ['awaiting', 'Awaiting reply', null], ['flagged', 'Flagged', 'flagged'], ['snoozed', 'Snoozed', 'snoozed'], ['all', 'All', null],
];
let state = { view: 'inbox', q: '', filters: {}, list: [], selected: null, poll: null };

function rowHtml(m) {
  const overdue = m.sla_due_at && !m.done && new Date(m.sla_due_at) < new Date();
  return `<div class="mrow ${state.selected === m.id ? 'on' : ''} ${m.status === 'triaged' || m.status === 'drafted' ? 'unread' : ''}" data-id="${m.id}" tabindex="0">
    ${avatar(m.from_name, m.from_email)}
    <div style="min-width:0"><div class="from truncate">${esc(m.from_name || m.from_email)}</div>
      <div class="subj truncate">${m.starred ? `<span style="color:var(--warn)">★</span> ` : ''}${esc(m.subject || '(no subject)')}</div>
      <div class="sum truncate">${esc(m.summary || '')}</div>
      <div class="tags">${m.priority === 'urgent' || m.priority === 'high' ? badge(m.priority) : ''}${m.category ? badge(m.category, 'info') : ''}${m.status === 'drafted' ? badge('draft ready', 'warn') : ''}${m.status === 'replied' ? badge('replied') : ''}
        ${m.is_phishing ? badge('phishing') : ''}${m.flagged && !m.is_phishing ? badge('flagged', 'warn') : ''}${overdue ? badge('overdue', 'bad') : ''}${m.assignee_name ? `<span class="badge">${icon('userCheck', 'sm')}${esc(m.assignee_name.split(' ')[0])}</span>` : ''}${m.has_attachments ? `<span class="badge">${icon('clip', 'sm')}</span>` : ''}</div></div>
    <div class="time">${ago(m.received_at)}${m.lead_score >= 50 ? `<div class="mt-s">${lead(m.lead_score)}</div>` : ''}</div></div>`;
}

async function loadList(ctx) {
  const p = new URLSearchParams({ view: state.view, ...(state.q ? { q: state.q } : {}), ...state.filters });
  const [list, counts] = await Promise.all([api(`/messages?${p}`), api('/messages/counts')]);
  state.list = list;
  $('#views').innerHTML = VIEWS.map(([k, l, c]) => `<button class="${state.view === k ? 'on' : ''}" data-v="${k}">${esc(l)}${c && counts[c] ? ` <span class="count">${counts[c]}</span>` : ''}</button>`).join('');
  $$('#views button').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.v; state.selected = null; location.hash = 'inbox'; loadList(ctx); }));
  $('#mlist').innerHTML = list.map(rowHtml).join('') || empty('inbox', state.view === 'inbox' ? 'Inbox zero' : 'Nothing here', state.view === 'inbox' ? 'New mail is checked every couple of minutes.' : '');
  $$('#mlist .mrow').forEach((el) => el.addEventListener('click', () => { location.hash = `message?id=${el.dataset.id}`; }));
}

export async function inbox(ctx, params, name) {
  if (!$('#inbox-root')) {
    const mailboxes = await api('/mailboxes');
    ctx.view.innerHTML = `<div class="inbox" id="inbox-root">
      <section class="inbox-list"><div class="inbox-tools">
        <div class="row nowrap"><div class="input-icon" style="flex:1">${icon('search')}<input id="isearch" placeholder="Search mail" value="${esc(state.q)}" autocomplete="off"></div>
          <button class="btn icon-only" id="ifilter" title="Filters">${icon('layers')}</button></div>
        <div class="views" id="views"></div></div>
        <div class="mlist" id="mlist" role="list"></div></section>
      <section class="reader" id="reader"></section></div>`;
    let t;
    $('#isearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); loadList(ctx); }, 250); });
    $('#ifilter').addEventListener('click', (e) => dropdown(e.currentTarget, [
      { label: 'All accounts', icon: 'mail', run: () => { delete state.filters.mailbox_id; loadList(ctx); } },
      ...mailboxes.map((m) => ({ label: m.email, icon: 'mail', run: () => { state.filters.mailbox_id = m.id; loadList(ctx); } })), 'hr',
      { label: 'Urgent only', icon: 'alert', run: () => { state.filters.priority = 'urgent'; loadList(ctx); } },
      { label: 'Hot leads (70+)', icon: 'flame', run: () => { state.filters.min_lead = 70; loadList(ctx); } },
      { label: 'Starred', icon: 'star', run: () => { state.filters.starred = 1; loadList(ctx); } },
      { label: 'Clear filters', icon: 'x', run: () => { state.filters = {}; loadList(ctx); } },
    ]));
    document.addEventListener('keydown', inboxKeys);
    window.addEventListener('hashchange', function off() {
      if (!/^#(inbox|message)/.test(location.hash)) { document.removeEventListener('keydown', inboxKeys); clearInterval(state.poll); window.removeEventListener('hashchange', off); }
    });
    if (params.view) state.view = params.view;
    await loadList(ctx);
  }
  const id = name === 'message' ? Number(params.id) : null;
  state.selected = id;
  $$('#mlist .mrow').forEach((el) => el.classList.toggle('on', Number(el.dataset.id) === id));
  $('#inbox-root').classList.toggle('reading', Boolean(id));
  clearInterval(state.poll);
  if (id) await reader(ctx, id);
  else $('#reader').innerHTML = `<div style="height:100%;display:grid;place-items:center">${empty('mail', 'Select an email', 'Use <kbd>j</kbd> / <kbd>k</kbd> to move, <kbd>Enter</kbd> to open.')}</div>`;
}

function inboxKeys(e) {
  if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey) return;
  const idx = state.list.findIndex((m) => m.id === state.selected);
  if (e.key === 'j' || e.key === 'ArrowDown') { const n = state.list[Math.min(state.list.length - 1, idx + 1)]; if (n) location.hash = `message?id=${n.id}`; e.preventDefault(); }
  if (e.key === 'k' || e.key === 'ArrowUp') { const n = state.list[Math.max(0, idx - 1)]; if (n) location.hash = `message?id=${n.id}`; e.preventDefault(); }
  if (e.key === 'e' && state.selected) $('[data-act="done"]')?.click();
  if (e.key === 's' && state.selected) $('[data-act="star"]')?.click();
  if (e.key === 'r' && state.selected) { $('#reply-body')?.focus(); e.preventDefault(); }
  if (e.key === 'Escape') location.hash = 'inbox';
}

async function reader(ctx, id) {
  const box = $('#reader');
  box.innerHTML = '<div class="reader-inner"><div class="skeleton" style="height:26px;width:60%"></div><div class="skeleton mt" style="height:200px"></div></div>';
  const m = await api(`/messages/${id}`);
  if (state.selected !== id) return;
  const pending = m.replies.find((x) => ['pending', 'failed', 'scheduled'].includes(x.status));
  const sent = m.replies.filter((x) => x.status === 'sent');
  const ex = Object.entries(m.extracted || {}).filter(([, v]) => v);
  const overdue = m.sla_due_at && !m.done && new Date(m.sla_due_at) < new Date();
  box.innerHTML = `<div class="reader-inner">
    <div class="toolbar">
      <a class="btn ghost sm icon-only" href="#inbox" title="Back" aria-label="Back">${icon('chevronLeft')}</a>
      <button class="btn sm" data-act="done" title="Mark done (e)">${icon('check')}${m.done ? 'Reopen' : 'Done'}</button>
      <button class="btn sm" data-act="assign">${icon('userCheck')}${m.assigned_to ? esc(m.team.find((u) => u.id === m.assigned_to)?.name || 'Assigned') : 'Assign'}</button>
      <button class="btn sm" data-act="snooze">${icon('clock')}${m.snoozed_until && new Date(m.snoozed_until) > new Date() ? `Snoozed · ${ago(m.snoozed_until)}` : 'Snooze'}</button>
      <button class="btn sm icon-only" data-act="star" title="Star (s)" aria-label="Star" style="${m.starred ? 'color:var(--warn)' : ''}">${icon('star')}</button>
      <button class="btn sm" data-act="translate">${icon('globe')}Translate</button>
      <span class="spacer"></span>
      <button class="btn sm ghost icon-only" data-act="more" aria-label="More actions">${icon('menu')}</button>
    </div>
    ${m.viewers.length ? `<div class="callout warn">${icon('eye')}<div><b>${esc(m.viewers.join(', '))}</b> ${m.viewers.length > 1 ? 'are' : 'is'} also viewing this email — coordinate before replying.</div></div>` : ''}
    ${m.is_phishing ? `<div class="callout bad">${icon('shield')}<div><b>Likely phishing or fraud.</b> Don't click links, open attachments, or send money. The AI will never answer this sender.</div></div>` : ''}
    ${m.guard_flags.length ? `<div class="callout warn">${icon('alert')}<div><b>Safety checks:</b><ul class="flag-list">${m.guard_flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div></div>` : ''}
    ${overdue ? `<div class="callout bad">${icon('clock')}<div>Past your response-time target (${fmtDate(m.sla_due_at)}).</div></div>` : ''}
    <div class="reader-h"><div style="flex:1;min-width:0"><h2>${esc(m.subject || '(no subject)')}</h2>
      <div class="row mt-s">${badge(m.category, 'info')}${badge(m.priority)}${badge(m.sentiment)}${badge(m.status)}${m.language && m.language !== 'unknown' ? badge(m.language.toUpperCase()) : ''}${m.opt_out ? badge('do not contact', 'bad') : ''}</div></div></div>
    <div class="reader-grid">
      <div class="col" style="gap:16px;min-width:0">
        <div class="mail-card">
          <div class="row nowrap mb">${avatar(m.from_name, m.from_email, 'lg')}<div class="truncate" style="flex:1"><b>${esc(m.from_name || m.from_email)}</b> <span class="hint">&lt;${esc(m.from_email)}&gt;</span>
            <div class="hint">to ${esc(m.mailbox_email)} · ${fmtDate(m.received_at)}${m.reply_to_email ? ` · reply-to ${esc(m.reply_to_email)}` : ''}</div></div></div>
          <pre class="mail-body">${esc(m.text_body)}</pre>
          ${m.attachments.length ? `<div class="chips mt">${m.attachments.map((a) => `<span class="chip">${icon('clip', 'sm')} ${esc(a.filename)} <span class="hint">${Math.ceil((a.size || 0) / 1024)} KB</span></span>`).join('')}</div>` : ''}
          <div id="translation"></div>
        </div>
        ${sent.map((x) => `<div class="mail-card" style="border-left:3px solid var(--ok)"><div class="row hint mb">${icon('send', 'sm')} ${x.kind === 'followup' ? 'Follow-up' : 'Reply'} sent ${fmtDate(x.sent_at)} · ${x.approved_by ? 'approved by your team' : x.source === 'manual' ? 'written by you' : 'autopilot'}${x.edited ? ' · edited' : ''}</div><pre class="mail-body">${esc(x.body)}</pre></div>`).join('')}
        ${m.is_phishing ? '' : `<form data-act="send" class="reply-box">
          <div class="rb-h">${icon('reply', 'sm')}<b>Reply</b><span class="hint truncate">to ${esc(m.reply_to_email || m.from_email)}</span><span class="spacer"></span>${pending?.status === 'scheduled' ? badge('autopilot scheduled', 'scheduled') : pending ? badge('AI draft', 'info') : ''}</div>
          ${pending?.status === 'scheduled' ? `<div class="callout primary" style="margin:12px 12px 0">${icon('clock')}<div>Autopilot sends this ${ago(pending.scheduled_at)}. <a href="#" data-act="hold">Hold for review</a></div></div>` : ''}
          ${pending?.guard?.length ? `<div class="callout warn" style="margin:12px 12px 0">${icon('shield')}<div><b>Check before sending:</b><ul class="flag-list">${pending.guard.map((g) => `<li>${esc(g.replace(/^guard: /, ''))}</li>`).join('')}</ul></div></div>` : pending?.error ? `<div class="callout warn" style="margin:12px 12px 0">${icon('info')}<div>${esc(pending.error)}</div></div>` : ''}
          <input name="subject" value="${esc(pending?.subject || `Re: ${(m.subject || '').replace(/^re:\s*/i, '')}`)}" style="border:0;border-bottom:1px solid var(--border);border-radius:0;box-shadow:none" aria-label="Subject">
          <textarea id="reply-body" name="body" placeholder="Write a reply, or ask the AI to draft one below…" aria-label="Reply">${esc(pending?.body || '')}</textarea>
          <div class="rb-f"><button class="btn primary" type="submit">${icon('send')}${pending ? 'Approve & send' : 'Send'}</button>
            ${pending ? '<button class="btn ghost" type="button" data-act="reject">Discard draft</button>' : ''}
            <button class="btn ghost" type="button" data-act="previewLang" title="Read the reply in your own language before sending">${icon('globe')}Preview in my language</button>
            <span class="spacer"></span><span class="hint">${pending?.ai_original ? 'Edits teach the AI' : ''}</span></div>
        </form>
        <form data-act="redraft" class="ai-panel"><div class="row nowrap">${icon('sparkles')}<b>Ask AI to write the reply</b></div>
          <div class="chips mt-s">${['Shorter', 'More friendly', 'More formal', 'Offer a call', 'Say no politely', 'Reply in English'].map((c) => `<button type="button" class="chip" data-act="quick" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</div>
          <div class="row nowrap mt-s"><input name="instructions" placeholder="Or describe what to say, e.g. offer 10% off if they order this week" style="flex:1"><button class="btn" type="submit">${icon('wand')}Draft</button></div></form>`}
        <div class="card flat"><div class="card-h"><h3>${icon('note')} Internal notes</h3><span class="hint">Only your team sees these · @email to assign</span></div>
          ${m.notes.map((n) => `<div class="note"><b>${esc(n.name || n.email)}</b> <span class="hint">${ago(n.created_at)}</span><div>${esc(n.body)}</div></div>`).join('')}
          <form data-act="note" class="row nowrap"><input name="body" placeholder="Add a note for your team…" style="flex:1"><button class="btn" type="submit">Add</button></form></div>
      </div>
      <aside class="side-panel">
        <div class="card flat"><h4 class="section-title" style="margin-top:0">AI analysis</h4>
          ${m.summary ? `<p>${esc(m.summary)}</p>` : '<p class="hint">Not analysed yet.</p>'}
          ${m.intent ? `<dl class="kv"><dt>Wants</dt><dd>${esc(m.intent)}</dd>` : '<dl class="kv">'}
          ${m.lead_score != null ? `<dt>Lead score</dt><dd>${lead(m.lead_score)}</dd>` : ''}
          ${m.confidence != null ? `<dt>Confidence</dt><dd>${Math.round(m.confidence * 100)}%</dd>` : ''}
          ${m.facts_used.length ? `<dt>Facts used</dt><dd>${m.facts_used.map(esc).join(', ')}</dd>` : ''}</dl>
          ${m.reasoning ? `<p class="why mt-s">${icon('info', 'sm')}<span>${esc(m.reasoning)}</span></p>` : ''}
          <button class="btn sm ghost mt-s" data-act="reprocess">${icon('refresh')}Re-analyse</button></div>
        ${m.contact ? `<div class="card flat"><div class="row nowrap">${avatar(m.contact.name, m.contact.email)}<div class="truncate" style="flex:1"><b>${esc(m.contact.name || m.contact.email)}</b>${m.contact.vip ? ' <span class="badge warn">VIP</span>' : ''}<div class="hint truncate">${esc(m.contact.company || m.contact.email)}</div></div></div>
          <dl class="kv mt"><dt>Emails</dt><dd>${m.contact.emails_in} in · ${m.contact.emails_out} out</dd>${ex.map(([k, v]) => `<dt>${esc(label(k))}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
          <div class="row mt"><a class="btn sm" href="#contact?id=${m.contact.id}">Profile</a><button class="btn sm" data-act="vip">${m.contact.vip ? 'Remove VIP' : 'Mark VIP'}</button><button class="btn sm danger" data-act="block">${m.contact.blocked ? 'Unblock' : 'Block'}</button></div></div>` : ''}
      </aside>
    </div></div>`;
  state.poll = setInterval(() => api(`/messages/${id}/viewing`, { method: 'POST' }).catch(() => {}), 30_000);
  const refresh = async () => { await reader(ctx, id); loadList(ctx); };
  const assign = async (uid) => { await api(`/messages/${id}/assign`, { method: 'POST', body: { user_id: uid } }); toast(uid ? 'Assigned' : 'Unassigned'); refresh(); };
  const snooze = async (hours, until) => { await api(`/messages/${id}/snooze`, { method: 'POST', body: { until: until || (hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null) } }); toast(hours || until ? 'Snoozed' : 'Unsnoozed'); refresh(); };
  bind({
    done: async () => { await api(`/messages/${id}/done`, { method: 'POST', body: { done: !m.done } }); toast(m.done ? 'Reopened' : 'Marked done'); refresh(); },
    star: async () => { await api(`/messages/${id}/star`, { method: 'POST', body: { starred: !m.starred } }); refresh(); },
    assign: (b) => dropdown(b, [...m.team.map((u) => ({ label: u.name || u.email, icon: 'userCheck', run: () => assign(u.id) })), 'hr', { label: 'Unassign', icon: 'x', run: () => assign(null) }]),
    snooze: (b) => dropdown(b, [
      { label: 'Later today (3h)', icon: 'clock', run: () => snooze(3) }, { label: 'Tomorrow', icon: 'calendar', run: () => snooze(24) },
      { label: 'Next week', icon: 'calendar', run: () => snooze(24 * 7) }, 'hr', { label: 'Unsnooze', icon: 'x', run: () => snooze(0) }]),
    translate: async () => {
      $('#translation').innerHTML = '<div class="skeleton mt" style="height:60px"></div>';
      const r = await api(`/messages/${id}/translate`, { method: 'POST', body: {} });
      $('#translation').innerHTML = `<div class="callout info mt">${icon('globe')}<div style="white-space:pre-wrap">${esc(r.translation)}</div></div>`;
    },
    previewLang: async () => {
      const text = $('#reply-body').value;
      if (!text.trim()) throw new Error('Write or draft a reply first');
      const r = await api(`/messages/${id}/translate`, { method: 'POST', body: { text } });
      modal(`<h2>${icon('globe')} Reply in your language</h2><p class="hint">This is only a preview — the customer receives the original text.</p><pre class="mail-body mail-card">${esc(r.translation)}</pre>`);
    },
    more: (b) => dropdown(b, [
      { label: 'Re-analyse with AI', icon: 'refresh', run: () => bindRun(async () => { await api(`/messages/${id}/reprocess`, { method: 'POST' }); refresh(); }) },
      { label: 'Copy sender email', icon: 'copy', run: () => navigator.clipboard?.writeText(m.from_email).then(() => toast('Copied')) },
      ...(m.contact ? [{ label: m.contact.blocked ? 'Unblock sender' : 'Block sender', icon: 'ban', run: () => bindRun(async () => { await api(`/contacts/${m.contact.id}`, { method: 'PUT', body: { blocked: !m.contact.blocked } }); refresh(); }) }] : []),
    ]),
    reprocess: async () => { await api(`/messages/${id}/reprocess`, { method: 'POST' }); toast('Re-analysed'); refresh(); },
    send: async (f) => {
      const d = formData(f);
      if (!d.body.trim()) throw new Error('Write a message first');
      if (pending) await api(`/replies/${pending.id}/approve`, { method: 'POST', body: d });
      else await api(`/messages/${id}/reply`, { method: 'POST', body: d });
      toast('Reply sent'); refresh(); ctx.refreshCounts();
    },
    reject: async () => { await api(`/replies/${pending.id}/reject`, { method: 'POST' }); toast('Draft discarded'); refresh(); },
    hold: async () => { await api(`/replies/${pending.id}/hold`, { method: 'POST' }); toast('Held for review'); refresh(); },
    quick: async (b) => { const f = $('[data-act="redraft"]', box); f.instructions.value = b.dataset.q; f.requestSubmit(); },
    redraft: async (f) => {
      if (pending) await api(`/replies/${pending.id}/reject`, { method: 'POST' });
      const r = await api(`/messages/${id}/draft`, { method: 'POST', body: formData(f) });
      toast(r.guard?.length ? 'Draft ready — check the safety notes' : 'New draft ready'); refresh();
    },
    note: async (f) => { await api(`/messages/${id}/notes`, { method: 'POST', body: formData(f) }); refresh(); },
    vip: async () => { await api(`/contacts/${m.contact.id}`, { method: 'PUT', body: { vip: !m.contact.vip } }); toast(m.contact.vip ? 'VIP removed' : 'Marked VIP — replies to them are always reviewed'); refresh(); },
    block: async () => { await api(`/contacts/${m.contact.id}`, { method: 'PUT', body: { blocked: !m.contact.blocked } }); toast(m.contact.blocked ? 'Unblocked' : 'Blocked — future emails are ignored'); refresh(); },
  }, box);
}

async function bindRun(fn) { try { await fn(); } catch (e) { toast(e.message, true); } }
