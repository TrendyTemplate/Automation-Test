// ChatPilot: conversations (chat-first, three panes), orders, products, channels (Connect with Facebook) and test chat.
import { $, $$, esc, icon, api, toast, bind, formData, modal, confirmBox, ago, fmtDate, num, empty, label, lead, csvDownload, switchEl } from '../ui.js';
import { chatMenu, commentRules } from './automation.js';
import { orderForm, fraudBadge } from './orders.js';

const PL = { messenger: { name: 'Messenger' }, instagram: { name: 'Instagram' }, whatsapp: { name: 'WhatsApp' } };
const plBadge = (p) => `<span class="pf ${esc(p)}">${esc(PL[p]?.name || p)}</span>`;
const STAGE_TONE = { ordered: 'ok', ordering: 'primary', negotiating: 'warn', interested: 'info', lost: 'bad', support: '' };
const stageBadge = (s) => `<span class="badge ${STAGE_TONE[s] || ''}">${esc(label(s))}</span>`;
const fmtMoney = (n, cur) => `${esc(cur)} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const who = (c) => c.customer_name || (c.kind === 'comment' ? 'Commenter' : c.platform === 'whatsapp' ? `+${c.customer_id}` : `${PL[c.platform]?.name || ''} customer ${String(c.customer_id).slice(-4)}`);
const initials = (c) => (c.customer_name ? c.customer_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('') : (PL[c.platform]?.name || '?')[0]);
const HUES = [160, 15, 200, 280, 35, 330, 100];
const cav = (c, cls = '') => `<span class="cav ${esc(c.platform)} ${cls}" style="background:hsl(${HUES[(Number(c.id) || 0) % HUES.length]} 55% 42%)" aria-hidden="true">${esc(initials(c))}</span>`;
const canManage = (ctx) => ['owner', 'admin'].includes(ctx.me.role);
/** "/" in a reply box opens your saved replies; {{name}}, {{phone}}, {{address}} are filled in. */
let SR = null;
function savedReplies(ta, c) {
  const fill = (t) => t.replace(/\{\{\s*name\s*\}\}/gi, c.customer_name || '').replace(/\{\{\s*phone\s*\}\}/gi, c.customer_phone || '').replace(/\{\{\s*address\s*\}\}/gi, c.customer_address || '');
  let pop = null; let idx = 0; let items = [];
  const hide = () => { if (pop) { pop.parentElement?.removeChild(pop); pop = null; } };
  const pick = (r) => { ta.value = ta.value.replace(/(^|\s)\/[^\s]*$/, `$1${fill(r.body)}`); hide(); ta.focus(); ta.dispatchEvent(new Event('input')); api(`/sales/saved-replies/${r.id}/used`, { method: 'POST' }).catch(() => {}); };
  const draw = () => {
    if (!pop) { pop = document.createElement('div'); pop.className = 'sr-pop menu'; ta.parentElement.style.position = 'relative'; ta.parentElement.appendChild(pop); }
    pop.innerHTML = items.length ? items.map((r, i) => `<button type="button" class="${i === idx ? 'on' : ''}" data-i="${i}"><b>/${esc(r.shortcut)}</b><span class="hint truncate">${esc(r.body)}</span></button>`).join('')
      : '<div class="hint" style="padding:8px">No saved reply yet — <a href="#" data-new>create one</a></div>';
    $$('button[data-i]', pop).forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(items[Number(b.dataset.i)]); }));
    pop.querySelector('[data-new]')?.addEventListener('mousedown', (e) => { e.preventDefault(); hide(); manageSavedReplies(); });
  };
  ta.addEventListener('input', async () => {
    const m = ta.value.match(/(?:^|\s)\/([^\s]*)$/);
    if (!m) { hide(); return; }
    SR ||= await api('/sales/saved-replies');
    const q = m[1].toLowerCase();
    items = SR.filter((r) => r.shortcut.includes(q) || r.body.toLowerCase().includes(q)).slice(0, 8); idx = 0; draw();
  });
  ta.addEventListener('keydown', (e) => {
    if (!pop || !items.length) return;
    if (e.key === 'ArrowDown') { idx = (idx + 1) % items.length; draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { idx = (idx - 1 + items.length) % items.length; draw(); e.preventDefault(); }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[idx]); }
    if (e.key === 'Escape') hide();
  });
  ta.addEventListener('blur', () => setTimeout(hide, 150));
}
export async function manageSavedReplies() {
  const list = await api('/sales/saved-replies');
  SR = list;
  modal(`<h2>Saved replies</h2><p class="hint">Type <b>/</b> in any reply box to insert one. Use {{name}}, {{phone}} or {{address}} to fill in the customer's details.</p>
    ${list.map((r) => `<form class="card mb" data-act="upd" data-id="${r.id}" style="padding:12px"><div class="row nowrap"><b style="flex:1">/${esc(r.shortcut)}</b><span class="hint">used ${num(r.uses)}×</span><button type="button" class="btn xs ghost danger" data-act="del" data-id="${r.id}">${icon('trash', 'sm')}</button></div>
      <textarea name="body" rows="2" style="min-height:60px">${esc(r.body)}</textarea><button class="btn sm mt-s" type="submit">Save</button></form>`).join('')}
    <form data-act="add" class="card" style="padding:12px"><div class="row nowrap"><input name="shortcut" placeholder="name, e.g. bkash" required style="max-width:180px"><input name="body" placeholder="bKash number 01XXXXXXXXX (Merchant). Send money and share the TrxID." required></div><button class="btn primary sm mt-s" type="submit">Add saved reply</button></form>`, (el, done) => bind({
    add: async (f) => { await api('/sales/saved-replies', { method: 'POST', body: formData(f) }); done(); manageSavedReplies(); },
    upd: async (f) => { await api(`/sales/saved-replies/${f.dataset.id}`, { method: 'PUT', body: formData(f) }); toast('Saved'); SR = null; },
    del: async (b) => { await api(`/sales/saved-replies/${b.dataset.id}`, { method: 'DELETE' }); done(); manageSavedReplies(); },
  }, el), { wide: true, onClose: () => { SR = null; } });
}
const shortAgo = (d) => ago(d).replace(' ago', '').replace('just now', 'now');

// ---------------------------------------------------------------- conversations
export async function chats(ctx, params) {
  const filters = Object.fromEntries(Object.entries({ channel: params.channel, kind: params.kind, label: params.label, platform: params.platform, status: params.status, view: params.view, q: params.q }).filter(([, v]) => v));
  const sel = params.id ? await api(`/sales/conversations/${Number(params.id)}`).catch(() => null) : null; // first, so it is marked read
  const [ov, list, pages, team] = await Promise.all([api('/sales/overview'), api(`/sales/conversations?${new URLSearchParams(filters)}`), api('/sales/pages'), api('/sales/team-members')]);
  if (sel) sel.team = team;
  const many = pages.length > 1;
  const q = (over) => `#chats?${new URLSearchParams(Object.fromEntries(Object.entries({ ...filters, ...over }).filter(([, v]) => v)))}`;
  const f = (text, over, on) => `<a class="${on ? 'on' : ''}" href="${q({ ...over, id: '' })}">${text}</a>`;
  const noFilter = !params.platform && !params.status && !params.view && !params.kind;
  ctx.view.innerHTML = `
    <div class="convo ${sel ? 'reading' : ''}" id="convo">
      <section class="convo-list" aria-label="Conversations">
        <div class="convo-head">
          <div class="row nowrap"><h1>Chats</h1><span class="spacer"></span><button class="btn sm ghost" data-act="saved" title="Saved replies" aria-label="Saved replies">${icon('file', 'sm')}</button><a class="btn sm" href="#saleslab">${icon('flask', 'sm')}Test</a></div>
          ${many ? `<select id="page-pick" aria-label="Page"><option value="">All pages (${pages.length})</option>${pages.map((p) => `<option value="${p.id}" ${String(p.id) === String(params.channel || '') ? 'selected' : ''}>${esc(p.name || PL[p.platform].name)} · ${esc(PL[p.platform].name)}</option>`).join('')}</select>` : ''}
          <form data-act="search" class="input-icon">${icon('search')}<input name="q" placeholder="Search name, phone, intent" value="${esc(params.q || '')}" aria-label="Search conversations"></form>
          <div class="filters">${f('All', { platform: '', status: '', view: '', kind: '' }, noFilter)}
            ${f(`Needs you <span class="n">${ov.needsHuman || ''}</span>`, { status: 'needs_human', view: '', platform: '' }, params.status === 'needs_human')}
            ${f(`Drafts <span class="n">${ov.drafts || ''}</span>`, { view: 'drafts', status: '', platform: '', kind: '' }, params.view === 'drafts')}
            ${team.length > 1 ? f('Mine', { view: 'mine', status: '', platform: '', kind: '' }, params.view === 'mine') : ''}
            ${f('Comments', { kind: 'comment', view: '', status: '', platform: '' }, params.kind === 'comment')}
            ${params.label ? f(`#${esc(params.label)} ✕`, { label: '' }, true) : ''}
            ${many ? '' : Object.entries(PL).map(([k, v]) => f(v.name, { platform: k, status: '', view: '', kind: '' }, params.platform === k)).join('')}</div>
        </div>
        ${setupHint(ov, ctx)}
        <div class="convo-items">${list.map((c) => `<a class="citem ${sel?.id === c.id ? 'on' : ''} ${c.unread ? 'unread' : ''}" href="${q({ id: c.id })}">
            ${cav(c)}<div class="body"><div class="top"><span class="name">${esc(who(c))}</span><span class="time">${shortAgo(c.last_inbound_at || c.created_at)}</span></div>
            <div class="row nowrap" style="gap:8px"><div class="last" style="flex:1">${esc(c.last_body || c.intent || '')}</div>${c.unread ? `<span class="count">${c.unread}</span>` : ''}</div>
            <div class="tags">${c.kind === 'comment' ? `<span class="tag">${icon('chat', 'sm')} Comment</span>` : ''}${many ? `<span class="tag page">${esc(c.channel_name || '')}</span>` : ''}${c.status === 'needs_human' ? '<span class="tag human">Needs you</span>' : ''}${c.drafts ? '<span class="tag draft">Draft ready</span>' : ''}
              ${c.stage && !['new', 'browsing'].includes(c.stage) ? `<span class="tag stage">${esc(label(c.stage))}</span>` : ''}${c.lead_score >= 70 && c.stage !== 'ordered' ? `<span class="tag hot">${icon('flame', 'sm')} Hot</span>` : ''}${(c.labels || []).map((l) => `<span class="tag lbl">#${esc(l)}</span>`).join('')}${c.assignee ? `<span class="tag">${icon('userCheck', 'sm')} ${esc(c.assignee.split(' ')[0])}</span>` : ''}</div></div></a>`).join('')
          || `<div class="convo-empty"><div><div class="art">${icon('chat')}</div><h3>No conversations yet</h3><p>Customer messages appear here as soon as a channel is connected.</p></div></div>`}</div>
      </section>
      <section class="convo-chat" aria-label="Chat">${sel ? chatPane(sel, q) : `<div class="convo-empty"><div><div class="art">${icon('chat')}</div><h3>Pick a conversation</h3><p>See the chat, approve AI drafts and step in when a customer needs you.</p></div></div>`}</section>
      ${sel ? customerPane(sel) : '<aside class="convo-side"></aside>'}
    </div>`;
  bind({ search: (form) => { location.hash = q({ q: formData(form).q, id: '' }).slice(1); }, saved: () => manageSavedReplies() }, ctx.view);
  $('#page-pick')?.addEventListener('change', (e) => { location.hash = q({ channel: e.target.value, id: '' }).slice(1); });
  if (sel) bindPane(ctx, sel);
}

function setupHint(ov, ctx) {
  const steps = [];
  if (!ov.aiEnabled) steps.push('AI is not configured on this server yet.');
  if (!ov.channels.length) steps.push(canManage(ctx) ? '<a href="#welcome">Connect your Facebook Page</a> — that\'s all it takes.' : 'Ask an owner/admin to connect a page.');
  return steps.length ? `<div class="callout primary" style="margin:12px 12px 0">${icon('sparkles')}<div>${steps.join('<br>')}</div></div>` : '';
}

function chatPane(c, q) {
  let lastDay = '';
  const items = c.messages.map((m) => {
    const day = String(m.created_at).slice(0, 10);
    const sep = day !== lastDay ? `<div class="day-sep">${esc(new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}</div>` : '';
    lastDay = day;
    if (m.direction === 'out' && ['draft', 'failed'].includes(m.status)) {
      return `${sep}<div class="draft-card"><div class="dh">${icon(m.status === 'failed' ? 'alert' : 'sparkles', 'sm')}${m.status === 'failed' ? `Send failed${m.error ? ` — ${esc(m.error)}` : ''}` : m.delivery === 'private' ? 'AI draft — private reply to their inbox' : m.delivery === 'public' ? 'AI draft — public reply under the comment' : 'AI draft — check and send'}${m.confidence != null ? `<span class="spacer"></span><span class="hint">${Math.round(m.confidence * 100)}% sure</span>` : ''}</div>
        <textarea data-draft="${m.id}" rows="${Math.min(12, String(m.body).split('\n').length + 2)}" aria-label="Draft reply">${esc(m.body)}</textarea>
        ${m.guard?.length ? `<ul>${m.guard.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
        <div class="row mt-s"><button class="btn sm primary" data-act="approve" data-id="${m.id}">${icon('send', 'sm')}Send</button><button class="btn sm ghost" data-act="reject" data-id="${m.id}">Discard</button></div></div>`;
    }
    const out = m.direction === 'out';
    const src = `${{ ai: '<span class="ai">AI</span>', human: 'You', human_app: c.kind === 'comment' ? 'Page' : 'Staff (Meta inbox)' }[m.source] || ''}${m.delivery === 'private' ? ' · 📩 private reply' : m.delivery === 'public' ? ' · public reply' : ''}`;
    return `${sep}<div class="bubble-row ${out ? 'out' : 'in'}"><div class="bubble ${out ? `out ${m.source === 'ai' ? '' : 'staff'}` : 'in'}"><div class="bubble-t">${esc(m.body)}</div></div>
      <div class="bubble-meta">${src}${src ? '·' : ''}<span>${esc(new Date(`${String(m.created_at).replace(' ', 'T')}Z`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</span></div></div>`;
  }).join('');
  return `
    <header class="chat-head"><a class="btn ghost icon-only chat-back" href="${q({ id: '' })}" aria-label="Back to chats">${icon('chevronLeft')}</a>${cav(c, 'sm')}
      <div class="who"><b>${esc(who(c))}</b><span>${plBadge(c.platform)} ${c.kind === 'comment' ? `Comment on a post${c.post_id && c.platform === 'messenger' ? ` · <a href="https://www.facebook.com/${encodeURIComponent(c.post_id)}" target="_blank" rel="noopener">open post</a>` : ''} · ` : ''}${esc(c.channel_name || '')} · ${esc(c.intent || c.summary || '')}</span></div>
      <button class="btn sm ${c.ai_paused ? 'primary' : ''}" data-act="pause" title="${c.ai_paused ? 'Let the AI answer again' : 'Stop the AI for this chat'}">${icon(c.ai_paused ? 'play' : 'userCheck', 'sm')}<span>${c.ai_paused ? 'Resume AI' : 'Take over'}</span></button>
      <button class="btn sm ghost icon-only" data-act="close" title="${c.status === 'closed' ? 'Reopen' : 'Close chat'}" aria-label="${c.status === 'closed' ? 'Reopen' : 'Close chat'}">${icon(c.status === 'closed' ? 'undo' : 'archive', 'sm')}</button></header>
    ${c.status === 'needs_human' ? `<div class="callout warn chat-alert">${icon('alert')}<div><b>Needs you:</b> ${esc(c.handoff_reason || '')} <a href="#" data-act="resolve">Mark handled</a></div></div>` : ''}
    ${c.ai_paused ? `<div class="callout chat-alert">${icon('userCheck')}<div>You're handling this chat — the AI stays quiet until you resume it.</div></div>` : ''}
    <div class="bubbles" id="bubbles">${items || '<p class="hint">No messages.</p>'}</div>
    ${c.can_reply || c.kind === 'comment' ? `<form class="composer" data-act="reply"><textarea name="body" rows="1" placeholder="${c.kind === 'comment' ? 'Reply publicly under the comment…' : 'Write a reply… (the AI pauses for 12 h)'}" aria-label="Reply"></textarea><button class="btn primary" type="submit" aria-label="Send">${icon('send')}</button></form>`
    : `<div class="window-closed">${icon('clock')}<span>Meta's 24-hour reply window has closed — you can answer when the customer writes again.</span></div>`}`;
}

function customerPane(c) {
  return `<aside class="convo-side" aria-label="Customer">${cav(c)}<h3>${esc(who(c))}</h3><p class="hint" style="text-align:center;margin:2px 0 0">${plBadge(c.platform)} · ${esc(c.channel_name || '')}</p>
    <div class="side-sec"><h4>Buying intent</h4><div class="score"><div class="bar"><i style="width:${Math.max(4, c.lead_score || 0)}%"></i></div><b>${c.lead_score ?? '—'}</b></div>
      <div class="row mt-s">${stageBadge(c.stage)}${c.language ? `<span class="badge">${esc(c.language)}</span>` : ''}</div>
      ${c.summary ? `<p class="hint mt-s">${esc(c.summary)}</p>` : ''}</div>
    <div class="side-sec"><h4>Assigned to</h4><select data-act="assign" aria-label="Assign">${['<option value="">Nobody</option>', ...(c.team || []).map((u) => `<option value="${u.id}" ${c.assigned_to === u.id ? 'selected' : ''}>${esc(u.name || u.email)}</option>`)].join('')}</select></div>
    <div class="side-sec"><h4>Labels</h4><div class="chips">${(c.labels || []).map((l) => `<a class="chip" href="#chats?label=${encodeURIComponent(l)}">#${esc(l)}</a><button class="chip" data-act="unlabel" data-l="${esc(l)}" aria-label="Remove label ${esc(l)}">✕</button>`).join('')}</div>
      <form class="row nowrap mt-s" data-act="label"><input name="label" placeholder="vip, wholesale, follow-up…" aria-label="New label"><button class="btn sm" type="submit">Add</button></form></div>
    <div class="side-sec"><h4>Team notes <span class="hint">(customer never sees these)</span></h4>${(c.notes || []).map((n) => `<div class="note-i"><b>${esc((n.author || n.author_email || '').split(' ')[0])}</b> <span class="hint">${ago(n.created_at)}</span><div>${esc(n.body)}</div></div>`).join('')}
      <form class="mt-s" data-act="note"><textarea name="body" rows="2" placeholder="Add a note for your team" style="min-height:60px"></textarea><button class="btn sm mt-s" type="submit">Save note</button></form></div>
    <form class="side-sec" data-act="saveCustomer"><h4>Delivery details</h4>
      <input name="customer_name" placeholder="Name" value="${esc(c.customer_name || '')}" aria-label="Name">
      <input name="customer_phone" placeholder="Phone" value="${esc(c.customer_phone || '')}" aria-label="Phone" class="mt-s">
      <textarea name="customer_address" placeholder="Address" rows="2" aria-label="Address" class="mt-s" style="min-height:70px">${esc(c.customer_address || '')}</textarea>
      <button class="btn sm mt-s" type="submit">Save</button></form>
    ${c.customer_phone ? '<div class="side-sec" id="fraud-side"></div>' : ''}
    <div class="side-sec"><div class="row nowrap"><h4 style="flex:1;margin:0">Orders</h4>${c.kind === 'comment' ? '' : '<button class="btn xs" data-act="neworder">+ Order</button>'}</div>${c.orders.map((o) => `<a class="order-mini" href="#orders?id=${o.id}" style="display:block;color:inherit;text-decoration:none"><div class="row nowrap"><b>#${o.id}</b><span class="spacer"></span><span class="badge">${esc(label(o.status))}</span></div>
      <div class="hint">${esc(o.items.map((l) => `${l.qty}× ${l.name}`).join(', '))}</div><b>${fmtMoney(o.total, o.currency)}</b></a>`).join('') || '<p class="hint">No orders yet.</p>'}</div>
  </aside>`;
}

function bindPane(ctx, c) {
  const el = $('#bubbles');
  if (el) el.scrollTop = el.scrollHeight;
  const ta = $('.composer textarea');
  ta?.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(160, ta.scrollHeight)}px`; });
  ta?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !document.querySelector('.sr-pop')) { e.preventDefault(); ta.form.requestSubmit(); } });
  if (ta) savedReplies(ta, c);
  bind({
    approve: async (b) => { await api(`/sales/messages/${b.dataset.id}/approve`, { method: 'POST', body: { body: $(`[data-draft="${b.dataset.id}"]`).value } }); toast('Sent'); ctx.route(); },
    reject: async (b) => { await api(`/sales/messages/${b.dataset.id}/reject`, { method: 'POST' }); ctx.route(); },
    reply: async (form) => { await api(`/sales/conversations/${c.id}/reply`, { method: 'POST', body: formData(form) }); toast('Sent'); ctx.route(); },
    pause: async () => { await api(`/sales/conversations/${c.id}`, { method: 'PUT', body: { ai_paused: !c.ai_paused } }); ctx.route(); },
    close: async () => { await api(`/sales/conversations/${c.id}`, { method: 'PUT', body: { status: c.status === 'closed' ? 'open' : 'closed' } }); ctx.route(); },
    resolve: async () => { await api(`/sales/conversations/${c.id}`, { method: 'PUT', body: { status: 'open' } }); ctx.route(); },
    saveCustomer: async (form) => { await api(`/sales/conversations/${c.id}`, { method: 'PUT', body: formData(form) }); toast('Saved'); },
    assign: async (sel) => { await api(`/sales/conversations/${c.id}`, { method: 'PUT', body: { assigned_to: sel.value || null } }); toast('Assigned'); },
    label: async (form) => { const l = formData(form).label.trim(); if (!l) return; await api(`/sales/conversations/${c.id}`, { method: 'PUT', body: { labels: [...(c.labels || []), l] } }); ctx.route(); },
    unlabel: async (b) => { await api(`/sales/conversations/${c.id}`, { method: 'PUT', body: { labels: (c.labels || []).filter((x) => x !== b.dataset.l) } }); ctx.route(); },
    note: async (form) => { await api(`/sales/conversations/${c.id}/notes`, { method: 'POST', body: formData(form) }); ctx.route(); },
    neworder: () => orderForm(ctx, { conversation_id: c.id, customer_name: c.customer_name, customer_phone: c.customer_phone, customer_address: c.customer_address }),
  }, ctx.view);
  if (c.customer_phone) fraudBadge($('#fraud-side'), c.customer_phone);
}

// ---------------------------------------------------------------- catalog
export async function catalog(ctx) {
  const list = await api('/sales/products');
  const manage = canManage(ctx);
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Products</h1><p>The assistant recommends and sells only what is listed here, at exactly these prices. Put delivery charges, payment methods and return policy in the <a href="#knowledge">Knowledge base</a>.</p></div>
      ${manage ? `<div class="actions"><button class="btn" data-act="import">${icon('download')}Import CSV</button><button class="btn primary" data-act="add">${icon('plus')}Add product</button></div>` : ''}</div>
    <div class="card pad-0"><div class="table-wrap"><table><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Options</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.active ? '' : ' <span class="badge">Hidden</span>'}${p.sku ? `<div class="hint">SKU ${esc(p.sku)}</div>` : ''}<div class="hint" style="max-width:360px;white-space:normal">${esc(p.description || '')}</div></td>
        <td class="nowrap">${fmtMoney(p.price, p.currency)}</td><td>${p.stock == null ? '<span class="hint">not tracked</span>' : p.stock > 0 ? num(p.stock) : '<span class="badge bad">Out of stock</span>'}</td>
        <td class="hint">${esc(p.variants || '')}</td><td class="nowrap">${manage ? `<button class="btn sm ghost" data-act="edit" data-id="${p.id}">Edit</button><button class="btn sm ghost danger" data-act="del" data-id="${p.id}">${icon('trash', 'sm')}</button>` : ''}</td></tr>`).join('')
      || `<tr><td colspan="5">${empty('layers', 'No products yet', 'Add products with prices so the assistant can answer “dam koto?” and take orders.')}</td></tr>`}
    </tbody></table></div></div>`;
  const form = (p = {}) => `<h2>${p.id ? 'Edit product' : 'Add product'}</h2><form data-act="save">
    <div class="grid g2"><div><label>Name</label><input name="name" required value="${esc(p.name || '')}"></div><div><label>SKU <span class="hint">(optional)</span></label><input name="sku" value="${esc(p.sku || '')}"></div>
      <div><label>Price</label><input name="price" type="number" step="0.01" min="0" required value="${p.price ?? ''}"></div><div><label>Currency</label><input name="currency" maxlength="3" value="${esc(p.currency || 'BDT')}"></div>
      <div><label>Stock <span class="hint">(empty = not tracked)</span></label><input name="stock" type="number" min="0" value="${p.stock ?? ''}"></div><div><label>Options / variants</label><input name="variants" placeholder="Sizes: M, L, XL; Colors: black, white" value="${esc(p.variants || '')}"></div></div>
    <label>Description <span class="hint">(fabric, size chart, warranty … — the AI uses this to answer questions)</span></label><textarea name="description" rows="3">${esc(p.description || '')}</textarea>
    <label>Photo URL <span class="hint">(https, optional)</span></label><input name="image_url" value="${esc(p.image_url || '')}">
    <label class="check"><input type="checkbox" name="active" ${p.active === 0 ? '' : 'checked'}> Available for sale</label>
    <button class="btn primary mt" type="submit">Save</button></form>`;
  const edit = (p) => modal(form(p), (el, close) => bind({ save: async (f) => {
    await api(p?.id ? `/sales/products/${p.id}` : '/sales/products', { method: p?.id ? 'PUT' : 'POST', body: formData(f) }); close(); toast('Saved'); ctx.route();
  } }, el), { wide: true });
  bind({
    add: () => edit(),
    edit: (b) => edit(list.find((p) => p.id === Number(b.dataset.id))),
    del: async (b) => { if (await confirmBox('Delete this product?', 'Existing orders keep their copy of the item.', { danger: true, ok: 'Delete' })) { await api(`/sales/products/${b.dataset.id}`, { method: 'DELETE' }); ctx.route(); } },
    import: () => modal(`<h2>Import products</h2><p class="hint">One product per line: <code>name,price,stock,sku,variants,description</code>. Leave stock empty if you don't track it.</p>
      <form data-act="go"><textarea name="csv" rows="8" placeholder="Black Hoodie,1200,25,HD-01,&quot;Sizes: M, L, XL&quot;,Cotton fleece"></textarea><label>Currency</label><input name="currency" value="BDT" maxlength="3">
      <button class="btn primary mt" type="submit">Import</button></form>`, (el, close) => bind({ go: async (f) => {
      const r = await api('/sales/products/import', { method: 'POST', body: formData(f) }); close();
      toast(`${r.added} product${r.added === 1 ? '' : 's'} added${r.errors.length ? ` · ${r.errors.length} skipped: ${r.errors[0]}` : ''}`, Boolean(r.errors.length && !r.added)); ctx.route();
    } }, el)),
  }, ctx.view);
}

const HOWTO = {
  messenger: `<ol><li>In <b>developers.facebook.com</b> create an app (type <i>Business</i>) and add the <b>Messenger</b> product.</li>
    <li>Under Messenger → Settings, connect your Page and <b>generate a Page access token</b> (permissions: <code>pages_messaging</code>, <code>pages_manage_metadata</code>).</li>
    <li>Copy the <b>Page ID</b> (Page → About → Page transparency) and the <b>App secret</b> (App settings → Basic).</li>
    <li>After saving here, paste the callback URL and verify token below into Messenger → Webhooks and subscribe the Page to <code>messages</code> and <code>message_echoes</code>.</li></ol>`,
  instagram: `<ol><li>Switch the Instagram account to a <b>Professional</b> account and link it to your Facebook Page.</li>
    <li>In your Meta app add <b>Instagram</b> messaging; generate a token with <code>instagram_basic</code>, <code>instagram_manage_messages</code>, <code>pages_messaging</code>.</li>
    <li><b>Account ID</b> = the Instagram professional account ID (the id in webhooks). <b>Send ID</b> = the linked Facebook Page ID.</li>
    <li>In Instagram settings → Privacy → Messages, turn on <i>Allow access to messages</i>. Then add the webhook below and subscribe to <code>messages</code>.</li></ol>`,
  whatsapp: `<ol><li>In your Meta app add <b>WhatsApp</b> and finish WhatsApp Business setup with your number.</li>
    <li>Create a <b>System user</b> in Business settings, give it the WhatsApp account and generate a permanent token (<code>whatsapp_business_messaging</code>).</li>
    <li>Copy the <b>Phone number ID</b> from WhatsApp → API setup (not the phone number itself) and the <b>App secret</b>.</li>
    <li>Add the webhook below under WhatsApp → Configuration and subscribe to <code>messages</code>.</li></ol>`,
};
const learnLine = (c) => {
  const st = c.history_stats || {};
  return { pending: 'Getting ready to learn from this page…', running: 'Learning from past chats and comments…', unavailable: 'Learns from every new chat (WhatsApp has no past-chat access).',
    failed: 'Could not read past chats — learning from every new chat instead.', done: `Learned from ${st.conversations || 0} past chats and ${st.comments || 0} comment threads; keeps learning from every reply.` }[c.history_status]
    || 'Keeps learning from every reply your team sends.';
};
const CONNECT_ERRORS = {
  not_configured: 'One-click connect is not set up on this server yet — use "Connect manually" below, or ask the platform admin to add the Meta app in Admin → Settings → Meta.',
  expired: 'The connection took too long. Please try again.', forbidden: 'Only owners and admins can connect channels.',
  no_pages: 'Facebook did not share any Page. Make sure you tick your Page in the Facebook dialog.', no_whatsapp_numbers: 'No WhatsApp number was shared. Finish WhatsApp setup in the Facebook dialog and select your number.',
  user_denied: 'You cancelled the Facebook dialog.',
};
export async function channels(ctx, params = {}) {
  const [list, meta] = await Promise.all([api('/sales/channels'), api('/sales/meta/status')]);
  const connectBtn = (kind, cls, letter, title, text) => `<div class="connect-card"><span class="logo ${cls}">${letter}</span><div style="flex:1;min-width:0"><b>${title}</b><div class="hint">${text}</div></div>
    ${meta.available ? `<a class="btn primary" href="/api/oauth/meta/connect?kind=${kind}">Connect</a>` : '<span class="badge">Manual only</span>'}</div>`;
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Channels</h1><p>Where your customers write. Connect once — replies, orders and alerts work across all of them.</p></div>
      <div class="actions"><button class="btn" data-act="add">${icon('key')}Connect manually</button></div></div>
    ${params.error ? `<div class="callout bad">${icon('alert')}<div>${esc(CONNECT_ERRORS[params.error] || params.error)}</div></div>` : ''}
    <div class="grid g3 mb">
      ${connectBtn('pages', 'fb', 'f', 'Facebook Page', 'Messenger chats from your Page')}
      ${connectBtn('pages', 'ig', 'ig', 'Instagram', 'DMs to your professional account (linked to your Page)')}
      ${connectBtn('whatsapp', 'wa', 'w', 'WhatsApp Business', 'Your WhatsApp Business number')}
    </div>
    <div class="grid g2">${list.map((c) => `<div class="card"><div class="row nowrap"><h3 style="margin:0;flex:1" class="truncate">${esc(c.name || PL[c.platform].name)}</h3>${plBadge(c.platform)}</div>
      <p class="hint mt-s">${c.managed ? `${icon('checkCircle', 'sm')} Connected with Facebook` : 'Connected manually'} · ID <code>${esc(c.external_id)}</code> · ${c.last_event_at ? `last message ${ago(c.last_event_at)}` : 'waiting for the first message…'}</p>
      ${c.last_error ? `<div class="callout bad">${icon('alert')}<div>${esc(c.last_error)}${c.managed && meta.available ? ` <a href="/api/oauth/meta/connect?kind=${c.platform === 'whatsapp' ? 'whatsapp' : 'pages'}">Reconnect</a>` : ''}</div></div>` : ''}
      ${c.managed ? '' : `<details class="mb"><summary class="hint">Webhook details</summary><dl class="kv mt-s"><dt>Callback URL</dt><dd><code>${esc(c.webhook_url)}</code> <button class="btn sm ghost" data-act="copy" data-v="${esc(c.webhook_url)}">${icon('copy', 'sm')}</button></dd>
        <dt>Verify token</dt><dd><code>${esc(c.verify_token)}</code> <button class="btn sm ghost" data-act="copy" data-v="${esc(c.verify_token)}">${icon('copy', 'sm')}</button></dd></dl></details>`}
      <form data-act="save" data-id="${c.id}"><label>How should the assistant reply?</label>
        <div class="seg">${[['off', 'Off'], ['draft', 'I approve each reply'], ['auto', 'Auto-pilot']].map(([v, l]) => `<label style="padding:6px 12px;margin:0;cursor:pointer;font-weight:600"><input type="radio" name="mode" value="${v}" ${c.mode === v ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        <p class="field-hint">Auto-pilot still holds a reply for you when a safety check fails (unknown price, low confidence, complaint, manipulation attempt).</p>
        ${c.platform === 'whatsapp' ? '' : `<label>Post comments</label><div class="seg">${[['off', 'Ignore'], ['draft', 'I approve'], ['auto', 'Answer automatically']].map(([v, l]) => `<label style="padding:6px 12px;margin:0;cursor:pointer;font-weight:600"><input type="radio" name="comment_mode" value="${v}" ${c.comment_mode === v ? 'checked' : ''}> ${l}</label>`).join('')}</div>`}
        <p class="field-hint">${icon('sparkles', 'sm')} ${learnLine(c)}</p>
        <div class="grid g2"><div><label>Follow up quiet buyers after (hours, 0 = off)</label><input name="followup_hours" type="number" min="0" max="20" value="${c.followup_hours}"></div>
          <div><label>Greeting for new chats <span class="hint">(optional)</span></label><input name="greeting" value="${esc(c.greeting || '')}" placeholder="আসসালামু আলাইকুম! কীভাবে সাহায্য করতে পারি?"></div></div>
        ${c.managed ? '' : '<details><summary class="hint">Replace token / app secret</summary><div class="grid g2"><div><label>New access token</label><input name="access_token" type="password" autocomplete="off"></div><div><label>New app secret</label><input name="app_secret" type="password" autocomplete="off"></div></div></details>'}
        <div class="row mt-s"><button type="button" class="btn sm" data-act="menu" data-id="${c.id}">${icon('list', 'sm')}Chat menu</button>${c.platform === 'whatsapp' ? '' : `<button type="button" class="btn sm" data-act="rules" data-id="${c.id}">${icon('shield', 'sm')}Comment rules</button>`}</div>
        <div class="row mt"><label class="check" style="margin:0">${switchEl('enabled', c.enabled)} Enabled</label><span class="spacer"></span>
          <button class="btn ghost danger" type="button" data-act="del" data-id="${c.id}">${icon('trash')}Disconnect</button><button class="btn primary" type="submit">Save</button></div></form></div>`).join('')
      || `<div class="card">${empty('plug', 'No channels yet', meta.available ? 'Click Connect above — Facebook will ask which Page, Instagram account or WhatsApp number to share.' : 'Use "Connect manually" with your own Meta app token.')}</div>`}</div>`;
  const addForm = (platform) => `<h2>Connect ${esc(PL[platform].name)} manually</h2><p class="hint">For shops that use their own Meta developer app.</p>
    <div class="seg mb">${Object.entries(PL).map(([k, v]) => `<a href="#" data-p="${k}" class="${k === platform ? 'on' : ''}">${esc(v.name)}</a>`).join('')}</div>
    <div class="callout mb">${icon('info')}<div>${HOWTO[platform]}</div></div>
    <form data-act="create"><input type="hidden" name="platform" value="${platform}">
      <div class="grid g2"><div><label>${platform === 'whatsapp' ? 'Phone number ID' : platform === 'instagram' ? 'Instagram account ID' : 'Page ID'}</label><input name="external_id" required inputmode="numeric" pattern="\\d{5,32}"></div>
        ${platform === 'instagram' ? '<div><label>Send ID (linked Facebook Page ID)</label><input name="send_id" inputmode="numeric" pattern="\\d{5,32}"></div>' : '<div><label>Name <span class="hint">(optional)</span></label><input name="name"></div>'}
        <div><label>Access token</label><input name="access_token" type="password" required autocomplete="off"></div><div><label>App secret</label><input name="app_secret" type="password" required autocomplete="off"></div></div>
      <label>Start in</label><select name="mode"><option value="draft">I approve each reply (recommended first)</option><option value="auto">Auto-pilot</option></select>
      <button class="btn primary mt" type="submit">Test & connect</button></form>`;
  const openAdd = (platform = 'messenger') => modal(addForm(platform), (el, close) => {
    $$('[data-p]', el).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); close(); openAdd(a.dataset.p); }));
    bind({ create: async (form) => { await api('/sales/channels', { method: 'POST', body: formData(form) }); close(); toast('Connected — now add the webhook in Meta'); ctx.route(); } }, el);
  }, { wide: true });
  bind({
    add: () => openAdd(),
    menu: (b) => chatMenu(ctx, list.find((c) => String(c.id) === b.dataset.id)),
    rules: (b) => commentRules(ctx, list.find((c) => String(c.id) === b.dataset.id)),
    copy: async (b) => { await navigator.clipboard.writeText(b.dataset.v); toast('Copied'); },
    save: async (form) => {
      const d = formData(form);
      for (const k of ['access_token', 'app_secret']) if (!d[k]) delete d[k];
      await api(`/sales/channels/${form.dataset.id}`, { method: 'PUT', body: d }); toast('Saved'); ctx.route();
    },
    del: async (b) => { if (await confirmBox('Disconnect this channel?', 'Its conversations are deleted from ChatPilot. Orders are kept.', { danger: true, ok: 'Disconnect' })) { await api(`/sales/channels/${b.dataset.id}`, { method: 'DELETE' }); ctx.route(); } },
  }, ctx.view);
}

// ---------------------------------------------------------------- test chat
export async function saleslab(ctx) {
  const turns = [];
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Test chat</h1><p>Be the customer. See exactly what the assistant would answer — nothing is sent and no orders are created.</p></div></div>
    <div class="lab-grid">
      <div class="phone"><header class="chat-head"><span class="cav sm messenger" style="background:var(--primary)">${icon('logo', 'sm')}</span><div class="who"><b>${esc(ctx.me.workspace.name)}</b><span>
        <select id="lab-pl" aria-label="Platform" style="height:26px;width:auto;padding:0 26px 0 8px;font-size:12px;border-radius:99px">${Object.entries(PL).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('')}</select></span></div>
        <button class="btn sm ghost icon-only" data-act="reset" title="Start over" aria-label="Start over">${icon('refresh', 'sm')}</button></header>
        <div class="bubbles" id="lab-b"><div class="day-sep">Try “hoodie er dam koto?”</div></div>
        <form class="composer" data-act="say"><textarea name="text" rows="1" placeholder="Write as the customer…" required aria-label="Customer message"></textarea><button class="btn primary" type="submit" aria-label="Send">${icon('send')}</button></form></div>
      <div class="card"><h3>${icon('brain')} What the assistant decided</h3><div id="lab-d" class="hint">Send a message to see stage, buying intent, order details and safety decisions.</div>
        <div class="chips mt">${['hoodie er dam koto?', 'L size ache?', 'delivery charge koto?', '2ta nibo, Rahim, 01711000000, Dhanmondi', 'discount din na'].map((t) => `<button class="chip" type="button" data-act="try" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
    </div>`;
  const draw = () => { $('#lab-b').innerHTML = turns.map((t) => `<div class="bubble-row ${t.from === 'customer' ? 'in' : 'out'}"><div class="bubble ${t.from === 'customer' ? 'in' : 'out'}"><div class="bubble-t">${esc(t.text)}</div></div></div>`).join('') || '<div class="day-sep">Try “hoodie er dam koto?”</div>'; $('#lab-b').scrollTop = 1e9; };
  const say = async (text) => {
    turns.push({ from: 'customer', text }); draw();
    const r = await api('/sales/simulate', { method: 'POST', body: { platform: $('#lab-pl').value, messages: turns } }).catch((e) => { turns.pop(); draw(); throw e; });
    if (r.reply) turns.push({ from: 'assistant', text: r.reply });
    draw();
    const d = r.decision;
    $('#lab-d').innerHTML = `<dl class="kv mt-s"><dt>Stage</dt><dd>${stageBadge(d.stage)}</dd><dt>Buying intent</dt><dd>${lead(d.lead_score)}</dd><dt>Intent</dt><dd>${esc(d.intent)}</dd>
      <dt>Language</dt><dd>${esc(d.language)}</dd><dt>Confidence</dt><dd>${Math.round(d.confidence * 100)}%</dd><dt>Order</dt><dd>${esc(label(d.order_status))}${r.order.lines.length ? `<br>${r.order.lines.map((l) => `${l.qty}× ${esc(l.name)}`).join(', ')} = <b>${fmtMoney(r.order.total, r.order.currency)}</b>` : ''}${r.order.problems.length ? `<br><span class="badge bad">${esc(r.order.problems.join('; '))}</span>` : ''}</dd>
      <dt>Hand to you</dt><dd>${d.handoff ? `<span class="badge warn">Yes</span> ${esc(d.handoff_reason)}` : 'No'}</dd><dt>Unsupported facts</dt><dd>${d.unsupported_claims ? '<span class="badge bad">Yes — would be held</span>' : 'No'}</dd></dl>`;
  };
  const ta = $('.composer textarea');
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ta.form.requestSubmit(); } });
  bind({
    reset: () => { turns.length = 0; draw(); $('#lab-d').innerHTML = ''; },
    say: async (form) => { const text = formData(form).text.trim(); if (!text) return; form.reset(); await say(text); },
    try: async (b) => say(b.dataset.t),
  }, ctx.view);
}
