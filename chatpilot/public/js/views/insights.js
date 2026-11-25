// Customers (everyone who chatted or ordered, merged by phone) and Analytics.
import { esc, icon, api, toast, bind, formData, ago, num, empty, csvDownload, bars, hbars, modal } from '../ui.js';

const PL = { messenger: 'Messenger', instagram: 'Instagram', whatsapp: 'WhatsApp' };
const money = (n, cur = 'BDT') => `${esc(cur)} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const SEGMENTS = [['', 'All'], ['buyers', 'Buyers'], ['repeat', 'Repeat buyers'], ['leads', 'Hot leads'], ['risky', 'Often return']];

export async function customers(ctx, params) {
  const qs = new URLSearchParams(Object.entries({ q: params.q, segment: params.segment, sort: params.sort }).filter(([, v]) => v));
  const list = await api(`/sales/customers?${qs}`);
  const link = (over) => `#customers?${new URLSearchParams(Object.entries({ q: params.q, segment: params.segment, sort: params.sort, ...over }).filter(([, v]) => v))}`;
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Customers</h1><p>Everyone who messaged or ordered, merged by phone number across your pages — with what they bought and how often parcels came back.</p></div>
      <div class="actions"><button class="btn" data-act="csv">${icon('download')}CSV</button></div></div>
    <div class="row mb" style="gap:8px">
      <div class="seg">${SEGMENTS.map(([k, l]) => `<a href="${link({ segment: k })}" class="${(params.segment || '') === k ? 'on' : ''}">${l}</a>`).join('')}</div>
      <select data-act="sort" aria-label="Sort">${[['', 'Recent'], ['spent', 'Top spenders'], ['orders', 'Most orders']].map(([k, l]) => `<option value="${k}" ${(params.sort || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <form data-act="search" class="input-icon" style="flex:1;min-width:200px">${icon('search')}<input name="q" placeholder="Name, phone, address or label" value="${esc(params.q || '')}"></form></div>
    <div class="card pad-0"><div class="table-wrap"><table><thead><tr><th>Customer</th><th>Channels</th><th>Orders</th><th>Spent</th><th>Delivered</th><th>Last seen</th></tr></thead><tbody>
      ${list.map((c, i) => `<tr class="click" data-i="${i}"><td><b>${esc(c.name || 'Unknown')}</b><div class="hint">${esc(c.phone || '')}</div>${c.labels.map((l) => `<span class="tag">#${esc(l)}</span>`).join(' ')}</td>
        <td>${c.platforms.map((p) => `<span class="pf ${esc(p)}">${PL[p] || esc(p)}</span>`).join(' ') || '<span class="hint">manual</span>'}</td>
        <td>${num(c.orders)}${c.open ? ` <span class="hint">(${c.open} open)</span>` : ''}</td>
        <td class="nowrap"><b>${money(c.spent, c.currency)}</b></td>
        <td>${c.ratio === null ? '<span class="hint">—</span>' : `<span class="badge ${c.ratio >= 80 ? 'ok' : c.ratio >= 50 ? 'warn' : 'bad'}">${c.ratio}%</span> <span class="hint">${c.delivered}/${c.delivered + c.returned}</span>`}</td>
        <td class="hint nowrap">${c.last ? ago(c.last) : '—'}</td></tr>`).join('')
      || `<tr><td colspan="6">${empty('users', 'No customers yet', 'People who message your pages or place an order show up here.')}</td></tr>`}
    </tbody></table></div></div>`;
  bind({
    csv: () => csvDownload('/sales/customers.csv'),
    search: (f) => { location.hash = link({ q: formData(f).q }); },
  }, ctx.view);
  ctx.view.querySelector('[data-act="sort"]').addEventListener('change', (e) => { location.hash = link({ sort: e.target.value }); });
  ctx.view.querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', () => detail(list[tr.dataset.i])));
}

async function detail(c) {
  const orders = c.phone ? await api(`/sales/orders?${new URLSearchParams({ q: c.phone })}`).catch(() => []) : [];
  modal(`<h2>${esc(c.name || 'Customer')}</h2><p class="hint">${esc(c.phone || 'No phone yet')}${c.address ? ` · ${esc(c.address)}` : ''}</p>
    <div class="grid g3 mt"><div class="card stat"><div class="l">Orders</div><div class="n">${num(c.orders)}</div></div>
      <div class="card stat ok"><div class="l">Spent (delivered)</div><div class="n">${money(c.spent, c.currency)}</div></div>
      <div class="card stat ${c.returned ? 'bad' : ''}"><div class="l">Returned / cancelled</div><div class="n">${num(c.returned)}</div></div></div>
    <h3 class="mt">Chats</h3><div class="chips">${c.conversations.map((id) => `<a class="chip" href="#chat?id=${id}">${icon('chat', 'sm')} Chat #${id}</a>`).join('') || '<span class="hint">No chats</span>'}</div>
    <h3 class="mt">Orders</h3>${orders.length ? orders.map((o) => `<div class="row nowrap"><a href="#invoice?id=${o.id}"><b>#${o.id}</b></a><span style="flex:1">${o.items.map((l) => `${l.qty}× ${esc(l.name)}`).join(', ')}</span><span class="badge">${esc(o.status)}</span><b>${money(o.total, o.currency)}</b></div>`).join('') : '<p class="hint">No orders</p>'}`,
  (root, close) => root.querySelectorAll('a').forEach((a) => a.addEventListener('click', close)), { wide: true });
}

export async function analytics(ctx, params) {
  const days = [7, 30, 90].includes(Number(params.days)) ? Number(params.days) : 30;
  const [a, capi] = await Promise.all([api(`/sales/analytics?days=${days}`), ['owner', 'admin'].includes(ctx.me.role) ? api('/sales/capi').catch(() => null) : null]);
  const cur = a.orders.currency || 'BDT';
  const frt = a.firstResponseSec == null ? '—' : a.firstResponseSec < 60 ? `${a.firstResponseSec}s` : a.firstResponseSec < 3600 ? `${Math.round(a.firstResponseSec / 60)} min` : `${Math.round(a.firstResponseSec / 3600)} h`;
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Analytics</h1><p>How fast you answer, how much the AI handles, and which pages, ads and products bring in sales.</p></div>
      <div class="seg">${[7, 30, 90].map((d) => `<a href="#analytics?days=${d}" class="${d === days ? 'on' : ''}">${d} days</a>`).join('')}</div></div>
    <div class="grid g4 mb">
      <div class="card stat"><div class="l">First reply (median)</div><div class="n">${frt}</div></div>
      <div class="card stat ok"><div class="l">Answered by AI alone</div><div class="n">${a.automation}%</div></div>
      <div class="card stat"><div class="l">Chats → orders</div><div class="n">${a.conversion}%</div><div class="hint">${num(a.converted)} of ${num(a.conversations)} new chats</div></div>
      <div class="card stat ${a.deliveryRate !== null && a.deliveryRate < 70 ? 'bad' : 'ok'}"><div class="l">Delivered (vs returned)</div><div class="n">${a.deliveryRate === null ? '—' : `${a.deliveryRate}%`}</div></div></div>
    <div class="grid g4 mb">
      <div class="card stat"><div class="l">Customer messages</div><div class="n">${num(a.messages.inbound || 0)}</div></div>
      <div class="card stat"><div class="l">Orders</div><div class="n">${num(a.orders.n || 0)}</div></div>
      <div class="card stat ok"><div class="l">Order value</div><div class="n">${money(a.orders.value, cur)}</div></div>
      <div class="card stat warn"><div class="l">Handed to a person</div><div class="n">${num(a.handoffs)}</div></div></div>
    <div class="grid g2">
      <div class="card"><h3>Messages per day</h3>${bars(a.daily.map((d) => ({ label: d.day, short: d.day.slice(8), value: d.messages })))}</div>
      <div class="card"><h3>Orders per day</h3>${bars(a.daily.map((d) => ({ label: d.day, short: d.day.slice(8), value: d.orders })))}</div>
      <div class="card"><h3>Replies sent</h3>${hbars([{ label: 'AI on its own', value: a.messages.ai_auto || 0 }, { label: 'AI draft approved', value: a.messages.ai_approved || 0 }, { label: 'Typed by your team', value: a.messages.human || 0 }])}</div>
      <div class="card"><h3>Top products</h3>${hbars(a.topProducts.map((p) => ({ label: p.name, value: p.value })), { fmt: (v) => money(v, cur) })}</div>
      <div class="card"><h3>By page</h3><div class="table-wrap"><table><thead><tr><th>Page</th><th>Chats</th><th>Orders</th><th>Value</th></tr></thead><tbody>
        ${a.byPage.map((p) => `<tr><td><span class="pf ${esc(p.platform)}">${PL[p.platform] || ''}</span> ${esc(p.name)}</td><td>${num(p.chats)}</td><td>${num(p.orders)}</td><td class="nowrap">${money(p.value, cur)}</td></tr>`).join('') || '<tr><td colspan="4" class="hint">No pages connected</td></tr>'}</tbody></table></div></div>
      <div class="card"><h3>By ad</h3><p class="hint">Chats that started from a click-to-message ad.</p><div class="table-wrap"><table><thead><tr><th>Ad</th><th>Chats</th><th>Orders</th><th>Value</th></tr></thead><tbody>
        ${a.byAd.map((p) => `<tr><td>${esc(p.ad_title || p.ad_id || 'Ad')}</td><td>${num(p.chats)}</td><td>${num(p.orders)}</td><td class="nowrap">${money(p.value, cur)}</td></tr>`).join('') || '<tr><td colspan="4" class="hint">No ad chats yet</td></tr>'}</tbody></table></div></div>
      ${['owner', 'admin'].includes(ctx.me.role) ? `<form class="card" data-act="capi"><h3>${icon('send')} Send sales to Meta Ads</h3><p class="hint">With the Conversions API, every order from a chat is reported to Meta as a "Purchase", so your click-to-message ads find more real buyers. Events Manager → your dataset → Settings → Conversions API → Generate access token.</p>
        <div class="grid g2"><div><label>Dataset / Pixel ID</label><input name="dataset_id" inputmode="numeric" value="${esc(capi?.dataset_id || '')}"></div><div><label>Access token</label><input name="token" type="password" autocomplete="off" placeholder="${capi?.enabled ? '•••• saved — leave blank to keep' : ''}"></div></div>
        <label>Test event code <span class="hint">(optional, from Events Manager → Test events)</span></label><input name="test_code" value="${esc(capi?.test_code || '')}">
        <div class="row mt"><button class="btn primary" type="submit">Save</button>${capi?.enabled ? '<span class="badge ok">On</span>' : ''}</div></form>` : ''}
      <div class="card"><h3>Team</h3><div class="table-wrap"><table><thead><tr><th>Person</th><th>Typed</th><th>AI drafts approved</th><th>Chats assigned</th><th>Orders</th></tr></thead><tbody>
        ${a.team.map((u) => `<tr><td>${esc(u.name)}</td><td>${num(u.typed)}</td><td>${num(u.approved)}</td><td>${num(u.assigned)}</td><td>${num(u.orders)}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
    <p class="hint mt">${icon('sparkles', 'sm')} The assistant has learned from ${num(a.learned)} of your own replies so far.</p>`;
  bind({ capi: async (f) => { const d = formData(f); if (!d.token) delete d.token; await api('/sales/capi', { method: 'PUT', body: d }); toast('Saved'); ctx.route(); } }, ctx.view);
}
