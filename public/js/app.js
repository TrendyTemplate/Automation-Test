import { $, esc, fmtDate, fmtDay, money, badge, formData, toast, api, bind, bars, modal, csvDownload } from './common.js';

const view = $('#view');
const views = {};
let me = null;
const pct = (v) => `${Math.round((v || 0) * 100)}%`;
const lead = (s) => (s == null ? '' : `<span class="lead ${s >= 70 ? 'hot' : ''}" title="Lead score">${s >= 70 ? '🔥' : ''}${s}</span>`);
const ERRORS = {
  limit: 'Your plan’s email-account limit is reached. Upgrade to add more.', provider_disabled: 'That connection option is not enabled yet.',
  no_refresh_token: 'The provider did not grant offline access. Remove the app from your Google/Microsoft account permissions and try again.', forbidden: 'Only workspace owners/admins can connect accounts.',
};
function routeNotice(params) {
  if (params.error) toast(ERRORS[params.error] || params.error, true);
  if (params.connected) toast('Account connected! Fetching recent emails…');
  if (params.verified) toast('Email verified — thank you!');
}

// =============== Dashboard ===============
views.dashboard = async (params) => {
  routeNotice(params);
  const d = await api('/dashboard');
  const c = d.counts;
  const usagePct = Math.min(100, Math.round((d.usage.ai_replies / Math.max(1, d.plan.aiRepliesPerMonth)) * 100));
  const steps = [
    [d.mailboxes > 0, 'Connect an email account', '#mailboxes'],
    [Boolean(me.settings?.business_description), 'Describe your business', '#settings'],
    [me.kbCount > 0, 'Add facts to the knowledge base', '#knowledge'],
    [Boolean(me.settings?.style_guide), 'Teach the AI your writing style', '#settings'],
    [Boolean(me.settings?.telegram_chat_id || me.settings?.slack_webhook), 'Get urgent alerts on your phone', '#integrations'],
  ];
  const done = steps.filter((s) => s[0]).length;
  view.innerHTML = `
    <h1>Dashboard</h1>
    ${!d.aiEnabled ? '<div class="banner">AI is not configured on this server yet. Emails are sorted with basic keyword rules only.</div>' : ''}
    ${!d.emailVerified ? '<div class="banner">Please confirm your email address — we sent you a link. <a href="#" data-act="resend">Resend</a></div>' : ''}
    ${done < steps.length ? `<div class="card" style="margin-bottom:16px"><div class="row"><h3 style="margin:0">Get set up — ${done}/${steps.length}</h3><span class="spacer"></span><div class="bar" style="width:160px"><i style="width:${(done / steps.length) * 100}%"></i></div></div>
      ${steps.map(([ok, label, href]) => `<div style="margin:6px 0">${ok ? '✅' : '⬜'} ${ok ? esc(label) : `<a href="${href}">${esc(label)}</a>`}</div>`).join('')}</div>` : ''}
    <div class="grid g4">
      <div class="card stat"><div class="n">${c.total || 0}</div><div class="l">Emails processed</div></div>
      <div class="card stat"><div class="n">${c.last24h || 0}</div><div class="l">Last 24 hours</div></div>
      <div class="card stat"><div class="n">${c.replied || 0}</div><div class="l">Replied</div></div>
      <div class="card stat"><div class="n">${c.awaiting_approval || 0}</div><div class="l">Awaiting approval</div></div>
      <div class="card stat"><div class="n">${d.scheduled}</div><div class="l">Auto-replies about to send</div></div>
      <div class="card stat"><div class="n">${(d.minutesSaved / 60).toFixed(1)}h</div><div class="l">Time saved (est.)</div></div>
    </div>
    <div class="split" style="margin-top:16px">
      <div class="card"><h3>🔥 Hot leads (14 days)</h3>
        ${d.hotLeads.map((m) => `<div class="row" style="margin:6px 0">${lead(m.lead_score)} <a href="#message?id=${m.id}">${esc(m.from_name || m.from_email)}</a><span class="hint">${esc(m.intent || m.subject)}</span><span class="spacer"></span>${badge(m.status)}</div>`).join('') || '<p class="hint">Leads the AI scores 70+ show up here.</p>'}</div>
      <div class="card"><h3>Last 14 days</h3>${bars(d.daily.map((x) => ({ label: `${x.day}: ${x.received} received, ${x.replied || 0} replied`, short: x.day.slice(5), value: x.received })))}</div>
      <div class="card"><h3>Categories (30 days)</h3>${d.byCategory.map((x) => `<div class="row" style="margin:6px 0">${badge(x.category)}<span class="spacer"></span>${x.n}</div>`).join('') || '<p class="hint">No data yet.</p>'}</div>
      <div class="card"><h3>Plan usage — ${esc(d.plan.name)}</h3>
        <p class="hint">AI replies this month: ${d.usage.ai_replies} / ${d.plan.aiRepliesPerMonth}</p><div class="bar"><i style="width:${usagePct}%"></i></div>
        <p class="hint">Emails sent: ${d.usage.emails_sent} · Email accounts: ${d.mailboxes} / ${d.plan.mailboxes}</p></div>
      <div class="card" style="grid-column:1/-1"><h3>Recent activity</h3>
        ${d.activity.map((a) => `<div class="hint" style="margin:4px 0">${fmtDate(a.created_at)} · <b>${esc(a.type.replace(/_/g, ' '))}</b> ${esc(summarize(a.detail))}</div>`).join('') || '<p class="hint">Nothing yet.</p>'}</div>
    </div>`;
  bind({ resend: async () => { await api('/auth/resend-verification', { method: 'POST' }); toast('Verification email sent'); } }, view);
};
function summarize(detail) {
  try { const d = JSON.parse(detail); return [d.to || d.from || d.email, d.subject, d.error].filter(Boolean).join(' — '); } catch { return detail || ''; }
}

// =============== Ask your inbox ===============
views.ask = async () => {
  view.innerHTML = `
    <h1>✨ Ask your inbox</h1>
    <p class="hint">Ask anything about your emails, across all accounts, in any language. Examples:</p>
    <div class="row" style="margin-bottom:12px">${['Which customers are waiting for a price quote?', 'What did Acme say about the delivery date?', 'Summarize all complaints this week', 'List emails where someone asked for a meeting']
      .map((q) => `<button class="btn sm" data-act="ex" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <form class="card" data-act="ask"><div class="row"><input name="question" id="q" placeholder="Ask a question…" style="flex:1" required><button class="btn primary">Ask</button></div></form>
    <div id="answers" style="margin-top:16px"></div>`;
  const run = async (question) => {
    const box = document.createElement('div');
    box.className = 'card';
    box.style.marginBottom = '12px';
    box.innerHTML = `<b>${esc(question)}</b><p class="hint">Thinking…</p>`;
    $('#answers').prepend(box);
    try {
      const r = await api('/ai/ask', { method: 'POST', body: { question } });
      const html = esc(r.answer).replace(/\[?#(\d+)\]?/g, '<a href="#message?id=$1">#$1</a>');
      box.innerHTML = `<b>${esc(question)}</b><div class="chat-a" style="margin-top:8px">${html}</div>${r.sources.length ? `<p class="hint" style="margin-top:10px">Sources: ${r.sources.map((s) => `<a href="#message?id=${s.id}">${esc(s.subject || s.from)}</a>`).join(' · ')}</p>` : ''}`;
    } catch (e) { box.innerHTML = `<b>${esc(question)}</b><p class="err-text">${esc(e.message)}</p>`; }
  };
  bind({ ask: async (f) => { const q = formData(f).question; f.reset(); await run(q); }, ex: async (b) => run(b.dataset.q) }, view);
};

// =============== Inbox ===============
views.inbox = async (params) => {
  const mailboxes = await api('/mailboxes');
  const msgs = await api(`/messages?${new URLSearchParams(params)}`);
  const opt = (name, values, cur, all) => `<select name="${name}"><option value="">${all}</option>${values.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  view.innerHTML = `
    <h1>Unified inbox</h1>
    <form class="row card" data-act="filter" style="margin-bottom:16px">
      <input name="q" placeholder="Search subject, sender, summary…" value="${esc(params.q || '')}" style="flex:2;min-width:180px">
      ${opt('mailbox_id', mailboxes.map((m) => [m.id, m.email]), params.mailbox_id, 'All accounts')}
      ${opt('status', ['new', 'triaged', 'drafted', 'replied', 'ignored', 'error'].map((s) => [s, s]), params.status, 'Any status')}
      ${opt('priority', ['urgent', 'high', 'normal', 'low'].map((s) => [s, s]), params.priority, 'Any priority')}
      ${opt('min_lead', [['70', 'Hot leads (70+)'], ['40', 'Leads (40+)']], params.min_lead, 'All senders')}
      <label class="check"><input type="checkbox" name="starred" ${params.starred ? 'checked' : ''}> ★</label>
      <button class="btn">Filter</button>
    </form>
    <div class="card table-wrap"><table>
      <thead><tr><th></th><th>From</th><th>Subject / AI summary</th><th>Category</th><th>Lead</th><th>Status</th><th>Received</th></tr></thead>
      <tbody>${msgs.map((m) => `<tr class="click" data-id="${m.id}">
        <td><button class="btn sm" data-act="star" data-id="${m.id}" data-s="${m.starred}" title="Star">${m.starred ? '★' : '☆'}</button></td>
        <td><b>${esc(m.from_name || m.from_email)}</b><div class="hint">${esc(m.from_email)}</div><div class="hint">→ ${esc(m.mailbox_email)}</div></td>
        <td><b>${esc(m.subject)}</b> ${m.is_phishing ? badge('phishing', 'error') : ''}<div class="hint">${esc(m.summary || '')}</div></td>
        <td>${badge(m.category)} ${m.priority !== 'normal' ? badge(m.priority) : ''}</td><td>${lead(m.lead_score)}</td><td>${badge(m.status)}</td>
        <td class="hint">${fmtDate(m.received_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="hint">No emails yet. New mail is checked every couple of minutes.</td></tr>'}
      </tbody></table></div>`;
  bind({
    filter: (f) => { const d = formData(f); d.starred = d.starred ? '1' : ''; location.hash = `inbox?${new URLSearchParams(Object.entries(d).filter(([, v]) => v))}`; },
    star: async (b) => { await api(`/messages/${b.dataset.id}/star`, { method: 'POST', body: { starred: b.dataset.s !== '1' } }); route(); },
  }, view);
  view.querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('button')) location.hash = `message?id=${tr.dataset.id}`; }));
};

views.message = async ({ id }) => {
  const m = await api(`/messages/${id}`);
  const pending = m.replies.find((r) => ['pending', 'failed', 'scheduled'].includes(r.status));
  const ex = Object.entries(m.extracted || {}).filter(([, v]) => v);
  view.innerHTML = `
    <a href="#inbox">← Back to inbox</a>
    <h1 style="margin-top:10px">${esc(m.subject || '(no subject)')}</h1>
    <div class="row" style="margin-bottom:6px">${badge(m.category)} ${badge(m.priority)} ${badge(m.sentiment)} ${badge(m.status)} ${m.language ? badge(m.language) : ''} ${m.is_phishing ? badge('phishing', 'error') : ''}
      ${m.confidence != null ? `<span class="hint">AI confidence ${pct(m.confidence)}</span>` : ''} ${m.lead_score != null ? `<span class="hint">Lead score ${lead(m.lead_score)}</span>` : ''}</div>
    ${m.reasoning ? `<p class="why">Why: ${esc(m.reasoning)}</p>` : ''}
    <div class="split">
      <div>
        <div class="card">
          <p><b>${esc(m.from_name)}</b> &lt;${esc(m.from_email)}&gt;<br><span class="hint">to ${esc(m.mailbox_email)} · ${fmtDate(m.received_at)}</span></p>
          ${m.summary ? `<p class="banner">AI summary: ${esc(m.summary)}${m.intent ? `<br><b>Wants:</b> ${esc(m.intent)}` : ''}</p>` : ''}
          <pre class="mail">${esc(m.text_body)}</pre>
        </div>
        ${m.contact ? `<div class="card" style="margin-top:16px"><div class="row"><h3 style="margin:0">Contact</h3><span class="spacer"></span><a href="#contact?id=${m.contact.id}">Open profile →</a></div>
          <dl class="kv" style="margin-top:10px"><dt>Emails</dt><dd>${m.contact.emails_in} in · ${m.contact.emails_out} out</dd>${m.contact.company ? `<dt>Company</dt><dd>${esc(m.contact.company)}</dd>` : ''}
          ${ex.map(([k, v]) => `<dt>${esc(k.replace('_', ' '))}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
          <div class="row" style="margin-top:10px"><button class="btn sm" data-act="vip">${m.contact.vip ? '★ VIP' : 'Mark VIP'}</button><button class="btn sm danger" data-act="block">${m.contact.blocked ? 'Unblock' : 'Block sender'}</button></div></div>` : ''}
      </div>
      <div class="card">
        <h3>Reply</h3>
        ${m.replies.filter((r) => r.status === 'sent').map((r) => `<div class="banner">${r.kind === 'followup' ? 'Follow-up' : 'Reply'} sent ${fmtDate(r.sent_at)} (${r.source}${r.approved_by ? '' : ', autopilot'}):<pre class="mail">${esc(r.body)}</pre></div>`).join('')}
        ${pending?.status === 'scheduled' ? `<div class="banner">⏱ Autopilot will send this at ${fmtDate(pending.scheduled_at)}. <a href="#" data-act="hold">Hold it for review</a></div>` : ''}
        ${pending?.error ? `<p class="hint">⚠ ${esc(pending.error)}</p>` : ''}
        <form data-act="send">
          <label>Subject</label><input name="subject" value="${esc(pending?.subject || `Re: ${m.subject || ''}`)}">
          <label>Message</label><textarea name="body" style="min-height:240px">${esc(pending?.body || '')}</textarea>
          <div class="row" style="margin-top:12px">
            <button class="btn primary">${pending ? 'Approve & send' : 'Send reply'}</button>
            ${pending ? '<button class="btn" type="button" data-act="reject">Discard draft</button>' : ''}
          </div>
          ${pending?.ai_original ? '<p class="hint">Edits you make are remembered — the AI learns your preferences.</p>' : ''}
        </form>
        <form data-act="redraft" style="margin-top:18px">
          <label>Ask AI to (re)write the reply</label>
          <div class="row"><input name="instructions" placeholder="e.g. offer a 10% discount, keep it short, reply in Bangla" style="flex:1"><button class="btn">✨ Draft</button></div>
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
    hold: async () => { await api(`/replies/${pending.id}/hold`, { method: 'POST' }); toast('Held for your review'); route(); },
    redraft: async (f) => {
      if (pending) await api(`/replies/${pending.id}/reject`, { method: 'POST' });
      await api(`/messages/${m.id}/draft`, { method: 'POST', body: formData(f) });
      toast('New draft ready'); route();
    },
    vip: async () => { await api(`/contacts/${m.contact.id}`, { method: 'PUT', body: { vip: !m.contact.vip } }); route(); },
    block: async () => { await api(`/contacts/${m.contact.id}`, { method: 'PUT', body: { blocked: !m.contact.blocked } }); toast(m.contact.blocked ? 'Unblocked' : 'Blocked — future emails are ignored'); route(); },
  }, view);
};

// =============== Approvals ===============
views.approvals = async () => {
  const list = await api('/replies?status=queue');
  view.innerHTML = `
    <h1>Approval queue</h1>
    <p class="hint">AI drafts and follow-ups waiting for you, plus autopilot replies in their undo window. Edit if needed, then send with one click.</p>
    ${list.map((r) => `
      <div class="card" style="margin-bottom:14px">
        <div class="row"><b>${esc(r.from_name || r.from_email)}</b><span class="hint">${esc(r.from_email)} → ${esc(r.mailbox_email)}</span><span class="spacer"></span>
          ${r.kind === 'followup' ? badge('follow-up', 'info') : ''} ${r.status === 'scheduled' ? badge('scheduled') : ''} ${badge(r.category)} ${badge(r.priority)} ${lead(r.lead_score)}</div>
        <p style="margin:6px 0"><b>${esc(r.original_subject)}</b> — <span class="hint">${esc(r.summary || '')}</span></p>
        ${r.status === 'scheduled' ? `<p class="banner">⏱ Sends automatically at ${fmtDate(r.scheduled_at)}</p>` : ''}
        ${r.error ? `<p class="hint">⚠ ${esc(r.error)}</p>` : ''}
        ${r.reasoning ? `<p class="why">Why: ${esc(r.reasoning)}</p>` : ''}
        <details><summary class="hint">Show original email</summary><pre class="mail">${esc(r.original_body)}</pre></details>
        <form data-act="approve" data-id="${r.id}">
          <input type="hidden" name="subject" value="${esc(r.subject)}">
          <textarea name="body" style="margin-top:10px">${esc(r.body)}</textarea>
          <div class="row" style="margin-top:10px">
            <button class="btn primary">${r.status === 'scheduled' ? 'Send now' : 'Approve & send'}</button>
            ${r.status === 'scheduled' ? `<button class="btn" type="button" data-act="hold" data-id="${r.id}">Hold</button>` : ''}
            <button class="btn" type="button" data-act="reject" data-id="${r.id}">Discard</button>
            <a class="btn" href="#message?id=${r.message_id}">Open</a>
          </div>
        </form>
      </div>`).join('') || '<div class="card hint">🎉 Nothing waiting for approval.</div>'}`;
  bind({
    approve: async (f) => { await api(`/replies/${f.dataset.id}/approve`, { method: 'POST', body: formData(f) }); toast('Sent'); route(); },
    reject: async (b) => { await api(`/replies/${b.dataset.id}/reject`, { method: 'POST' }); route(); },
    hold: async (b) => { await api(`/replies/${b.dataset.id}/hold`, { method: 'POST' }); route(); },
  }, view);
};

// =============== Contacts ===============
views.contacts = async (params) => {
  const list = await api(`/contacts?${new URLSearchParams(params)}`);
  view.innerHTML = `
    <h1>Contacts & leads</h1>
    <p class="hint">Built automatically from your emails. The AI scores every sender's buying intent and extracts company, phone, budget and deadlines.</p>
    <form class="row card" data-act="filter" style="margin-bottom:16px">
      <input name="q" placeholder="Search name, email, company, tag" value="${esc(params.q || '')}" style="flex:2">
      <select name="sort"><option value="">Most recent</option><option value="lead" ${params.sort === 'lead' ? 'selected' : ''}>Highest lead score</option></select>
      <label class="check"><input type="checkbox" name="vip" ${params.vip ? 'checked' : ''}> VIP only</label>
      <button class="btn">Filter</button><button class="btn" type="button" data-act="csv">Export CSV</button>
    </form>
    <div class="card table-wrap"><table><thead><tr><th>Contact</th><th>Company</th><th>Lead</th><th>Mood</th><th>Emails</th><th>Tags</th><th>Last email</th></tr></thead><tbody>
      ${list.map((c) => `<tr class="click" data-id="${c.id}"><td><b>${c.vip ? '★ ' : ''}${esc(c.name || c.email)}</b><div class="hint">${esc(c.email)}</div>${c.blocked ? badge('blocked', 'error') : ''}</td>
        <td>${esc(c.company || '')}<div class="hint">${esc(c.phone || '')}</div></td><td>${lead(c.lead_score)}</td><td>${badge(c.last_sentiment)}</td>
        <td>${c.emails_in} in / ${c.emails_out} out</td><td class="hint">${esc(c.tags || '')}</td><td class="hint">${fmtDate(c.last_seen)}</td></tr>`).join('') || '<tr><td colspan="7" class="hint">Contacts appear as emails arrive.</td></tr>'}
    </tbody></table></div>`;
  bind({
    filter: (f) => { const d = formData(f); d.vip = d.vip ? '1' : ''; location.hash = `contacts?${new URLSearchParams(Object.entries(d).filter(([, v]) => v))}`; },
    csv: () => csvDownload('/contacts.csv'),
  }, view);
  view.querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', () => { location.hash = `contact?id=${tr.dataset.id}`; }));
};
views.contact = async ({ id }) => {
  const c = await api(`/contacts/${id}`);
  view.innerHTML = `
    <a href="#contacts">← Contacts</a>
    <h1 style="margin-top:10px">${c.vip ? '★ ' : ''}${esc(c.name || c.email)} ${lead(c.lead_score)}</h1>
    <div class="split">
      <form class="card" data-act="save">
        <div class="grid g2"><div><label>Name</label><input name="name" value="${esc(c.name)}"></div><div><label>Company</label><input name="company" value="${esc(c.company)}"></div>
          <div><label>Phone</label><input name="phone" value="${esc(c.phone)}"></div><div><label>Tags (comma separated)</label><input name="tags" value="${esc(c.tags)}"></div></div>
        <label>Private notes (the AI uses these as context when replying)</label><textarea name="notes">${esc(c.notes)}</textarea>
        <label class="check"><input type="checkbox" name="vip" ${c.vip ? 'checked' : ''}> VIP — always high priority, never auto-sent, instant alert</label>
        <label class="check"><input type="checkbox" name="blocked" ${c.blocked ? 'checked' : ''}> Blocked — ignore all emails from this sender</label>
        <button class="btn primary">Save</button>
        <dl class="kv" style="margin-top:14px"><dt>Email</dt><dd>${esc(c.email)}</dd><dt>First seen</dt><dd>${fmtDate(c.first_seen)}</dd><dt>Emails</dt><dd>${c.emails_in} received · ${c.emails_out} sent</dd></dl>
      </form>
      <div class="card"><h3>Timeline</h3>${c.messages.map((m) => `<div style="margin:8px 0"><a href="#message?id=${m.id}"><b>${esc(m.subject || '(no subject)')}</b></a> ${badge(m.category)} ${badge(m.status)}
        <div class="hint">${fmtDate(m.received_at)} · ${esc(m.summary || '')}</div></div>`).join('') || '<p class="hint">No emails.</p>'}</div>
    </div>`;
  bind({ save: async (f) => { await api(`/contacts/${id}`, { method: 'PUT', body: formData(f) }); toast('Saved'); } }, view);
};

// =============== Analytics ===============
views.analytics = async (params) => {
  const days = params.days || 30;
  const a = await api(`/analytics?days=${days}`);
  const t = a.totals;
  const resp = t.avg_response_sec ? (t.avg_response_sec < 3600 ? `${Math.round(t.avg_response_sec / 60)} min` : `${(t.avg_response_sec / 3600).toFixed(1)} h`) : '—';
  view.innerHTML = `
    <h1>Analytics</h1>
    <div class="tabs">${[7, 30, 90, 365].map((d) => `<button data-d="${d}" class="${String(d) === String(days) ? 'on' : ''}">${d} days</button>`).join('')}</div>
    <div class="grid g4">
      <div class="card stat"><div class="n">${t.received || 0}</div><div class="l">Emails received</div></div>
      <div class="card stat"><div class="n">${a.automationRate}%</div><div class="l">Handled without you</div></div>
      <div class="card stat"><div class="n">${resp}</div><div class="l">Avg. first response time</div></div>
      <div class="card stat"><div class="n">${a.hoursSaved}h</div><div class="l">Time saved (est.)</div></div>
      <div class="card stat"><div class="n">${t.hot_leads || 0}</div><div class="l">Hot leads</div></div>
      <div class="card stat"><div class="n">${t.phishing || 0}</div><div class="l">Phishing blocked</div></div>
      <div class="card stat"><div class="n">${t.filtered || 0}</div><div class="l">Noise filtered</div></div>
      <div class="card stat"><div class="n">${a.corrections}</div><div class="l">Lessons AI learned from your edits</div></div>
    </div>
    <div class="split" style="margin-top:16px">
      <div class="card"><h3>When emails arrive (hour, UTC)</h3>${bars(Array.from({ length: 24 }, (_, h) => ({ label: `${h}:00`, short: String(h), value: a.byHour.find((x) => x.hour === h)?.n || 0 })))}</div>
      <div class="card"><h3>Replies by source</h3>${a.bySource.map((s) => `<div class="row" style="margin:6px 0">${badge(s.source)}<span class="spacer"></span>${s.n} sent (${s.autopilot} by autopilot)</div>`).join('') || '<p class="hint">No replies yet.</p>'}
        <h3 style="margin-top:14px">Sentiment</h3>${a.bySentiment.map((s) => `<div class="row" style="margin:6px 0">${badge(s.sentiment)}<span class="spacer"></span>${s.n}</div>`).join('') || '<p class="hint">—</p>'}</div>
      <div class="card"><h3>Per account</h3><table><thead><tr><th>Account</th><th>Received</th><th>Replied</th></tr></thead><tbody>${a.byMailbox.map((m) => `<tr><td>${esc(m.email)}</td><td>${m.received}</td><td>${m.replied || 0}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><h3>Top senders</h3>${a.topSenders.map((s) => `<div class="row" style="margin:5px 0"><span>${esc(s.name || s.from_email)}</span><span class="hint">${esc(s.from_email)}</span><span class="spacer"></span>${s.n}</div>`).join('') || '<p class="hint">—</p>'}</div>
      <div class="card"><h3>Categories</h3>${bars(a.byCategory.map((c) => ({ label: c.category, short: c.category.slice(0, 6), value: c.n })))}</div>
    </div>`;
  view.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { location.hash = `analytics?days=${b.dataset.d}`; }));
};

// =============== Mailboxes ===============
views.mailboxes = async (params) => {
  routeNotice(params);
  const [list, prov] = await Promise.all([api('/mailboxes'), api('/providers')]);
  const providers = prov.presets;
  const modeOpt = (cur) => ['off', 'draft', 'auto'].map((x) => `<option value="${x}" ${cur === x ? 'selected' : ''}>${{ off: 'Off (sort only)', draft: 'Draft (I approve)', auto: 'Autopilot' }[x]}</option>`).join('');
  const oneClick = [prov.oauth.google?.mailbox && '<a class="btn oauth" href="/api/oauth/google/connect">Connect Gmail / Google Workspace</a>', prov.oauth.microsoft?.mailbox && '<a class="btn oauth" href="/api/oauth/microsoft/connect">Connect Outlook / Microsoft 365</a>'].filter(Boolean);
  view.innerHTML = `
    <h1>Email accounts</h1>
    <div class="card table-wrap" style="margin-bottom:16px"><table>
      <thead><tr><th>Account</th><th>Mode</th><th>Status</th><th>Last check</th><th></th></tr></thead>
      <tbody>${list.map((m) => `<tr>
        <td><b>${esc(m.email)}</b><div class="hint">${esc(m.label || providers[m.provider]?.name || m.provider)} · ${m.auth_type === 'password' ? 'app password' : 'secure sign-in'} · ${m.message_count} emails</div></td>
        <td><select data-act="mode" data-id="${m.id}">${modeOpt(m.mode)}</select></td>
        <td>${m.last_error ? `${badge('error')}<div class="hint">${esc(m.last_error).slice(0, 140)}</div>` : m.enabled ? badge('active') : badge('paused')}</td>
        <td class="hint">${fmtDate(m.last_sync_at)}</td>
        <td class="row"><button class="btn sm" data-act="sync" data-id="${m.id}">Check now</button>
          <button class="btn sm" data-act="sig" data-id="${m.id}">Signature</button>
          ${m.last_error && m.auth_type !== 'password' ? `<a class="btn sm" href="/api/oauth/${m.auth_type.replace('oauth_', '')}/connect">Reconnect</a>` : ''}
          ${m.last_error && m.auth_type === 'password' ? `<button class="btn sm" data-act="pw" data-id="${m.id}">Update password</button>` : ''}
          <button class="btn sm" data-act="toggle" data-id="${m.id}" data-en="${m.enabled}">${m.enabled ? 'Pause' : 'Resume'}</button>
          <button class="btn sm danger" data-act="del" data-id="${m.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="5" class="hint">No accounts connected yet.</td></tr>'}
      </tbody></table></div>
    ${oneClick.length ? `<div class="card" style="margin-bottom:16px"><h3>One-click connect</h3><p class="hint">Sign in with your provider — no passwords stored.</p><div class="row">${oneClick.join('')}</div></div>` : ''}
    <div class="card">
      <h3>${oneClick.length ? 'Or connect any email with IMAP / app password' : 'Connect an email account'}</h3>
      <form data-act="add">
        <div class="grid g2">
          <div><label>Provider</label><select name="provider" id="provider">${Object.entries(providers).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('')}</select>
            <p class="hint" id="provider-help"></p></div>
          <div><label>Display name (optional)</label><input name="label" placeholder="Support team"></div>
          <div><label>Email address</label><input name="email" type="email" required></div>
          <div><label>Password / App password</label><input name="password" type="password" required autocomplete="off"></div>
        </div>
        <div id="custom-fields" class="grid g2" hidden>
          <div><label>IMAP host</label><input name="imap_host" placeholder="mail.yourdomain.com"></div>
          <div><label>IMAP port</label><input name="imap_port" value="993"></div>
          <div><label>SMTP host</label><input name="smtp_host" placeholder="mail.yourdomain.com"></div>
          <div><label>SMTP port</label><input name="smtp_port" value="465"></div>
          <div><label>Username (if different from email)</label><input name="username"></div>
        </div>
        <label>Reply mode</label>
        <select name="mode"><option value="draft">Draft — AI writes, I approve (recommended to start)</option><option value="auto">Autopilot — AI sends when confident</option><option value="off">Off — just sort and summarize</option></select>
        <button class="btn primary" style="margin-top:14px">Test & connect</button>
      </form>
    </div>`;
  const sel = $('#provider');
  const upd = () => { $('#provider-help').textContent = providers[sel.value].help; $('#custom-fields').hidden = sel.value !== 'custom'; };
  sel.addEventListener('change', upd); upd();
  bind({
    add: async (f) => { toast('Testing connection…'); await api('/mailboxes', { method: 'POST', body: formData(f) }); toast('Connected! Fetching recent emails…'); route(); },
    mode: async (s) => { await api(`/mailboxes/${s.dataset.id}`, { method: 'PATCH', body: { mode: s.value } }); toast('Mode updated'); },
    sync: async (b) => { const r = await api(`/mailboxes/${b.dataset.id}/sync`, { method: 'POST' }); toast(r.error ? `Error: ${r.error}` : `Checked: ${r.stored ?? 0} new`, Boolean(r.error)); route(); },
    toggle: async (b) => { await api(`/mailboxes/${b.dataset.id}`, { method: 'PATCH', body: { enabled: b.dataset.en !== '1' } }); route(); },
    del: async (b) => { if (confirm('Remove this account and its stored emails?')) { await api(`/mailboxes/${b.dataset.id}`, { method: 'DELETE' }); route(); } },
    pw: async (b) => { const p = prompt('New password / app password'); if (p) { await api(`/mailboxes/${b.dataset.id}`, { method: 'PATCH', body: { password: p } }); toast('Saved — checking again'); await api(`/mailboxes/${b.dataset.id}/sync`, { method: 'POST' }); route(); } },
    sig: async (b) => {
      const m = list.find((x) => String(x.id) === b.dataset.id);
      modal(`<h3>Signature for ${esc(m.email)}</h3><p class="hint">Overrides the workspace signature for replies from this account.</p><form data-act="s"><textarea name="signature">${esc(m.signature || '')}</textarea><button class="btn primary" style="margin-top:10px">Save</button></form>`, (el, close) => bind({ s: async (f) => { await api(`/mailboxes/${m.id}`, { method: 'PATCH', body: formData(f) }); toast('Saved'); close(); route(); } }, el));
    },
  }, view);
};

// =============== Settings (AI brain & autopilot) ===============
views.settings = async () => {
  const [s, mailboxes, corrections] = await Promise.all([api('/settings'), api('/mailboxes'), api('/ai/corrections')]);
  const chk = (k, label) => `<label class="check"><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}> ${label}</label>`;
  const alerts = String(s.alert_on || '').split(',');
  view.innerHTML = `
    <h1>AI brain & autopilot</h1>
    <form data-act="save">
      <div class="card" style="margin-bottom:16px"><h3>Your business</h3>
        <div class="grid g2">
          <div><label>Workspace name</label><input name="name" value="${esc(s.name)}"></div>
          <div><label>Business / brand name</label><input name="business_name" value="${esc(s.business_name)}"></div>
        </div>
        <label>What does your business do? (who you serve, products, services, location)</label>
        <textarea name="business_description">${esc(s.business_description)}</textarea>
        <div class="grid g2">
          <div><label>Reply tone</label><input name="reply_tone" value="${esc(s.reply_tone)}" placeholder="friendly and professional"></div>
          <div><label>Fallback language</label><input name="default_language" value="${esc(s.default_language)}" placeholder="auto, en, bn, es…"></div>
          <div><label>Meeting booking link (Calendly, Cal.com…)</label><input name="booking_link" value="${esc(s.booking_link)}" placeholder="https://cal.com/you"></div>
        </div>
        <label>Email signature</label><textarea name="signature" style="min-height:80px">${esc(s.signature)}</textarea>
      </div>
      <div class="card" style="margin-bottom:16px"><h3>🧠 Writing style</h3>
        <p class="hint">The AI writes like you. Learn your style automatically from emails you've sent, or write it yourself.</p>
        <div class="row"><select id="style-mb" style="flex:1">${mailboxes.map((m) => `<option value="${m.id}">${esc(m.email)}</option>`).join('') || '<option value="">Connect an account first</option>'}</select><button class="btn" type="button" data-act="learn">✨ Learn my style from sent emails</button></div>
        <textarea name="style_guide" id="style-guide" style="margin-top:10px" placeholder="e.g. Short sentences. Greets with “Hi {name},”. Signs off “Cheers”. No emojis.">${esc(s.style_guide)}</textarea>
        ${chk('learn_from_edits', 'Learn from my edits — when I change an AI draft before sending, remember the correction')}
        ${corrections.length ? `<details><summary class="hint">${corrections.length} lesson(s) learned from your edits</summary>${corrections.map((c) => `<div class="card" style="margin:8px 0"><div class="hint">${esc(c.email_summary)} · ${fmtDay(c.created_at)} <a href="#" data-act="forget" data-id="${c.id}">forget</a></div><div class="split"><pre class="mail">${esc(c.ai_draft)}</pre><pre class="mail">${esc(c.final_text)}</pre></div></div>`).join('')}</details>` : ''}
      </div>
      <div class="card" style="margin-bottom:16px"><h3>🤖 Autopilot behaviour</h3>
        <div class="grid g2">
          <div><label>Only auto-send when AI confidence is at least</label><input name="auto_send_min_confidence" type="number" step="0.05" min="0" max="1" value="${esc(s.auto_send_min_confidence)}"><p class="hint">0.8 = 80%. Below this, replies wait for approval.</p></div>
          <div><label>Human-like delay before auto-sending (minutes)</label><div class="row"><input name="reply_delay_min" type="number" min="0" value="${esc(s.reply_delay_min)}" style="width:90px"> to <input name="reply_delay_max" type="number" min="0" value="${esc(s.reply_delay_max)}" style="width:90px"></div><p class="hint">Replies feel natural, and you get an undo window.</p></div>
          <div><label>Follow up with leads who don't answer after (days, 0 = off)</label><input name="followup_days" type="number" min="0" value="${esc(s.followup_days)}"></div>
          <div><label>Business hours for autopilot (JSON, blank = 24/7)</label><input name="business_hours" value="${esc(s.business_hours)}" placeholder='{"tz":"Asia/Dhaka","days":[1,2,3,4,5,6],"start":"09:00","end":"21:00"}'></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px"><h3>📬 Daily briefing & alerts</h3>
        ${chk('digest_enabled', 'Email me a morning briefing: what needs me today, hot leads, stats')}
        <div class="grid g2">
          <div><label>Briefing hour (0–23)</label><input name="digest_hour" type="number" min="0" max="23" value="${esc(s.digest_hour)}"></div>
          <div><label>My timezone</label><input name="timezone" value="${esc(s.timezone)}" placeholder="Asia/Dhaka, Europe/London, America/New_York"></div>
        </div>
        <label>Send instant alerts (Telegram / Slack, set up in <a href="#integrations">Alerts & integrations</a>) for:</label>
        <div class="row">${[['urgent', 'Urgent emails'], ['negative', 'Angry customers'], ['vip', 'VIP senders'], ['phishing', 'Phishing attempts'], ['hot_lead', 'Hot leads (80+)']].map(([k, l]) => `<label class="check"><input type="checkbox" data-alert="${k}" ${alerts.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      </div>
      <button class="btn primary">Save all settings</button>
    </form>`;
  bind({
    save: async (f) => {
      const d = formData(f);
      for (const k of ['learn_from_edits', 'digest_enabled']) d[k] = d[k] ? 1 : 0;
      d.alert_on = [...f.querySelectorAll('[data-alert]')].filter((x) => x.checked).map((x) => x.dataset.alert).join(',');
      await api('/settings', { method: 'PUT', body: d }); toast('Settings saved'); loadMe();
    },
    learn: async () => {
      const id = $('#style-mb').value;
      if (!id) throw new Error('Connect an email account first');
      toast('Reading your sent emails…');
      const r = await api('/ai/learn-style', { method: 'POST', body: { mailbox_id: id } });
      $('#style-guide').value = r.style_guide;
      toast(`Learned from ${r.samples} emails. Saved!`);
    },
    forget: async (a) => { await api(`/ai/corrections/${a.dataset.id}`, { method: 'DELETE' }); route(); },
  }, view);
};

// =============== Knowledge / templates ===============
function crudView(path, title, intro, fields, extra = '') {
  return async () => {
    const list = await api(`/${path}`);
    view.innerHTML = `
      <h1>${title}</h1><p class="hint">${intro}</p>${extra}
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
      import: async (f) => { toast('Reading page…'); const r = await api('/knowledge/import-url', { method: 'POST', body: formData(f) }); toast(`Imported ${r.chars.toLocaleString()} characters`); route(); },
    }, view);
  };
}
views.knowledge = crudView('knowledge', 'Knowledge base',
  'The AI only states facts found here: prices, packages, policies, shipping times, opening hours, FAQs, links. The more you add, the more emails can be answered automatically.',
  [['title', 'Title'], ['content', 'Content', true]],
  '<form class="card row" data-act="import" style="margin-bottom:16px"><input name="url" type="url" placeholder="https://yourwebsite.com/faq — import a page from your website" style="flex:1" required><button class="btn">Import from website</button></form>');
views.templates = crudView('templates', 'Reply templates',
  'Canned replies for rules. Tags: {{first_name}}, {{name}}, {{email}}, {{subject}}.',
  [['name', 'Name'], ['subject', 'Subject (blank = Re: original)'], ['body', 'Body', true]]);

// =============== Rules ===============
views.rules = async () => {
  const [rules, meta, templates] = await Promise.all([api('/rules'), api('/rules/meta'), api('/templates')]);
  const describe = (r) => `${r.conditions.items.map((c) => `${c.field} ${c.op.replace('_', ' ')} "${c.value}"`).join(r.conditions.match === 'any' ? ' OR ' : ' AND ') || 'every email'} → ${r.actions.map((a) => a.type.replace('_', ' ') + (a.to ? ` ${a.to}` : '') + (a.mode ? ` (${a.mode})` : '')).join(', ')}`;
  const recipes = [
    ['Complaints → manager + apology draft', { field: 'category', op: 'equals', value: 'complaint' }, { type: 'ai_reply', mode: 'draft', instructions: 'Apologize sincerely and say a manager will contact them within 24 hours.' }],
    ['Ignore receipts & invoices from tools', { field: 'subject', op: 'regex', value: '^(receipt|your invoice|payment received)' }, { type: 'ignore' }],
    ['Job applications → thank-you template', { field: 'category', op: 'equals', value: 'job_application' }, { type: 'template_reply', mode: 'auto' }],
    ['Sales leads → push to CRM webhook', { field: 'category', op: 'equals', value: 'sales_inquiry' }, { type: 'webhook', url: 'https://hooks.zapier.com/…' }],
  ];
  view.innerHTML = `
    <h1>Automation rules</h1>
    <p class="hint">Rules run top to bottom on every new email. Without a matching rule, the account's reply mode decides what happens.</p>
    <div class="card" style="margin-bottom:16px">${rules.map((r) => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--border)">
      <b>${esc(r.name)}</b><span class="hint" style="flex:1">${esc(describe(r))}</span>${r.enabled ? badge('active') : badge('off')}
      <button class="btn sm danger" data-act="del" data-id="${r.id}">Delete</button></div>`).join('') || '<p class="hint">No rules yet. Start from a recipe below.</p>'}</div>
    <div class="card" style="margin-bottom:16px"><h3>Recipes</h3><div class="row">${recipes.map((x, i) => `<button class="btn sm" data-act="recipe" data-i="${i}">${esc(x[0])}</button>`).join('')}</div></div>
    <div class="card">
      <h3>New rule</h3>
      <form data-act="add" id="rule-form">
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
    recipe: (b) => {
      const [name, cond, act] = recipes[Number(b.dataset.i)];
      const f = $('#rule-form');
      f.name.value = name; f.field.value = cond.field; f.op.value = cond.op; f.value.value = cond.value;
      f.action.value = act.type; f.mode.value = act.mode || ''; f.param.value = act.instructions || act.to || act.url || '';
      $('#tpl').hidden = act.type !== 'template_reply';
      f.scrollIntoView({ behavior: 'smooth' });
    },
  }, view);
};

// =============== Integrations ===============
views.integrations = async () => {
  const [s, keys] = await Promise.all([api('/settings'), me.role === 'member' ? [] : api('/api-keys')]);
  view.innerHTML = `
    <h1>Alerts & integrations</h1>
    <form class="card" data-act="save" style="margin-bottom:16px">
      <h3>📱 Instant alerts</h3>
      <p class="hint">Get a push message for urgent emails, angry customers, VIPs, hot leads and phishing — choose which in <a href="#settings">AI brain → alerts</a>.</p>
      <label>Telegram chat ID</label><input name="telegram_chat_id" value="${esc(s.telegram_chat_id)}" placeholder="e.g. 123456789">
      <p class="hint">Open Telegram, start a chat with our alerts bot, then message @userinfobot to get your chat ID.</p>
      <label>Slack incoming webhook URL</label><input name="slack_webhook" value="${esc(s.slack_webhook)}" placeholder="https://hooks.slack.com/services/…">
      <div class="row" style="margin-top:12px"><button class="btn primary">Save</button><button class="btn" type="button" data-act="test">Send test alert</button></div>
    </form>
    <div class="card" style="margin-bottom:16px">
      <h3>🔗 Webhooks (Zapier, Make, n8n, your CRM)</h3>
      <p class="hint">Create a rule with the <b>webhook</b> action in <a href="#rules">Automation rules</a>. We POST JSON for each matching email: sender, subject, AI summary, category, priority, intent, lead score and extracted details (phone, company, budget…).</p>
    </div>
    <div class="card">
      <h3>🔑 API keys</h3>
      <p class="hint">Use the REST API at <code>${esc(location.origin)}/api/v1</code> with header <code>Authorization: Bearer mp_live_…</code> — e.g. <code>GET /api/v1/messages</code>, <code>GET /api/v1/contacts</code>, <code>POST /api/v1/messages/:id/reply</code>.</p>
      ${keys.map((k) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--border)"><b>${esc(k.name)}</b><code>${esc(k.prefix)}…</code><span class="hint">last used ${fmtDate(k.last_used_at)}</span><span class="spacer"></span><button class="btn sm danger" data-act="revoke" data-id="${k.id}">Revoke</button></div>`).join('')}
      <form class="row" data-act="key" style="margin-top:10px"><input name="name" placeholder="Key name, e.g. Zapier" style="flex:1" required><button class="btn">Create key</button></form>
    </div>`;
  bind({
    save: async (f) => { await api('/settings', { method: 'PUT', body: formData(f) }); toast('Saved'); },
    test: async () => { const r = await api('/integrations/test', { method: 'POST' }); toast(r.ok ? 'Test alert sent' : `Failed: ${r.errors.join(', ')}`, !r.ok); },
    key: async (f) => { const r = await api('/api-keys', { method: 'POST', body: formData(f) }); modal(`<h3>Your new API key</h3><p class="hint">Copy it now — it won't be shown again.</p><pre class="mail">${esc(r.key)}</pre>`); route(); },
    revoke: async (b) => { if (confirm('Revoke this key?')) { await api(`/api-keys/${b.dataset.id}`, { method: 'DELETE' }); route(); } },
  }, view);
};

// =============== Team ===============
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
      <button class="btn primary">Add</button></div></form>
    <form class="card" data-act="ws" style="margin-top:16px"><h3>Agency? Add a client workspace</h3><p class="hint">Each client gets separate accounts, knowledge base, rules and billing. Switch between them from the menu.</p>
      <div class="row"><input name="name" placeholder="Client name" style="flex:1" required><button class="btn">Create workspace</button></div></form>`;
  bind({
    add: async (f) => { await api('/team', { method: 'POST', body: formData(f) }); toast('Added'); route(); },
    del: async (b) => { await api(`/team/${b.dataset.id}`, { method: 'DELETE' }); route(); },
    ws: async (f) => { await api('/auth/workspaces', { method: 'POST', body: formData(f) }); location.hash = 'dashboard'; location.reload(); },
  }, view);
};

// =============== Billing ===============
views.billing = async (params) => {
  const [{ plans, stripeEnabled, manualInstructions }, info, payments] = await Promise.all([fetch('/api/billing/plans').then((r) => r.json()), api('/auth/me'), api('/billing/payments')]);
  const ws = info.workspace;
  let interval = params.interval || 'monthly';
  if (params.success) toast('Payment successful — thank you! Your plan will update in a few seconds.');
  const render = () => {
    view.innerHTML = `
      <h1>Billing</h1>
      <div class="card" style="margin-bottom:16px">
        <div class="row"><div><b>Current plan:</b> ${esc(info.effectivePlan.name)} ${badge(ws.subscription_status || (ws.plan === 'trial' ? 'trial' : ''))}
          <div class="hint">${ws.plan === 'trial' ? `Trial ends ${fmtDate(ws.trial_ends_at)}` : ws.billing_interval === 'once' ? 'Lifetime license — no renewals' : ws.current_period_end ? `Renews ${fmtDate(ws.current_period_end)} (${esc(ws.billing_interval)})` : ''}</div></div>
          <span class="spacer"></span>${ws.billing_interval && !['once', 'manual'].includes(ws.billing_interval) ? '<button class="btn" data-act="portal">Manage subscription & invoices</button>' : ''}</div>
      </div>
      <div style="text-align:center;margin-bottom:16px"><div class="toggle">
        <button data-i="monthly" class="${interval === 'monthly' ? 'on' : ''}">Monthly</button><button data-i="yearly" class="${interval === 'yearly' ? 'on' : ''}">Yearly (2 months free)</button></div></div>
      <div class="grid g4">${plans.map((p) => {
        const once = p.priceOnce && !p.priceMonthly;
        const amt = once ? p.priceOnce : interval === 'yearly' ? p.priceYearly : p.priceMonthly;
        const current = ws.plan === p.key && (once || ws.billing_interval === interval);
        return `<div class="card price ${params.plan === p.key || p.highlight ? 'featured' : ''}"><h3>${esc(p.name)}</h3><p class="hint">${esc(p.description || '')}</p>
          <div class="amt">$${amt ?? '—'}<small> ${once ? 'once' : interval === 'yearly' ? '/yr' : '/mo'}</small></div>
          <ul><li>${p.mailboxes} accounts</li><li>${p.aiRepliesPerMonth.toLocaleString()} AI replies/mo</li><li>${p.rules} rules</li><li>${p.teamMembers} seats</li>${(p.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
          <button class="btn primary" data-act="buy" data-plan="${p.key}" ${current || !stripeEnabled ? 'disabled' : ''}>${current ? 'Current plan' : once ? 'Buy lifetime' : 'Choose'}</button></div>`;
      }).join('')}</div>
      ${manualInstructions ? `<div class="card" style="margin-top:16px"><h3>Pay locally (bKash, bank transfer, PayPal…)</h3><pre class="mail">${esc(manualInstructions)}</pre><p class="hint">After paying, open a <a href="#support">support ticket</a> with your transaction ID and workspace name — we'll activate your plan.</p></div>` : ''}
      ${!stripeEnabled && !manualInstructions ? '<div class="banner" style="margin-top:16px">Online payments are not configured yet. Contact support to upgrade.</div>' : ''}
      <div class="card" style="margin-top:16px"><h3>Payment history</h3>${payments.map((p) => `<div class="row" style="margin:5px 0"><b>${money(p.amount, p.currency)}</b> ${badge(p.method)} ${badge(p.status)} <span class="hint">${esc(p.plan || '')} ${esc(p.interval || '')}</span><span class="spacer"></span><span class="hint">${fmtDate(p.created_at)}</span></div>`).join('') || '<p class="hint">No payments yet.</p>'}</div>`;
    view.querySelectorAll('.toggle button').forEach((b) => b.addEventListener('click', () => { interval = b.dataset.i; render(); }));
    bind({
      buy: async (b) => { const r = await api('/billing/checkout', { method: 'POST', body: { plan: b.dataset.plan, interval } }); location.href = r.url; },
      portal: async () => { const r = await api('/billing/portal', { method: 'POST' }); location.href = r.url; },
    }, view);
  };
  render();
};

// =============== Security & privacy ===============
views.security = async () => {
  const s = await api('/settings');
  view.innerHTML = `
    <h1>Security & privacy</h1>
    <div class="split">
      <div class="card"><h3>Two-factor authentication</h3>
        <p class="hint">Protect your account with an authenticator app (Google Authenticator, Authy, 1Password).</p>
        ${me.user.totp_enabled ? `${badge('enabled', 'ok')}<form class="row" data-act="off2fa" style="margin-top:10px"><input name="code" placeholder="6-digit code" inputmode="numeric" style="width:140px"><button class="btn danger">Turn off</button></form>` : '<button class="btn primary" data-act="setup2fa">Set up 2FA</button><div id="tfa"></div>'}
      </div>
      <form class="card" data-act="pw"><h3>Password</h3>
        <label>Current password</label><input type="password" name="current" autocomplete="current-password"><p class="hint">Leave blank if you signed up with Google/Microsoft.</p>
        <label>New password</label><input type="password" name="next" minlength="8" autocomplete="new-password">
        <button class="btn" style="margin-top:12px">Update password</button></form>
      <form class="card" data-act="privacy"><h3>🛡 Privacy Shield</h3>
        <label class="check"><input type="checkbox" name="privacy_shield" ${s.privacy_shield ? 'checked' : ''}> Mask card numbers, IBANs, passwords and OTP codes before emails are sent to the AI</label>
        <label>Automatically delete email contents after (days, 0 = keep)</label><input type="number" name="retention_days" min="0" value="${esc(s.retention_days)}">
        <p class="hint">Mailbox passwords and sign-in tokens are encrypted with AES-256. Your emails are never used to train AI models.</p>
        <button class="btn">Save privacy settings</button></form>
      <div class="card"><h3>Your data</h3>
        <p class="hint">Download everything we store about you (GDPR), or permanently delete your account and all workspaces you own.</p>
        <a class="btn" href="/api/auth/export">⬇ Export my data</a>
        <form data-act="delete" style="margin-top:16px"><label>Type your email to delete your account forever</label><input name="confirm" placeholder="${esc(me.user.email)}"><button class="btn danger" style="margin-top:10px">Delete my account</button></form>
      </div>
    </div>`;
  bind({
    setup2fa: async () => {
      const r = await api('/auth/2fa/setup', { method: 'POST' });
      $('#tfa').innerHTML = `<p>Scan with your authenticator app:</p><img src="${r.qr}" alt="2FA QR code" width="200" height="200"><p class="hint">Or enter: <code>${esc(r.secret)}</code></p>
        <form class="row" data-act="on2fa"><input name="code" placeholder="6-digit code" inputmode="numeric" style="width:140px"><button class="btn primary">Verify & enable</button></form>`;
      bind({ on2fa: async (f) => { await api('/auth/2fa/enable', { method: 'POST', body: formData(f) }); toast('2FA enabled'); await loadMe(); route(); } }, $('#tfa'));
    },
    off2fa: async (f) => { await api('/auth/2fa/disable', { method: 'POST', body: formData(f) }); toast('2FA disabled'); await loadMe(); route(); },
    pw: async (f) => { await api('/auth/change-password', { method: 'POST', body: formData(f) }); toast('Password updated'); f.reset(); },
    privacy: async (f) => { const d = formData(f); d.privacy_shield = d.privacy_shield ? 1 : 0; await api('/settings', { method: 'PUT', body: d }); toast('Saved'); },
    delete: async (f) => { if (!confirm('This permanently deletes your account, workspaces, emails and settings. Continue?')) return; await api('/auth/delete-account', { method: 'POST', body: formData(f) }); location.href = '/'; },
  }, view);
};

// =============== Referrals ===============
views.referrals = async () => {
  const r = await api('/referrals');
  view.innerHTML = `
    <h1>Refer & earn</h1>
    <div class="card" style="margin-bottom:16px"><h3>Earn ${r.commissionPct}% of every payment from people you refer</h3>
      <p class="hint">Share your link. When someone signs up and pays, you earn a commission on their payments.</p>
      <div class="row"><input id="ref" value="${esc(r.link)}" readonly style="flex:1"><button class="btn primary" data-act="copy">Copy link</button></div></div>
    <div class="grid g4">
      <div class="card stat"><div class="n">${r.signups}</div><div class="l">Sign-ups</div></div>
      <div class="card stat"><div class="n">${r.payments}</div><div class="l">Paid conversions</div></div>
      <div class="card stat"><div class="n">${money(r.total)}</div><div class="l">Earned</div></div>
      <div class="card stat"><div class="n">${money(r.total - r.paid)}</div><div class="l">Pending payout</div></div>
    </div>`;
  bind({ copy: async () => { await navigator.clipboard.writeText(r.link).catch(() => {}); $('#ref').select(); toast('Copied'); } }, view);
};

// =============== Support ===============
views.support = async () => {
  const list = await api('/tickets');
  view.innerHTML = `
    <h1>Help & support</h1>
    <div class="split">
      <form class="card" data-act="new"><h3>Contact support</h3>
        <label>Subject</label><input name="subject" required>
        <label>Priority</label><select name="priority"><option value="normal">Normal</option><option value="high">High — something is broken</option><option value="low">Low — question</option></select>
        <label>Message</label><textarea name="body" required></textarea>
        <button class="btn primary" style="margin-top:10px">Send</button></form>
      <div class="card"><h3>Quick answers</h3>
        <details><summary>Gmail says "invalid credentials"</summary><p class="hint">Use one-click Gmail connect, or turn on 2-Step Verification and create an App Password at myaccount.google.com/apppasswords. Your normal Gmail password won't work over IMAP.</p></details>
        <details><summary>Outlook / Microsoft 365 won't connect</summary><p class="hint">Use one-click Microsoft connect. For company accounts, your IT admin may need to allow IMAP / SMTP AUTH.</p></details>
        <details><summary>Why wasn't an email auto-replied?</summary><p class="hint">Open the email: the "Why" line and the warning on the draft explain it (low confidence, VIP, outside business hours, already replied today, needs a human…).</p></details>
        <details><summary>Can I stop a reply that's about to be sent?</summary><p class="hint">Yes — autopilot waits a few minutes. Open Approvals and press Hold.</p></details>
        <details><summary>How do I make the AI more accurate?</summary><p class="hint">Add facts to the Knowledge base, teach your writing style, and simply edit drafts — the AI learns from your edits.</p></details>
      </div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Your tickets</h3>${list.map((t) => `<div class="row" style="margin:6px 0"><a href="#ticket?id=${t.id}">#${t.id} ${esc(t.subject)}</a>${badge(t.status)}<span class="spacer"></span><span class="hint">${fmtDate(t.updated_at)}</span></div>`).join('') || '<p class="hint">No tickets yet.</p>'}</div>`;
  bind({ new: async (f) => { await api('/tickets', { method: 'POST', body: formData(f) }); toast('Sent — we will reply by email'); route(); } }, view);
};
views.ticket = async ({ id }) => {
  const t = await api(`/tickets/${id}`);
  view.innerHTML = `<a href="#support">← Support</a><h1 style="margin-top:10px">#${t.id} ${esc(t.subject)} ${badge(t.status)}</h1>
    <div class="thread">${t.messages.map((m) => `<div class="msg ${m.is_staff ? 'staff' : ''}"><div class="hint">${m.is_staff ? 'Support team' : 'You'} · ${fmtDate(m.created_at)}</div><pre class="mail" style="background:none;padding:6px 0 0">${esc(m.body)}</pre></div>`).join('')}</div>
    <form class="card" data-act="reply"><textarea name="body" required placeholder="Write a reply…"></textarea><button class="btn primary" style="margin-top:10px">Send</button></form>`;
  bind({ reply: async (f) => { await api(`/tickets/${id}/reply`, { method: 'POST', body: formData(f) }); route(); } }, view);
};

// =============== Router & shell ===============
const PARENT = { message: 'inbox', contact: 'contacts', ticket: 'support' };
async function route() {
  const [name, qs] = (location.hash.slice(1) || 'dashboard').split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  document.querySelectorAll('.side a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${PARENT[name] || name}`));
  $('#side').classList.remove('open');
  view.innerHTML = '<p class="hint">Loading…</p>';
  try { await (views[name] || views.dashboard)(params); } catch (e) { view.innerHTML = `<div class="card err-text">${esc(e.message)}</div>`; }
  api('/replies?status=queue').then((l) => { $('#pending-count').textContent = l.length; }).catch(() => {});
}

async function loadMe() {
  me = await api('/auth/me');
  const [settings, kb] = await Promise.all([api('/settings').catch(() => ({})), api('/knowledge').catch(() => [])]);
  me.settings = settings;
  me.kbCount = kb.length;
}

async function init() {
  await loadMe();
  $('#admin-link').hidden = !me.user.is_admin;
  if (me.impersonatedBy) $('#imp').innerHTML = `<div class="imp-bar">You are viewing as ${esc(me.user.email)} (admin impersonation). <a href="#" id="stop-imp">Log out</a></div>`;
  $('#announcements').innerHTML = me.announcements.map((a) => `<div class="ann ${esc(a.level)}">${esc(a.message)}</div>`).join('');
  const sw = $('#ws-switch');
  sw.innerHTML = me.workspaces.map((w) => `<option value="${w.id}" ${w.id === me.workspace.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
  sw.hidden = me.workspaces.length < 2;
  sw.addEventListener('change', async () => { await api(`/auth/workspaces/${sw.value}/switch`, { method: 'POST' }); location.hash = 'dashboard'; location.reload(); });
  const ep = me.effectivePlan;
  if (ep.key === 'expired') $('#plan-banner').innerHTML = `<div class="banner">⚠ ${ep.suspended ? 'This workspace is suspended. Contact support.' : 'Your trial or subscription has ended — email automation is paused. <a href="#billing">Choose a plan</a> to resume.'}</div>`;
  else if (me.workspace.plan === 'trial') {
    const days = Math.max(0, Math.ceil((new Date(me.workspace.trial_ends_at) - Date.now()) / 86400_000));
    $('#plan-banner').innerHTML = `<div class="banner">Free trial: ${days} day(s) left. <a href="#billing">Upgrade</a></div>`;
  }
  const logout = async (e) => { e.preventDefault(); await api('/auth/logout', { method: 'POST' }); location.href = me.impersonatedBy ? '/login' : '/'; };
  $('#logout').addEventListener('click', logout);
  $('#stop-imp')?.addEventListener('click', logout);
  $('#menu-btn').addEventListener('click', () => $('#side').classList.toggle('open'));
  window.addEventListener('hashchange', route);
  route();
}
init();
