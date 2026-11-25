// Home dashboard, assistant training (business, knowledge base, safety) and alerts & API.
import { $, esc, icon, api, toast, bind, formData, bars, hbars, badge, lead, ago, fmtDay, num, empty, label, modal, confirmBox, switchEl } from '../ui.js';

const stat = (ic, l, n, d = '', tone = '') => `<div class="card stat ${tone}"><div class="ic">${icon(ic)}</div><div class="l">${esc(l)}</div><div class="n">${n}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
const PL = { messenger: 'Messenger', instagram: 'Instagram', whatsapp: 'WhatsApp' };
const ACT = {
  chat_auto_reply: ['send', 'Chat answered by AI'], chat_approved_sent: ['checkCircle', 'Reply approved & sent'], chat_draft: ['file', 'Reply ready for review'],
  chat_handoff: ['userCheck', 'Customer needs a human'], order_created: ['card', 'New order'], channel_added: ['plug', 'Channel connected'],
  send_failed: ['alert', 'Send failed'], error: ['alert', 'Processing error'],
};
function summarize(detail) {
  try { const d = JSON.parse(detail); return [d.from || d.to || d.name, d.total != null && `${d.currency || ''} ${d.total}`, d.error].filter(Boolean).join(' — '); } catch { return detail || ''; }
}
const actLink = (a) => { try { const d = JSON.parse(a.detail || '{}'); return d.conversation ? `#chats?id=${Number(d.conversation)}` : d.order ? '#orders' : ''; } catch { return ''; } };

export async function dashboard(ctx, params) {
  if (params.verified) toast('Email verified — thank you!');
  const d = await api('/dashboard');
  const me = ctx.me;
  const manager = ['owner', 'admin'].includes(me.role);
  if (manager && !d.setup.channels && !params.stay) { location.hash = 'welcome'; return; } // the one thing to do first
  const s = d.setup;
  const steps = [
    [s.channels > 0, 'Connect your Facebook Page', '#welcome', 'plug'],
    [s.live > 0, 'Receive your first customer message', '#chats', 'chat'],
    [s.products > 0, 'Optional: add products for exact order totals', '#catalog', 'layers'],
    [Boolean(me.user.totp_enabled), 'Turn on two-factor authentication', '#security', 'lock'],
  ].filter((st) => manager || st[2] === '#security');
  const done = steps.filter((x) => x[0]).length;
  const usagePct = Math.min(100, Math.round((d.usage.ai_replies / Math.max(1, d.plan.aiRepliesPerMonth)) * 100));
  const hour = new Date().getHours();
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${me.user.name ? `, ${esc(me.user.name.split(' ')[0])}` : ''}</h1>
      <p>Here's what your AI sales assistant has been doing.</p></div>
      <div class="actions"><a class="btn" href="#saleslab">${icon('flask')}Test chat</a><a class="btn primary" href="#chats">${icon('chat')}Open conversations</a></div></div>
    ${!d.aiEnabled ? `<div class="callout warn">${icon('alert')}<div>AI is not configured on this server yet — customer messages are collected but not answered.</div></div>` : ''}
    ${!d.emailVerified ? `<div class="callout info">${icon('mail')}<div>Please confirm your email address — we sent you a link. <a href="#" data-act="resend">Resend link</a></div></div>` : ''}
    ${done < steps.length ? `<div class="card mb"><div class="card-h"><h3>Get your assistant selling</h3><span class="spacer"></span><span class="hint">${done} of ${steps.length}</span><div class="bar" style="width:140px"><i style="width:${(done / steps.length) * 100}%"></i></div></div>
      <div class="grid g3">${steps.map(([ok, l, href, ic]) => `<a class="callout ${ok ? 'ok' : ''}" style="margin:0;text-decoration:none;color:inherit" href="${href}">${icon(ok ? 'checkCircle' : ic)}<div>${ok ? `<s class="muted">${esc(l)}</s>` : `<b>${esc(l)}</b>`}</div></a>`).join('')}</div></div>` : ''}
    <div class="grid g4">
      ${stat('chat', 'Customers today', num(d.today.conversations), `${num(d.today.ordered || 0)} ordered`)}
      ${stat('alert', 'Waiting for you', `<a href="#chats?status=needs_human">${num(d.needsHuman)}</a>`, `${num(d.drafts)} drafts to approve`, d.needsHuman || d.drafts ? 'warn' : 'ok')}
      ${stat('card', 'Orders (30 days)', `<a href="#orders">${num(d.orders30.n)}</a>`, d.orders30.n ? `${esc(d.orders30.currency || '')} ${num(Math.round(d.orders30.revenue))}` : 'Confirmed in chat', 'ok')}
      ${stat('sparkles', 'Replies learned', `<a href="#learning">${num(d.learnedTotal)}</a>`, 'Keeps learning by itself', 'ok')}
    </div>
    ${d.pages.length ? `<div class="grid g3 mt">${d.pages.map((p) => `<a class="card page-card" href="#chats?channel=${p.id}" style="color:inherit;text-decoration:none">
      <div class="row nowrap"><span class="pf ${esc(p.platform)}">${esc(PL[p.platform])}</span><b class="truncate" style="flex:1">${esc(p.name || '')}</b>${p.last_error ? `<span class="badge bad">${icon('alert', 'sm')}</span>` : ''}</div>
      <div class="row" style="gap:14px"><span><b>${num(p.today)}</b> <span class="hint">chats today</span></span><span><b>${num(p.orders30)}</b> <span class="hint">orders</span></span>${p.needs_human ? `<span class="badge warn">${num(p.needs_human)} need you</span>` : ''}</div>
      <span class="hint">${icon('sparkles', 'sm')} ${num(p.learned)} replies learned · ${p.mode === 'auto' ? 'answering automatically' : p.mode === 'draft' ? 'drafts for you' : 'off'}</span></a>`).join('')}</div>` : ''}
    <div class="split mt">
      <div class="card"><div class="card-h"><h3>Messages</h3><span class="spacer"></span><span class="hint">Last 14 days</span></div>
        ${bars(d.daily.map((x) => ({ label: `${x.day}: ${x.received} received, ${x.answered || 0} answered`, short: x.day.slice(5), value: x.received })))}</div>
      <div class="card"><div class="card-h"><h3>${icon('flame')} Ready to buy</h3><span class="spacer"></span><a href="#chats" class="hint">All chats →</a></div>
        ${d.hotLeads.map((c) => `<a class="row nowrap" style="padding:8px 0;border-bottom:1px solid var(--border);color:inherit;text-decoration:none" href="#chats?id=${c.id}">${icon('chat', 'sm')}
          <div class="truncate" style="flex:1"><b>${esc(c.customer_name || `${PL[c.platform]} customer`)}</b><div class="hint truncate">${esc(c.intent || '')}</div></div><span class="badge">${esc(label(c.stage))}</span>${lead(c.lead_score)}</a>`).join('')
        || empty('flame', 'No hot leads right now', 'Customers the AI scores 70+ for buying intent appear here so you can follow up.')}</div>
      <div class="card"><div class="card-h"><h3>Where customers write</h3><span class="spacer"></span><span class="hint">Last 30 days</span></div>${hbars(d.byPlatform.map((x) => ({ label: PL[x.platform] || x.platform, value: x.n })))}</div>
      <div class="card"><div class="card-h"><h3>Plan usage</h3><span class="spacer"></span>${badge(d.plan.name, 'info')}</div>
        <div class="row" style="justify-content:space-between"><span class="hint">AI replies this month</span><b>${num(d.usage.ai_replies)} / ${num(d.plan.aiRepliesPerMonth)}</b></div>
        <div class="bar ${usagePct > 90 ? 'bad' : usagePct > 70 ? 'warn' : ''} mt-s"><i style="width:${usagePct}%"></i></div>
        <dl class="kv mt"><dt>Messages sent</dt><dd>${num(d.usage.messages_sent)}</dd><dt>Channels</dt><dd>${s.channels} / ${d.plan.channels}</dd><dt>Products</dt><dd>${s.products} / ${num(d.plan.products)}</dd></dl>
        ${usagePct > 80 && manager ? '<a class="btn sm primary mt" href="#billing">Upgrade plan</a>' : ''}</div>
    </div>
    <div class="card mt"><div class="card-h"><h3>Recent activity</h3></div>
      ${d.activity.map((a) => { const [ic, t] = ACT[a.type] || ['activity', label(a.type)]; const href = actLink(a); return `<${href ? `a href="${href}"` : 'div'} class="row nowrap" style="padding:7px 0;border-bottom:1px solid var(--border);color:inherit;text-decoration:none">${icon(ic, 'sm')}<b class="nowrap">${esc(t)}</b><span class="hint truncate" style="flex:1">${esc(summarize(a.detail))}</span><span class="hint nowrap">${ago(a.created_at)}</span></${href ? 'a' : 'div'}>`; }).join('')
      || empty('activity', 'Nothing yet', 'Activity appears once customers start messaging.')}</div>`;
  bind({ resend: async () => { await api('/auth/resend-verification', { method: 'POST' }); toast('Verification email sent'); } }, ctx.view);
}

// ---------------------------------------------------------------- assistant training
export async function brain(ctx) {
  const s = await api('/settings');
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Assistant</h1><p>Teach the assistant about your shop and decide when it must hand a chat to you.</p></div></div>
    <form data-act="save" class="col" style="gap:16px">
      <div class="card"><h3>${icon('brain')} Your shop</h3>
        <div class="grid g2"><div><label>Workspace name</label><input name="name" value="${esc(s.name)}"></div><div><label>Shop / brand name</label><input name="business_name" value="${esc(s.business_name)}"></div></div>
        <label>What do you sell and to whom?</label><textarea name="business_description" rows="4" placeholder="e.g. Dhaka-based online clothing shop for young men: hoodies, panjabis and jackets. Cash on delivery all over Bangladesh. Inside Dhaka delivery in 1-2 days.">${esc(s.business_description)}</textarea>
        <div class="grid g3"><div><label>Tone</label><input name="reply_tone" value="${esc(s.reply_tone)}" placeholder="friendly and helpful"></div>
          <div><label>Fallback language</label><input name="default_language" value="${esc(s.default_language)}" placeholder="auto, bn, en …"></div>
          <div><label>Time zone</label><input name="timezone" value="${esc(s.timezone)}" placeholder="Asia/Dhaka"></div></div>
      </div>
      <div class="card"><h3>${icon('shieldCheck')} Safety & hand-off</h3>
        <p class="hint">Even on Auto-pilot, a reply is held for you when a check fails. Prices not in your catalog are always held.</p>
        <label>Auto-send only when the AI is at least this confident</label>
        <select name="auto_send_min_confidence">${[[0.6, '60%'], [0.7, '70%'], [0.8, '80% (recommended)'], [0.9, '90%'], [0.95, '95%']].map(([v, l]) => `<option value="${v}" ${Number(s.auto_send_min_confidence) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label>Topics that always go to a human <span class="hint">(comma separated)</span></label><input name="sensitive_topics" value="${esc(s.sensitive_topics)}">
        <label>Never say <span class="hint">(words or phrases, comma separated)</span></label><input name="never_say" value="${esc(s.never_say)}" placeholder="guaranteed, 100% original, free delivery">
        <label>Links the AI may share <span class="hint">(domains)</span></label><input name="allowed_link_domains" value="${esc(s.allowed_link_domains)}" placeholder="yourshop.com"><div class="field-hint">Links written in your knowledge base or product photos are always allowed.</div>
      </div>
      <div class="card"><h3>${icon('users')} Customers & team</h3>
        <div class="setting-row"><div><div class="t">Tell customers about their order</div><div class="d">A message when an order is confirmed, shipped (with tracking), delivered or cancelled. On WhatsApp after 24 hours it uses your order-update templates (Broadcasts → WhatsApp templates).</div></div>${switchEl('notify_customers', s.notify_customers)}</div>
        <div class="setting-row"><div><div class="t">Share chats that need a person among the team</div><div class="d">Each hand-off goes to the next teammate in turn.</div></div>${switchEl('auto_assign', s.auto_assign)}</div>
        <div class="setting-row"><div><div class="t">Say it's an AI assistant</div><div class="d">The first reply in a new chat mentions that it's the shop's AI assistant and a person can join.</div></div>${switchEl('ai_disclosure', s.ai_disclosure)}</div>
        <div class="setting-row"><div><div class="t">Ask "How did we do?" when a chat is closed</div><div class="d">Three tap buttons (good / OK / bad); results in Analytics. At most once a week per customer.</div></div>${switchEl('csat_enabled', s.csat_enabled)}</div>
        <label>A customer waiting longer than this is "Overdue" (minutes)</label><input name="sla_minutes" type="number" min="1" max="1440" value="${s.sla_minutes || 15}" style="max-width:160px"></div>
      <div><button class="btn primary lg" type="submit">Save changes</button></div>
    </form>`;
  bind({ save: async (f) => { await api('/settings', { method: 'PUT', body: formData(f) }); toast('Saved'); } }, ctx.view);
}

export async function knowledge(ctx) {
  const list = await api('/knowledge');
  const ideas = [['Delivery charges', 'Inside Dhaka: ৳70 (1-2 days)\nOutside Dhaka: ৳130 (2-4 days)'], ['Payment methods', 'Cash on delivery all over Bangladesh. bKash/Nagad: 01XXXXXXXXX (Merchant).'],
    ['Return & exchange', 'Size exchange within 3 days if the tag is intact. No refund on sale items.'], ['Shop hours & contact', 'Online orders 24/7. Phone support 10am–8pm.']];
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Knowledge base</h1><p>Everything the assistant may say besides your products — delivery, payment, returns, size guides, FAQs. Amounts that appear nowhere here or in your catalog are never sent automatically.</p></div>
      <div class="actions"><button class="btn primary" data-act="new">${icon('plus')}Add entry</button></div></div>
    ${!list.length ? `<div class="card mb"><h3>${icon('sparkles')} Start with these</h3><p class="hint">Click one to add it, then edit the details.</p><div class="row">${ideas.map(([t], i) => `<button class="chip" data-act="idea" data-i="${i}">${esc(t)}</button>`).join('')}</div></div>` : ''}
    ${list.map((x) => `<div class="card mb"><form data-act="save" data-id="${x.id}"><label>Title</label><input name="title" value="${esc(x.title)}">
      <label>Content</label><textarea name="content" rows="4">${esc(x.content)}</textarea>
      <div class="row mt"><button class="btn" type="submit">Save</button><span class="spacer"></span><button class="btn ghost danger" type="button" data-act="del" data-id="${x.id}">${icon('trash')}Delete</button></div></form></div>`).join('')}`;
  const add = (title = '', content = '') => modal(`<h2>Add knowledge</h2><form data-act="add"><label>Title</label><input name="title" required value="${esc(title)}"><label>Content</label><textarea name="content" rows="6" required>${esc(content)}</textarea><button class="btn primary mt" type="submit">Add</button></form>`,
    (el, close) => bind({ add: async (f) => { await api('/knowledge', { method: 'POST', body: formData(f) }); close(); toast('Added'); ctx.route(); } }, el));
  bind({
    new: () => add(),
    idea: (b) => add(...ideas[Number(b.dataset.i)]),
    save: async (f) => { await api(`/knowledge/${f.dataset.id}`, { method: 'PUT', body: formData(f) }); toast('Saved'); },
    del: async (b) => { if (await confirmBox('Delete this entry?', 'The assistant will no longer use it.', { danger: true, ok: 'Delete' })) { await api(`/knowledge/${b.dataset.id}`, { method: 'DELETE' }); ctx.route(); } },
  }, ctx.view);
}

// ---------------------------------------------------------------- alerts & API
export async function integrations(ctx) {
  const [s, keys] = await Promise.all([api('/settings'), api('/api-keys')]);
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Alerts & API</h1><p>Get a ping on your phone for new orders and chats that need you, and connect your other tools.</p></div></div>
    <div class="split">
      <form class="card" data-act="save"><h3>${icon('bell')} Phone & team alerts</h3>
        <p class="hint">You're alerted for every new order and every customer who needs a human. Alerts never include the chat content.</p>
        <label>Telegram chat ID</label><input name="telegram_chat_id" value="${esc(s.telegram_chat_id)}" placeholder="123456789"><div class="field-hint">Start a chat with our alerts bot, then message @userinfobot to see your ID.</div>
        <label>Slack incoming webhook</label><input name="slack_webhook" value="${esc(s.slack_webhook)}" placeholder="https://hooks.slack.com/services/…">
        <div class="row mt"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="test">${icon('send')}Send test alert</button></div></form>
      <div class="card"><div class="card-h"><h3>${icon('key')} API keys</h3></div>
        <p class="hint">REST API at <code>${esc(location.origin)}/api/v1</code> with <code>Authorization: Bearer cp_live_…</code> — e.g. <code>GET /api/v1/sales/orders</code>, <code>GET /api/v1/sales/conversations</code>, <code>POST /api/v1/sales/products</code>. Keys can't access billing, account or admin endpoints.</p>
        <form class="row nowrap" data-act="key"><input name="name" placeholder="Key name, e.g. Courier app" required style="flex:1"><button class="btn primary" type="submit">Create key</button></form>
        ${keys.map((k) => `<div class="row nowrap" style="padding:10px 0;border-top:1px solid var(--border);margin-top:10px">${icon('key', 'sm')}<b>${esc(k.name)}</b><code>${esc(k.prefix)}…</code><span class="hint">created ${fmtDay(k.created_at)} · used ${ago(k.last_used_at)}</span><span class="spacer"></span><button class="btn sm ghost danger" data-act="revoke" data-id="${k.id}">Revoke</button></div>`).join('') || '<p class="hint mt">No keys yet.</p>'}</div>
    </div>`;
  bind({
    save: async (f) => { await api('/settings', { method: 'PUT', body: formData(f) }); toast('Saved'); },
    test: async () => { const r = await api('/integrations/test', { method: 'POST' }); toast(r.ok ? 'Test alert sent' : `Failed: ${r.errors.join(', ')}`, !r.ok); },
    key: async (f) => { const r = await api('/api-keys', { method: 'POST', body: formData(f) }); modal(`<h2>Your new API key</h2><div class="callout warn">${icon('alert')}<div>Copy it now — for your security it won't be shown again.</div></div><pre style="word-break:break-all;white-space:pre-wrap">${esc(r.key)}</pre>`); ctx.route(); },
    revoke: async (b) => { if (await confirmBox('Revoke this key?', 'Apps using it will stop working immediately.', { danger: true, ok: 'Revoke' })) { await api(`/api-keys/${b.dataset.id}`, { method: 'DELETE' }); ctx.route(); } },
  }, ctx.view);
  void $; void switchEl;
}
