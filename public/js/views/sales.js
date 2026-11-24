// AI sales assistant: Messenger / Instagram / WhatsApp conversations, orders, product catalog, channels and test chat.
import { $, $$, esc, icon, api, toast, bind, formData, modal, confirmBox, ago, fmtDate, num, empty, label, lead, csvDownload, switchEl } from '../ui.js';

const PL = {
  messenger: { name: 'Messenger', cls: 'info' },
  instagram: { name: 'Instagram', cls: 'primary' },
  whatsapp: { name: 'WhatsApp', cls: 'ok' },
};
const plBadge = (p) => `<span class="badge ${PL[p]?.cls || ''}">${esc(PL[p]?.name || p)}</span>`;
const STAGE_TONE = { ordered: 'ok', ordering: 'primary', negotiating: 'warn', interested: 'info', lost: 'bad', support: '' };
const stageBadge = (s) => `<span class="badge ${STAGE_TONE[s] || ''}">${esc(label(s))}</span>`;
const fmtMoney = (n, cur) => `${esc(cur)} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const who = (c) => c.customer_name || (c.platform === 'whatsapp' ? `+${c.customer_id}` : `${PL[c.platform]?.name || ''} user …${String(c.customer_id).slice(-4)}`);
const canManage = (ctx) => ['owner', 'admin'].includes(ctx.me.role);

function setupHint(ov, ctx) {
  const steps = [];
  if (!ov.aiEnabled) steps.push('The platform admin must add an Anthropic API key (Admin → Settings) before the assistant can answer.');
  if (!ov.channels.length) steps.push(canManage(ctx) ? '<a href="#channels">Connect a Facebook Page, Instagram account or WhatsApp number</a>.' : 'Ask an owner/admin to connect a channel.');
  if (!ov.products) steps.push(canManage(ctx) ? '<a href="#catalog">Add your products and prices</a> — the assistant only quotes prices from this list.' : 'Products and prices have not been added yet.');
  return steps.length ? `<div class="callout primary mb">${icon('sparkles')}<div><b>Finish setup:</b><ol style="margin:6px 0 0 18px;padding:0">${steps.map((s) => `<li>${s}</li>`).join('')}</ol></div></div>` : '';
}

// ---------------------------------------------------------------- conversations
export async function chats(ctx, params) {
  const filters = Object.fromEntries(Object.entries({ platform: params.platform, status: params.status, view: params.view, q: params.q }).filter(([, v]) => v));
  const sel = params.id ? await api(`/sales/conversations/${Number(params.id)}`).catch(() => null) : null; // first, so it is marked read
  const [ov, list] = await Promise.all([api('/sales/overview'), api(`/sales/conversations?${new URLSearchParams(filters)}`)]);
  const q = (over) => `#chats?${new URLSearchParams({ ...filters, ...over })}`;
  const chip = (text, over, on) => `<a class="chip ${on ? 'on' : ''}" href="${q(over)}" ${on ? 'style="border-color:var(--primary);color:var(--primary-text)"' : ''}>${text}</a>`;
  const stat = (ic, l, n) => `<div class="card stat"><div class="ic">${icon(ic)}</div><div class="l">${esc(l)}</div><div class="n">${n}</div></div>`;
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Social sales</h1><p>Your AI sales assistant answers Messenger, Instagram and WhatsApp customers, recommends products and takes orders — prices only from your catalog.</p></div>
      <div class="actions"><a class="btn" href="#saleslab">${icon('flask')}Test chat</a></div></div>
    ${setupHint(ov, ctx)}
    <div class="grid g4 mb">${stat('chat', 'Conversations (30d)', num(ov.conversations))}${stat('send', 'AI replies sent (30d)', num(ov.aiSent))}
      ${stat('alert', 'Need a human', `<a href="${q({ status: 'needs_human' })}">${num(ov.needsHuman)}</a>`)}${stat('card', 'Orders (30d)', `<a href="#orders">${num(ov.orders.n)}</a>${ov.orders.revenue ? `<span class="hint" style="font-size:13px;margin-left:8px">worth ${num(Math.round(ov.orders.revenue))}</span>` : ''}`)}</div>
    <div class="chat-shell">
      <div class="card pad-0 chat-list">
        <form class="chat-tools" data-act="search"><div class="input-icon">${icon('search')}<input name="q" placeholder="Name, phone or intent" value="${esc(params.q || '')}"></div>
          <div class="chips">${chip('All', { platform: '', status: '', view: '' }, !params.platform && !params.status && !params.view)}
            ${Object.entries(PL).map(([k, v]) => chip(v.name, { platform: k }, params.platform === k)).join('')}
            ${chip('Needs human', { status: 'needs_human', view: '' }, params.status === 'needs_human')}${chip('Drafts', { view: 'drafts', status: '' }, params.view === 'drafts')}</div></form>
        <div class="chat-items">${list.map((c) => `<a class="chat-item ${sel?.id === c.id ? 'on' : ''}" href="${q({ id: c.id })}">
            <div class="row nowrap" style="justify-content:space-between"><b class="truncate">${esc(who(c))}</b><span class="hint nowrap">${ago(c.last_inbound_at || c.created_at)}</span></div>
            <div class="hint truncate">${esc(c.last_body || c.intent || '')}</div>
            <div class="row" style="gap:6px;margin-top:4px">${plBadge(c.platform)}${stageBadge(c.stage)}${c.status === 'needs_human' ? '<span class="badge bad">Needs human</span>' : ''}${c.drafts ? `<span class="badge warn">${c.drafts} draft</span>` : ''}${c.unread ? `<span class="badge info">${c.unread} new</span>` : ''}${lead(c.lead_score)}</div></a>`).join('')
          || empty('chat', 'No conversations yet', 'Customer messages appear here as soon as a channel is connected.')}</div>
      </div>
      <div class="card chat-pane">${sel ? chatPane(sel) : empty('chat', 'Select a conversation', 'Pick a customer on the left to see the chat, AI drafts and orders.')}</div>
    </div>`;
  bind({ search: (f) => { location.hash = q({ q: formData(f).q, id: '' }).slice(1); } }, ctx.view);
  if (sel) bindPane(ctx, sel);
}

function chatPane(c) {
  const bubble = (m) => {
    const out = m.direction === 'out';
    const src = { ai: 'AI', human: 'You', human_app: 'Staff (Meta inbox)', customer: '' }[m.source];
    const draft = m.status === 'draft' || m.status === 'failed';
    return `<div class="bubble-row ${out ? 'out' : 'in'}"><div class="bubble ${out ? 'out' : 'in'} ${draft ? 'draft' : ''}">
      ${draft ? `<div class="hint mb-s"><b>${m.status === 'failed' ? 'Send failed' : 'AI draft — waiting for your approval'}</b>${m.error ? ` · ${esc(m.error)}` : ''}</div>` : ''}
      ${draft ? `<textarea data-draft="${m.id}" rows="5">${esc(m.body)}</textarea>` : `<div class="bubble-t">${esc(m.body)}</div>`}
      ${draft && m.guard?.length ? `<ul class="hint" style="margin:6px 0 0 16px;padding:0">${m.guard.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
      ${draft ? `<div class="row mt-s"><button class="btn sm primary" data-act="approve" data-id="${m.id}">${icon('send', 'sm')}Send</button><button class="btn sm ghost" data-act="reject" data-id="${m.id}">Discard</button></div>` : ''}
      <div class="hint small mt-s">${src ? `${esc(src)} · ` : ''}${fmtDate(m.created_at)}</div></div></div>`;
  };
  return `
    <div class="row" style="justify-content:space-between;gap:12px"><div style="flex:1;min-width:180px"><h3 style="margin:0">${esc(who(c))} ${plBadge(c.platform)}</h3>
      <div class="hint truncate">${esc(c.summary || c.intent || '')}</div></div>
      <div class="row nowrap">${stageBadge(c.stage)}${lead(c.lead_score)}
        <button class="btn sm" data-act="pause">${icon(c.ai_paused ? 'play' : 'ban', 'sm')}${c.ai_paused ? 'Resume AI' : 'Pause AI'}</button>
        <button class="btn sm" data-act="close">${c.status === 'closed' ? 'Reopen' : 'Close'}</button></div></div>
    ${c.status === 'needs_human' ? `<div class="callout warn mt-s">${icon('alert')}<div><b>Needs a human:</b> ${esc(c.handoff_reason || '')} <a href="#" data-act="resolve">Mark handled</a></div></div>` : ''}
    ${c.ai_paused ? `<div class="callout mt-s">${icon('userCheck')}<div>A person is handling this chat — the AI stays quiet until you resume it.</div></div>` : ''}
    <div class="bubbles" id="bubbles">${c.messages.map(bubble).join('') || '<p class="hint">No messages.</p>'}</div>
    ${c.can_reply ? `<form class="row nowrap mt-s" data-act="reply"><textarea name="body" rows="2" placeholder="Type a reply… (the AI pauses for 12 h when you reply)" style="flex:1"></textarea><button class="btn primary" type="submit">${icon('send')}Send</button></form>`
    : `<div class="callout mt-s">${icon('clock')}<div>The 24-hour reply window has closed. Meta only allows a reply after the customer writes again.</div></div>`}
    <details class="mt"><summary><b>Customer & orders</b></summary>
      <form class="grid g3 mt-s" data-act="saveCustomer"><div><label>Name</label><input name="customer_name" value="${esc(c.customer_name || '')}"></div>
        <div><label>Phone</label><input name="customer_phone" value="${esc(c.customer_phone || '')}"></div><div><label>Address</label><input name="customer_address" value="${esc(c.customer_address || '')}"></div>
        <div><button class="btn sm" type="submit">Save</button></div></form>
      ${c.orders.map((o) => `<div class="row mt-s"><a href="#orders"><b>Order #${o.id}</b></a> ${esc(o.items.map((l) => `${l.qty}× ${l.name}`).join(', '))} · <b>${fmtMoney(o.total, o.currency)}</b> <span class="badge">${esc(label(o.status))}</span></div>`).join('')}
    </details>`;
}

function bindPane(ctx, c) {
  const el = $('#bubbles');
  if (el) el.scrollTop = el.scrollHeight;
  bind({
    approve: async (b) => { await api(`/sales/messages/${b.dataset.id}/approve`, { method: 'POST', body: { body: $(`[data-draft="${b.dataset.id}"]`).value } }); toast('Sent'); ctx.route(); },
    reject: async (b) => { await api(`/sales/messages/${b.dataset.id}/reject`, { method: 'POST' }); ctx.route(); },
    reply: async (f) => { await api(`/sales/conversations/${c.id}/reply`, { method: 'POST', body: formData(f) }); toast('Sent'); ctx.route(); },
    pause: async () => { await api(`/sales/conversations/${c.id}`, { method: 'PUT', body: { ai_paused: !c.ai_paused } }); ctx.route(); },
    close: async () => { await api(`/sales/conversations/${c.id}`, { method: 'PUT', body: { status: c.status === 'closed' ? 'open' : 'closed' } }); ctx.route(); },
    resolve: async () => { await api(`/sales/conversations/${c.id}`, { method: 'PUT', body: { status: 'open' } }); ctx.route(); },
    saveCustomer: async (f) => { await api(`/sales/conversations/${c.id}`, { method: 'PUT', body: formData(f) }); toast('Saved'); },
  }, ctx.view);
}

// ---------------------------------------------------------------- orders
const ORDER_STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];
export async function orders(ctx, params) {
  const list = await api(`/sales/orders${params.status ? `?status=${encodeURIComponent(params.status)}` : ''}`);
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Orders</h1><p>Orders the assistant took in chat. Totals are always calculated from your catalog prices, never by the AI.</p></div>
      <div class="actions"><div class="seg">${['', ...ORDER_STATUSES].map((s) => `<a href="#orders${s ? `?status=${s}` : ''}" class="${(params.status || '') === s ? 'on' : ''}">${s ? esc(label(s)) : 'All'}</a>`).join('')}</div>
        <button class="btn" data-act="csv">${icon('download')}Export CSV</button></div></div>
    <div class="card pad-0"><div class="table-wrap"><table><thead><tr><th>#</th><th>Customer</th><th>Items</th><th>Total</th><th>Channel</th><th>Status</th><th>Date</th></tr></thead><tbody>
      ${list.map((o) => `<tr><td><b>${o.id}</b></td><td><b>${esc(o.customer_name || '—')}</b><div class="hint">${esc(o.customer_phone || '')}</div><div class="hint" style="max-width:260px;white-space:normal">${esc(o.customer_address || '')}</div></td>
        <td>${o.items.map((l) => `<div>${l.qty}× ${esc(l.name)}${l.variant ? ` <span class="hint">(${esc(l.variant)})</span>` : ''}</div>`).join('')}${o.note ? `<div class="hint">${esc(o.note)}</div>` : ''}</td>
        <td class="nowrap"><b>${fmtMoney(o.total, o.currency)}</b></td><td>${o.platform ? plBadge(o.platform) : ''}${o.conversation_id ? `<div><a class="hint" href="#chats?id=${o.conversation_id}">Open chat</a></div>` : ''}</td>
        <td><select data-act="status" data-id="${o.id}" style="width:auto">${ORDER_STATUSES.map((s) => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select></td>
        <td class="hint nowrap">${ago(o.created_at)}</td></tr>`).join('') || `<tr><td colspan="7">${empty('card', 'No orders yet', 'When a customer confirms an order in chat it appears here, and you get a Telegram/Slack alert if alerts are on.')}</td></tr>`}
    </tbody></table></div></div>`;
  bind({
    csv: () => csvDownload('/sales/orders.csv'),
    status: async (s) => {
      if (s.value === 'cancelled' && !(await confirmBox('Cancel this order?', 'Stock for its items is added back to your catalog.', { danger: true, ok: 'Cancel order' }))) { ctx.route(); return; }
      await api(`/sales/orders/${s.dataset.id}`, { method: 'PUT', body: { status: s.value } }); toast('Order updated');
    },
  }, ctx.view);
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

// ---------------------------------------------------------------- channels
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
export async function channels(ctx) {
  const list = await api('/sales/channels');
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Channels</h1><p>Connect a Facebook Page, Instagram professional account or WhatsApp Business number. Tokens are encrypted and never shown again.</p></div>
      <div class="actions"><button class="btn primary" data-act="add">${icon('plus')}Connect channel</button></div></div>
    <div class="grid g2">${list.map((c) => `<div class="card"><div class="row nowrap" style="justify-content:space-between"><h3 style="margin:0">${esc(c.name || c.platform_label)}</h3>${plBadge(c.platform)}</div>
      <dl class="kv mt-s"><dt>Account ID</dt><dd><code>${esc(c.external_id)}</code>${c.send_id ? ` · send via <code>${esc(c.send_id)}</code>` : ''}</dd>
        <dt>Callback URL</dt><dd><code>${esc(c.webhook_url)}</code> <button class="btn sm ghost" data-act="copy" data-v="${esc(c.webhook_url)}">${icon('copy', 'sm')}</button></dd>
        <dt>Verify token</dt><dd><code>${esc(c.verify_token)}</code> <button class="btn sm ghost" data-act="copy" data-v="${esc(c.verify_token)}">${icon('copy', 'sm')}</button></dd>
        <dt>Last message</dt><dd>${c.last_event_at ? ago(c.last_event_at) : '<span class="hint">waiting for the first webhook…</span>'}</dd></dl>
      ${c.last_error ? `<div class="callout bad mt-s">${icon('alert')}<div>${esc(c.last_error)}</div></div>` : ''}
      <form class="mt" data-act="save" data-id="${c.id}"><label>Mode</label>
        <div class="seg">${[['off', 'Off'], ['draft', 'Draft (I approve)'], ['auto', 'Auto-pilot']].map(([v, l]) => `<label style="padding:6px 10px;margin:0;cursor:pointer"><input type="radio" name="mode" value="${v}" ${c.mode === v ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        <p class="field-hint">Auto-pilot still holds replies for you when a safety check fails (unknown price, low confidence, complaint, manipulation attempt).</p>
        <div class="grid g2"><div><label>Follow up quiet buyers after (hours, 0 = off)</label><input name="followup_hours" type="number" min="0" max="20" value="${c.followup_hours}"></div>
          <div><label>Greeting for new chats <span class="hint">(optional)</span></label><input name="greeting" value="${esc(c.greeting || '')}" placeholder="আসসালামু আলাইকুম! কীভাবে সাহায্য করতে পারি?"></div></div>
        <details><summary class="hint">Replace token / app secret</summary><div class="grid g2"><div><label>New access token</label><input name="access_token" type="password" autocomplete="off"></div><div><label>New app secret</label><input name="app_secret" type="password" autocomplete="off"></div></div></details>
        <div class="row mt"><label class="check" style="margin:0">${switchEl('enabled', c.enabled)} Enabled</label><span class="spacer"></span>
          <button class="btn ghost danger" type="button" data-act="del" data-id="${c.id}">${icon('trash')}Disconnect</button><button class="btn primary" type="submit">Save</button></div></form></div>`).join('')
      || `<div class="card">${empty('plug', 'No channels connected', 'Connect Messenger, Instagram or WhatsApp to let the assistant answer customers.')}</div>`}</div>`;
  const addForm = (platform) => `<h2>Connect ${esc(PL[platform].name)}</h2>
    <div class="seg mb">${Object.entries(PL).map(([k, v]) => `<a href="#" data-p="${k}" class="${k === platform ? 'on' : ''}">${esc(v.name)}</a>`).join('')}</div>
    <div class="callout mb">${icon('info')}<div>${HOWTO[platform]}</div></div>
    <form data-act="create"><input type="hidden" name="platform" value="${platform}">
      <div class="grid g2"><div><label>${platform === 'whatsapp' ? 'Phone number ID' : platform === 'instagram' ? 'Instagram account ID' : 'Page ID'}</label><input name="external_id" required inputmode="numeric" pattern="\\d{5,32}"></div>
        ${platform === 'instagram' ? '<div><label>Send ID (linked Facebook Page ID)</label><input name="send_id" inputmode="numeric" pattern="\\d{5,32}"></div>' : '<div><label>Name <span class="hint">(optional)</span></label><input name="name"></div>'}
        <div><label>Access token</label><input name="access_token" type="password" required autocomplete="off"></div><div><label>App secret</label><input name="app_secret" type="password" required autocomplete="off"></div></div>
      <label>Start in</label><select name="mode"><option value="draft">Draft — I approve every reply (recommended first)</option><option value="auto">Auto-pilot</option></select>
      <button class="btn primary mt" type="submit">Test & connect</button></form>`;
  const openAdd = (platform = 'messenger') => modal(addForm(platform), (el, close) => {
    $$('[data-p]', el).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); close(); openAdd(a.dataset.p); }));
    bind({ create: async (f) => { await api('/sales/channels', { method: 'POST', body: formData(f) }); close(); toast('Connected — now add the webhook in Meta'); ctx.route(); } }, el);
  }, { wide: true });
  bind({
    add: () => openAdd(),
    copy: async (b) => { await navigator.clipboard.writeText(b.dataset.v); toast('Copied'); },
    save: async (f) => {
      const d = formData(f);
      for (const k of ['access_token', 'app_secret']) if (!d[k]) delete d[k];
      await api(`/sales/channels/${f.dataset.id}`, { method: 'PUT', body: d }); toast('Saved'); ctx.route();
    },
    del: async (b) => { if (await confirmBox('Disconnect this channel?', 'Its conversations are deleted from this dashboard. Orders are kept.', { danger: true, ok: 'Disconnect' })) { await api(`/sales/channels/${b.dataset.id}`, { method: 'DELETE' }); ctx.route(); } },
  }, ctx.view);
}

// ---------------------------------------------------------------- test chat
export async function saleslab(ctx) {
  const turns = [];
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Test chat</h1><p>Chat as a customer to see exactly how the assistant answers. Nothing is sent to anyone and no orders are created.</p></div>
      <div class="actions"><select id="lab-pl" style="width:auto">${Object.entries(PL).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('')}</select><button class="btn" data-act="reset">${icon('refresh')}Restart</button></div></div>
    <div class="split"><div class="card chat-pane"><div class="bubbles" id="lab-b"><p class="hint">Try: “hoodie er dam koto?”, “L size ache?”, “2ta nibo, delivery charge koto?”</p></div>
      <form class="row nowrap mt-s" data-act="say"><input name="text" placeholder="Write as the customer…" autocomplete="off" style="flex:1" required><button class="btn primary" type="submit">${icon('send')}Send</button></form></div>
      <div class="card"><h3>${icon('brain')} What the assistant decided</h3><div id="lab-d" class="hint">Send a message to see stage, lead score, order details and safety decisions.</div></div></div>`;
  const draw = () => { $('#lab-b').innerHTML = turns.map((t) => `<div class="bubble-row ${t.from === 'customer' ? 'in' : 'out'}"><div class="bubble ${t.from === 'customer' ? 'in' : 'out'}"><div class="bubble-t">${esc(t.text)}</div></div></div>`).join(''); $('#lab-b').scrollTop = 1e9; };
  bind({
    reset: () => { turns.length = 0; draw(); $('#lab-d').innerHTML = ''; },
    say: async (f) => {
      const text = formData(f).text.trim();
      if (!text) return;
      turns.push({ from: 'customer', text }); f.reset(); draw();
      const r = await api('/sales/simulate', { method: 'POST', body: { platform: $('#lab-pl').value, messages: turns } }).catch((e) => { turns.pop(); draw(); throw e; });
      if (r.reply) turns.push({ from: 'assistant', text: r.reply });
      draw();
      const d = r.decision;
      $('#lab-d').innerHTML = `<dl class="kv"><dt>Stage</dt><dd>${stageBadge(d.stage)}</dd><dt>Lead score</dt><dd>${lead(d.lead_score)}</dd><dt>Intent</dt><dd>${esc(d.intent)}</dd>
        <dt>Language</dt><dd>${esc(d.language)}</dd><dt>Confidence</dt><dd>${Math.round(d.confidence * 100)}%</dd><dt>Order</dt><dd>${esc(label(d.order_status))}${r.order.lines.length ? `<br>${r.order.lines.map((l) => `${l.qty}× ${esc(l.name)}`).join(', ')} = <b>${fmtMoney(r.order.total, r.order.currency)}</b>` : ''}${r.order.problems.length ? `<br><span class="badge bad">${esc(r.order.problems.join('; '))}</span>` : ''}</dd>
        <dt>Hand to human</dt><dd>${d.handoff ? `<span class="badge warn">Yes</span> ${esc(d.handoff_reason)}` : 'No'}</dd><dt>Unsupported facts</dt><dd>${d.unsupported_claims ? '<span class="badge bad">Yes — would be held</span>' : 'No'}</dd></dl>`;
    },
  }, ctx.view);
}
