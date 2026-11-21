import { esc, icon, api, toast, bind, formData, bars, hbars, badge, lead, avatar, ago, fmtDate, money, num, empty, label } from '../ui.js';

const stat = (ic, l, n, d = '', tone = '') => `<div class="card stat ${tone}"><div class="ic">${icon(ic)}</div><div class="l">${esc(l)}</div><div class="n">${n}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
function summarize(detail) {
  try { const d = JSON.parse(detail); return [d.to || d.from || d.email, d.subject, d.error].filter(Boolean).join(' — '); } catch { return detail || ''; }
}
const ACT_ICON = { auto_reply_sent: 'send', reply_approved_sent: 'checkCircle', draft_created: 'file', phishing_blocked: 'shield', sync_error: 'alert', send_failed: 'alert', followup_sent: 'reply', mailbox_added: 'mail', sla_breach: 'clock', forwarded: 'send', assigned: 'userCheck' };

export async function dashboard(ctx, params) {
  if (params.verified) toast('Email verified — thank you!');
  const [d, settings, kb] = await Promise.all([api('/dashboard'), api('/settings'), api('/knowledge')]);
  const c = d.counts;
  const me = ctx.me;
  const steps = [
    [d.mailboxes > 0, 'Connect your first email account', '#mailboxes', 'mail'],
    [Boolean(settings.business_description), 'Tell the AI about your business', '#brain', 'brain'],
    [kb.length > 0, 'Add prices, policies & FAQs to the knowledge base', '#knowledge', 'book'],
    [Boolean(settings.style_guide), 'Teach the AI your writing style', '#brain', 'wand'],
    [Boolean(settings.telegram_chat_id || settings.slack_webhook), 'Get urgent alerts on your phone', '#integrations', 'bell'],
    [Boolean(me.user.totp_enabled), 'Protect your account with two-factor authentication', '#security', 'lock'],
  ].filter((st) => ['owner', 'admin'].includes(me.role) || st[2] === '#security'); // members only see what they can do
  const done = steps.filter((s) => s[0]).length;
  const usagePct = Math.min(100, Math.round((d.usage.ai_replies / Math.max(1, d.plan.aiRepliesPerMonth)) * 100));
  const hour = new Date().getHours();
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${me.user.name ? `, ${esc(me.user.name.split(' ')[0])}` : ''}</h1>
      <p>Here's what your AI assistant has been doing.</p></div>
      <div class="actions"><a class="btn" href="#ask">${icon('sparkles')}Ask AI</a><a class="btn primary" href="#inbox">${icon('inbox')}Open inbox</a></div></div>
    ${!d.aiEnabled ? `<div class="callout warn">${icon('alert')}<div>AI is not configured on this server yet, so emails are sorted with basic keyword rules only.</div></div>` : ''}
    ${!d.emailVerified ? `<div class="callout info">${icon('mail')}<div>Please confirm your email address — we sent you a link. <a href="#" data-act="resend">Resend link</a></div></div>` : ''}
    ${d.mailboxErrors ? `<div class="callout bad">${icon('alert')}<div>${d.mailboxErrors} email account${d.mailboxErrors > 1 ? 's need' : ' needs'} attention. <a href="#mailboxes">Fix now</a></div></div>` : ''}
    ${done < steps.length ? `<div class="card mb"><div class="card-h"><h3>Finish setting up</h3><span class="spacer"></span><span class="hint">${done} of ${steps.length}</span><div class="bar" style="width:140px"><i style="width:${(done / steps.length) * 100}%"></i></div></div>
      <div class="grid g3">${steps.map(([ok, l, href, ic]) => `<a class="callout ${ok ? 'ok' : ''}" style="margin:0;text-decoration:none;color:inherit" href="${href}">${icon(ok ? 'checkCircle' : ic)}<div>${ok ? `<s class="muted">${esc(l)}</s>` : `<b>${esc(l)}</b>`}</div></a>`).join('')}</div></div>` : ''}
    <div class="grid g4">
      ${stat('inbox', 'Emails handled', num(c.total), `${num(c.last24h)} in the last 24 hours`)}
      ${stat('checkCircle', 'Waiting for you', num(c.awaiting_approval), d.scheduled ? `${d.scheduled} auto-replies about to send` : 'Drafts ready to approve', c.awaiting_approval ? 'warn' : 'ok')}
      ${stat('clock', 'Overdue (SLA)', num(c.overdue), 'Past your response-time target', c.overdue ? 'bad' : 'ok')}
      ${stat('target', 'AI accuracy', d.aiAccuracy == null ? '—' : `${d.aiAccuracy}%`, 'Drafts sent without edits (30d)', 'ok')}
      ${stat('dollar', 'Value saved', d.moneySaved ? money(d.moneySaved) : `${(d.minutesSaved / 60).toFixed(1)}h`, `${(d.minutesSaved / 60).toFixed(1)} hours of email work`, 'ok')}
    </div>
    <div class="split mt">
      <div class="card"><div class="card-h"><h3>Email volume</h3><span class="spacer"></span><span class="hint">Last 14 days</span></div>
        ${bars(d.daily.map((x) => ({ label: `${x.day}: ${x.received} received, ${x.replied || 0} replied`, short: x.day.slice(5), value: x.received })))}</div>
      <div class="card"><div class="card-h"><h3>${icon('flame')} Hot leads</h3><span class="spacer"></span><a href="#contacts?sort=lead" class="hint">All leads →</a></div>
        ${d.hotLeads.map((m) => `<a class="row nowrap" style="padding:8px 0;border-bottom:1px solid var(--border);color:inherit;text-decoration:none" href="#message?id=${m.id}">${avatar(m.from_name, m.from_email, 'sm')}
          <div class="truncate" style="flex:1"><b>${esc(m.from_name || m.from_email)}</b><div class="hint truncate">${esc(m.intent || m.subject)}</div></div>${lead(m.lead_score)}</a>`).join('') || empty('flame', 'No hot leads yet', 'Senders the AI scores 70+ for buying intent appear here.')}</div>
      <div class="card"><div class="card-h"><h3>What's arriving</h3><span class="spacer"></span><span class="hint">Last 30 days</span></div>${hbars(d.byCategory.map((x) => ({ label: x.category, value: x.n })))}</div>
      <div class="card"><div class="card-h"><h3>Plan usage</h3><span class="spacer"></span>${badge(d.plan.name, 'info')}</div>
        <div class="row" style="justify-content:space-between"><span class="hint">AI replies this month</span><b>${num(d.usage.ai_replies)} / ${num(d.plan.aiRepliesPerMonth)}</b></div>
        <div class="bar ${usagePct > 90 ? 'bad' : usagePct > 70 ? 'warn' : ''} mt-s"><i style="width:${usagePct}%"></i></div>
        <dl class="kv mt"><dt>Emails sent</dt><dd>${num(d.usage.emails_sent)}</dd><dt>Email accounts</dt><dd>${d.mailboxes} / ${d.plan.mailboxes}</dd><dt>AI actions</dt><dd>${num(d.usage.ai_calls)} / ${num(d.plan.aiCalls)}</dd></dl>
        ${usagePct > 80 ? '<a class="btn sm primary mt" href="#billing">Upgrade plan</a>' : ''}</div>
    </div>
    <div class="card mt"><div class="card-h"><h3>Recent activity</h3></div>
      ${d.activity.map((a) => `<div class="row nowrap" style="padding:7px 0;border-bottom:1px solid var(--border)">${icon(ACT_ICON[a.type] || 'activity', 'sm')}<b class="nowrap" style="text-transform:capitalize">${esc(label(a.type))}</b><span class="hint truncate" style="flex:1">${esc(summarize(a.detail))}</span><span class="hint nowrap">${ago(a.created_at)}</span></div>`).join('') || empty('activity', 'Nothing yet', 'Activity appears once emails start flowing.')}</div>`;
  bind({ resend: async () => { await api('/auth/resend-verification', { method: 'POST' }); toast('Verification email sent'); } }, ctx.view);
}

export async function ask(ctx) {
  const examples = ['Which customers are waiting for a price quote?', 'Summarize all complaints from this week', 'What did my biggest leads ask for?', 'List emails where someone wants a meeting'];
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>${icon('sparkles', 'lg')} Ask AI</h1><p>Ask anything about your emails — across every connected account, in any language.</p></div></div>
    <form class="card" data-act="ask" style="padding:14px"><div class="row nowrap"><div class="input-icon" style="flex:1">${icon('search')}<input name="question" placeholder="e.g. Who asked about bulk pricing this month?" required autocomplete="off"></div><button class="btn primary" type="submit">${icon('sparkles')}Ask</button></div>
      <div class="chips mt-s">${examples.map((q) => `<button type="button" class="chip" data-act="ex" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></form>
    <div id="answers" class="col mt"></div>
    <p class="hint mt">${icon('lock', 'sm')} Answers are generated from your own emails only. Sensitive data like card numbers is masked before the AI sees it.</p>`;
  const answers = ctx.view.querySelector('#answers');
  const run = async (question) => {
    const box = document.createElement('div');
    box.className = 'card';
    box.innerHTML = `<div class="row nowrap"><b>${esc(question)}</b></div><div class="skeleton mt" style="height:60px"></div>`;
    answers.prepend(box);
    try {
      const r = await api('/ai/ask', { method: 'POST', body: { question } });
      const html = esc(r.answer).replace(/\[?#(\d+)\]?/g, '<a href="#message?id=$1">#$1</a>');
      box.innerHTML = `<div class="row nowrap">${icon('sparkles')}<b>${esc(question)}</b></div><div style="white-space:pre-wrap;line-height:1.65;margin-top:10px">${html}</div>
        ${r.sources.length ? `<div class="chips mt">${r.sources.map((s) => `<a class="chip" href="#message?id=${s.id}">${icon('mail', 'sm')} ${esc(s.subject || s.from)}</a>`).join('')}</div>` : ''}`;
    } catch (e) { box.innerHTML = `<b>${esc(question)}</b><p class="err-text">${esc(e.message)}</p>`; }
  };
  bind({ ask: async (f) => { const q = formData(f).question; f.reset(); await run(q); }, ex: async (b) => run(b.dataset.q) }, ctx.view);
}

export async function approvals(ctx) {
  const list = await api('/replies?status=queue');
  const card = (r) => `
    <div class="card mb" id="ap-${r.id}">
      <div class="row nowrap">${avatar(r.from_name, r.from_email)}<div class="truncate" style="flex:1"><b>${esc(r.from_name || r.from_email)}</b> <span class="hint">${esc(r.from_email)}</span>
        <div class="hint truncate">${esc(r.original_subject)} · to ${esc(r.mailbox_email)}</div></div>
        <div class="row">${r.kind === 'followup' ? badge('follow-up', 'info') : ''}${r.status === 'scheduled' ? badge('scheduled') : ''}${r.status === 'failed' ? badge('failed') : ''}${badge(r.category)}${r.priority !== 'normal' ? badge(r.priority) : ''}${lead(r.lead_score)}</div></div>
      ${r.summary ? `<p class="mt-s" style="margin-bottom:6px">${esc(r.summary)}</p>` : ''}
      ${r.status === 'scheduled' ? `<div class="callout primary mt-s">${icon('clock')}<div>Autopilot will send this ${ago(r.scheduled_at)} (${fmtDate(r.scheduled_at)}). You can still edit or hold it.</div></div>` : ''}
      ${r.guard?.length ? `<div class="callout warn mt-s">${icon('shield')}<div><b>Held for your review:</b><ul class="flag-list">${r.guard.map((g) => `<li>${esc(g.replace(/^guard: /, 'Safety check: '))}</li>`).join('')}</ul></div></div>` : r.error ? `<div class="callout warn mt-s">${icon('info')}<div>${esc(r.error)}</div></div>` : ''}
      <details class="mt-s"><summary class="hint" style="cursor:pointer">Show original email</summary><div class="mail-card mt-s"><pre class="mail-body">${esc(r.original_body)}</pre></div></details>
      <form data-act="approve" data-id="${r.id}" class="mt">
        <input type="hidden" name="subject" value="${esc(r.subject)}">
        <div class="reply-box"><textarea name="body" aria-label="Reply">${esc(r.body)}</textarea>
          <div class="rb-f"><button class="btn primary" type="submit">${icon('send')}${r.status === 'scheduled' ? 'Send now' : 'Approve & send'}</button>
            ${r.status === 'scheduled' ? `<button class="btn" type="button" data-act="hold" data-id="${r.id}">${icon('undo')}Hold</button>` : ''}
            <button class="btn ghost" type="button" data-act="reject" data-id="${r.id}">${icon('trash')}Discard</button>
            <span class="spacer"></span><a class="btn ghost" href="#message?id=${r.message_id}">${icon('external')}Open</a></div></div>
        <p class="hint mt-s">${icon('brain', 'sm')} Your edits teach the AI — next time it writes it your way.</p>
      </form>
    </div>`;
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Approvals</h1><p>AI drafts and follow-ups waiting for you, plus autopilot replies still in their undo window.</p></div>
      ${list.length > 1 ? '<div class="actions"><button class="btn" data-act="approveAll">Approve all safe drafts</button></div>' : ''}</div>
    ${list.map(card).join('') || `<div class="card">${empty('checkCircle', "You're all caught up", 'New drafts appear here when the AI wants your approval.')}</div>`}`;
  bind({
    approve: async (f) => { await api(`/replies/${f.dataset.id}/approve`, { method: 'POST', body: formData(f) }); toast('Sent'); ctx.route(); },
    reject: async (b) => { await api(`/replies/${b.dataset.id}/reject`, { method: 'POST' }); toast('Draft discarded'); ctx.route(); },
    hold: async (b) => { await api(`/replies/${b.dataset.id}/hold`, { method: 'POST' }); toast('Held for review'); ctx.route(); },
    approveAll: async () => {
      const safe = list.filter((r) => !r.guard?.length && r.status === 'pending' && !r.error);
      if (!safe.length) { toast('No drafts without warnings — review them one by one', true); return; }
      const { confirmBox } = await import('../ui.js');
      if (!(await confirmBox('Approve all safe drafts?', `${safe.length} draft(s) with no warnings will be sent now.`, { ok: `Send ${safe.length}` }))) return;
      let ok = 0;
      for (const r of safe) { try { await api(`/replies/${r.id}/approve`, { method: 'POST', body: {} }); ok++; } catch { /* continue */ } }
      toast(`Sent ${ok} of ${safe.length}`); ctx.route();
    },
  }, ctx.view);
}
