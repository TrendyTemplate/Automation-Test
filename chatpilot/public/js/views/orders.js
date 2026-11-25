// Orders: list, new order by hand, order detail & editing, invoice/packing slip, delivery charges, courier booking.
import { $, $$, esc, icon, api, toast, bind, formData, modal, confirmBox, ago, fmtDate, num, empty, label, csvDownload } from '../ui.js';

export const STATUSES = ['new', 'confirmed', 'packed', 'shipped', 'delivered', 'returned', 'cancelled'];
const TONE = { new: 'info', confirmed: 'primary', packed: 'warn', shipped: 'warn', delivered: 'ok', returned: 'bad', cancelled: 'bad' };
const PAY = { unpaid: ['COD / unpaid', ''], advance: ['Advance paid', 'warn'], paid: ['Paid', 'ok'], refunded: ['Refunded', 'bad'] };
const PL = { messenger: 'Messenger', instagram: 'Instagram', whatsapp: 'WhatsApp' };
const money = (n, cur = 'BDT') => `${esc(cur)} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const due = (o) => Math.max(0, (o.total || 0) - (o.paid_amount || 0));
const manager = (ctx) => ['owner', 'admin'].includes(ctx.me.role);

export async function orders(ctx, params) {
  const qs = new URLSearchParams(Object.entries({ status: params.status, q: params.q }).filter(([, v]) => v));
  const [list, couriers] = await Promise.all([api(`/sales/orders?${qs}`), api('/sales/couriers').catch(() => ({ connected: [] }))]);
  const totals = list.filter((o) => !['cancelled', 'returned'].includes(o.status)).reduce((a, o) => ({ n: a.n + 1, sum: a.sum + o.total, due: a.due + due(o) }), { n: 0, sum: 0, due: 0 });
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Orders</h1><p>Orders from chat and the ones you add by hand. Totals and delivery charges are always calculated by ChatPilot — never by the AI.</p></div>
      <div class="actions"><button class="btn" data-act="csv">${icon('download')}CSV</button><button class="btn primary" data-act="new">${icon('plus')}New order</button></div></div>
    <div class="row mb" style="gap:8px">
      <div class="seg">${['', ...STATUSES].map((s) => `<a href="#orders?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(params.q ? { q: params.q } : {}) })}" class="${(params.status || '') === s ? 'on' : ''}">${s ? esc(label(s)) : 'All'}</a>`).join('')}</div>
      <form data-act="search" class="input-icon" style="flex:1;min-width:200px">${icon('search')}<input name="q" placeholder="Order #, name, phone or tracking code" value="${esc(params.q || '')}"></form></div>
    <div class="grid g3 mb"><div class="card stat"><div class="l">Orders shown</div><div class="n">${num(totals.n)}</div></div>
      <div class="card stat ok"><div class="l">Order value</div><div class="n">${money(totals.sum)}</div></div>
      <div class="card stat warn"><div class="l">Still to collect (COD)</div><div class="n">${money(totals.due)}</div></div></div>
    <div class="card pad-0"><div class="table-wrap"><table><thead><tr><th>#</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Delivery</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((o) => `<tr class="click" data-id="${o.id}"><td><b>${o.id}</b><div class="hint nowrap">${ago(o.created_at)}</div></td>
        <td><b>${esc(o.customer_name || '—')}</b><div class="hint">${esc(o.customer_phone || '')}</div>${o.platform ? `<span class="pf ${esc(o.platform)}">${esc(o.channel_name || PL[o.platform])}</span>` : o.source === 'manual' ? '<span class="badge">manual</span>' : ''}</td>
        <td>${o.items.map((l) => `<div>${l.qty}× ${esc(l.name)}${l.variant ? ` <span class="hint">(${esc(l.variant)})</span>` : ''}</div>`).join('')}</td>
        <td class="nowrap"><b>${money(o.total, o.currency)}</b>${o.delivery_charge ? `<div class="hint">incl. ${money(o.delivery_charge, o.currency)} delivery</div>` : ''}</td>
        <td><span class="badge ${PAY[o.payment_status]?.[1] || ''}">${esc(PAY[o.payment_status]?.[0] || o.payment_status)}</span>${due(o) && o.payment_status !== 'unpaid' ? `<div class="hint">due ${money(due(o), o.currency)}</div>` : ''}</td>
        <td>${o.courier ? `<b>${esc(label(o.courier))}</b><div class="hint">${esc(o.tracking_code || o.consignment_id || '')}${o.courier_status ? ` · ${esc(o.courier_status)}` : ''}</div>` : `<span class="hint">${esc(o.delivery_zone || '—')}</span>`}</td>
        <td><span class="badge ${TONE[o.status] || ''}">${esc(label(o.status))}</span></td>
        <td class="nowrap"><button class="btn sm ghost" data-act="print" data-id="${o.id}" title="Invoice">${icon('file', 'sm')}</button></td></tr>`).join('')
      || `<tr><td colspan="8">${empty('card', 'No orders yet', 'When a customer confirms an order in chat it appears here — or add one by hand.')}</td></tr>`}
    </tbody></table></div></div>`;
  bind({
    csv: () => csvDownload('/sales/orders.csv'),
    search: (f) => { location.hash = `orders?${new URLSearchParams(Object.entries({ status: params.status, q: formData(f).q }).filter(([, v]) => v))}`; },
    new: () => orderForm(ctx),
    print: (b) => { location.hash = `invoice?id=${b.dataset.id}`; },
  }, ctx.view);
  $$('tr.click', ctx.view).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('button')) orderDetail(ctx, Number(tr.dataset.id), couriers); }));
  if (params.id) orderDetail(ctx, Number(params.id), couriers);
}

async function itemRows(products, items = [{}]) {
  return items.map((it) => `<div class="row nowrap item-row"><select name="product_id">${products.filter((p) => p.active).map((p) => `<option value="${p.id}" ${Number(it.product_id) === p.id ? 'selected' : ''}>${esc(p.name)} — ${money(p.price, p.currency)}${p.stock != null ? ` (${p.stock} left)` : ''}</option>`).join('')}</select>
    <input name="qty" type="number" min="1" value="${it.qty || 1}" style="max-width:80px" aria-label="Quantity"><input name="variant" placeholder="Size / colour" value="${esc(it.variant || '')}" aria-label="Variant">
    <button type="button" class="btn sm ghost icon-only" data-x aria-label="Remove">${icon('x', 'sm')}</button></div>`).join('');
}
const readItems = (el) => $$('.item-row', el).map((r) => ({ product_id: Number($('[name=product_id]', r).value), qty: Number($('[name=qty]', r).value), variant: $('[name=variant]', r).value })).filter((x) => x.product_id);

export async function orderForm(ctx, preset = {}) {
  const [products, delivery] = await Promise.all([api('/sales/products'), api('/sales/delivery')]);
  if (!products.some((p) => p.active)) { toast('Add a product first (Products)', true); return; }
  modal(`<h2>New order</h2><form data-act="save">
    <div class="grid g3"><div><label>Customer name</label><input name="customer_name" required value="${esc(preset.customer_name || '')}"></div>
      <div><label>Phone</label><input name="customer_phone" required inputmode="tel" value="${esc(preset.customer_phone || '')}"></div>
      <div><label>Delivery zone</label><select name="delivery_zone"><option value="">Pick from address</option>${delivery.zones.map((z) => `<option>${esc(z.name)}</option>`).join('')}</select></div></div>
    <label>Address</label><textarea name="customer_address" rows="2" required>${esc(preset.customer_address || '')}</textarea>
    <label>Products</label><div id="items">${await itemRows(products)}</div><button type="button" class="btn sm" data-add>${icon('plus', 'sm')}Add product</button>
    <div class="grid g3 mt"><div><label>Payment</label><select name="payment_status"><option value="unpaid">Cash on delivery</option><option value="advance">Advance paid</option><option value="paid">Fully paid</option></select></div>
      <div><label>Amount paid</label><input name="paid_amount" type="number" min="0" value="0"></div><div><label>Paid by</label><input name="payment_method" placeholder="bKash, Nagad, card…"></div></div>
    <div class="grid g2"><div><label>Discount</label><input name="discount" type="number" min="0" value="0"></div><div><label>Note</label><input name="note"></div></div>
    <input type="hidden" name="conversation_id" value="${esc(preset.conversation_id || '')}">
    <button class="btn primary mt" type="submit">Create order</button></form>`, (el, close) => {
    const wire = () => $$('[data-x]', el).forEach((b) => { b.onclick = () => { if ($$('.item-row', el).length > 1) b.closest('.item-row').remove(); }; });
    wire();
    $('[data-add]', el).addEventListener('click', async () => { $('#items', el).insertAdjacentHTML('beforeend', await itemRows(products)); wire(); });
    bind({ save: async (f) => {
      const o = await api('/sales/orders', { method: 'POST', body: { ...formData(f), items: readItems(el) } });
      close(); toast(`Order #${o.id} created — ${o.currency} ${o.total}`); location.hash = `orders?id=${o.id}`;
    } }, el);
  }, { wide: true });
}

async function orderDetail(ctx, id, couriers = { connected: [] }) {
  const [o, products, delivery] = await Promise.all([api(`/sales/orders/${id}`), api('/sales/products'), api('/sales/delivery')]);
  modal(`<div class="row nowrap"><h2 style="margin:0;flex:1">Order #${o.id}</h2><span class="badge ${TONE[o.status] || ''}">${esc(label(o.status))}</span></div>
    <p class="hint">${fmtDate(o.created_at)} · ${o.source === 'manual' ? 'added by hand' : `from ${esc(o.channel_name || PL[o.platform] || 'chat')}`}${o.conversation_id ? ` · <a href="#chats?id=${o.conversation_id}">open chat</a>` : ''}</p>
    <form data-act="save">
      <div class="grid g3"><div><label>Status</label><select name="status">${STATUSES.map((s) => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select></div>
        <div><label>Payment</label><select name="payment_status">${Object.entries(PAY).map(([k, [l]]) => `<option value="${k}" ${o.payment_status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>Amount paid</label><input name="paid_amount" type="number" min="0" value="${o.paid_amount || 0}"></div></div>
      <div class="grid g3"><div><label>Name</label><input name="customer_name" value="${esc(o.customer_name || '')}"></div><div><label>Phone</label><input name="customer_phone" value="${esc(o.customer_phone || '')}"></div>
        <div><label>Delivery zone</label><select name="delivery_zone">${delivery.zones.map((z) => `<option ${o.delivery_zone === z.name ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select></div></div>
      <label>Address</label><textarea name="customer_address" rows="2">${esc(o.customer_address || '')}</textarea>
      <label>Products</label><div id="items">${await itemRows(products, o.items)}</div><button type="button" class="btn sm" data-add>${icon('plus', 'sm')}Add product</button>
      <div class="grid g2 mt"><div><label>Discount</label><input name="discount" type="number" min="0" value="${o.discount || 0}"></div><div><label>Note</label><input name="note" value="${esc(o.note || '')}"></div></div>
      <div class="order-totals"><span>Subtotal ${money(o.subtotal ?? o.total, o.currency)}</span><span>Delivery ${money(o.delivery_charge, o.currency)}</span>${o.discount ? `<span>Discount −${money(o.discount, o.currency)}</span>` : ''}<b>Total ${money(o.total, o.currency)}</b><span>Due ${money(due(o), o.currency)}</span></div>
      ${o.courier ? `<div class="callout ok mt">${icon('send')}<div><b>${esc(label(o.courier))}</b> · consignment ${esc(o.consignment_id || '—')} · tracking <b>${esc(o.tracking_code || '—')}</b>${o.courier_status ? ` · ${esc(o.courier_status)}` : ''} <a href="#" data-act="track">Refresh status</a></div></div>`
        : couriers.connected?.length ? `<div class="row mt"><span class="hint">Send to courier:</span>${couriers.connected.map((c) => `<button type="button" class="btn sm" data-act="book" data-c="${esc(c)}">${icon('send', 'sm')}${esc(label(c))}</button>`).join('')}</div>`
        : manager(ctx) ? '<p class="hint mt">Connect Steadfast, Pathao or RedX in <a href="#couriers">Couriers</a> to book parcels with one click.</p>' : ''}
      ${o.payment_trx ? `<div class="callout ${o.payment_check === 'verified' ? 'ok' : o.payment_check === 'pending' ? 'warn' : 'bad'} mt">${icon('card')}<div>
        <b>${esc(o.payment_method || 'Mobile banking')} TrxID <code>${esc(o.payment_trx)}</code></b>${o.payment_claim ? ` · customer says ${money(o.payment_claim, o.currency)}` : ''}
        · ${{ pending: 'check it in your app, then verify', verified: 'verified ✓', rejected: 'rejected', reused: '⚠ this TrxID was already used on another order' }[o.payment_check] || ''}
        ${['pending', 'reused'].includes(o.payment_check) ? `<div class="row mt-s"><input type="number" min="1" id="pay-amt" value="${o.payment_claim || ''}" placeholder="Amount received" style="max-width:160px" aria-label="Amount received">
          <button type="button" class="btn sm primary" data-act="payok">Verify</button><button type="button" class="btn sm ghost danger" data-act="payno">Not received</button></div>` : ''}</div></div>` : ''}
      ${o.customer_phone ? `<div id="fraud" class="mt"></div>` : ''}
      <div class="row mt"><button class="btn primary" type="submit">Save changes</button><a class="btn" href="#invoice?id=${o.id}">${icon('file')}Invoice</a></div></form>`, (el, close) => {
    const wire = () => $$('[data-x]', el).forEach((b) => { b.onclick = () => { if ($$('.item-row', el).length > 1) b.closest('.item-row').remove(); }; });
    wire();
    $('[data-add]', el).addEventListener('click', async () => { $('#items', el).insertAdjacentHTML('beforeend', await itemRows(products)); wire(); });
    if (o.customer_phone) fraudBadge($('#fraud', el), o.customer_phone);
    bind({
      save: async (f) => {
        const d = formData(f);
        const body = { ...d, items: readItems(el) };
        if (['cancelled', 'returned'].includes(d.status) && d.status !== o.status && !(await confirmBox(`Mark as ${label(d.status)}?`, 'Items go back into stock.', { danger: true, ok: 'Yes' }))) return;
        await api(`/sales/orders/${o.id}`, { method: 'PUT', body }); close(); toast('Order saved'); ctx.route();
      },
      book: async (b) => { const r = await api(`/sales/orders/${o.id}/courier`, { method: 'POST', body: { courier: b.dataset.c } }); close(); toast(`Booked with ${label(r.courier)} — tracking ${r.tracking_code || r.consignment_id}`); ctx.route(); },
      payok: async () => { await api(`/sales/orders/${o.id}/payment`, { method: 'POST', body: { ok: true, amount: Number($('#pay-amt', el).value) } }); toast('Payment verified'); close(); ctx.route(); },
      payno: async () => { await api(`/sales/orders/${o.id}/payment`, { method: 'POST', body: { ok: false } }); toast('Marked as not received'); close(); ctx.route(); },
      track: async () => { const r = await api(`/sales/orders/${o.id}/courier/status`, { method: 'POST' }); toast(`Courier status: ${r.courier_status}`); close(); ctx.route(); },
    }, el);
  }, { wide: true, onClose: () => { if (location.hash.includes('id=')) history.replaceState(null, '', '#orders'); } });
}

/** Customer delivery history (successful vs returned) for a phone number — warns about likely fake orders. */
export async function fraudBadge(el, phone) {
  if (!el) return;
  try {
    const r = await api(`/sales/fraud-check?phone=${encodeURIComponent(phone)}`);
    if (!r.total) { el.innerHTML = `<span class="hint">${icon('info', 'sm')} No delivery history for this number yet.</span>`; return; }
    const tone = r.ratio >= 80 ? 'ok' : r.ratio >= 50 ? 'warn' : 'bad';
    el.innerHTML = `<div class="callout ${tone}">${icon(tone === 'ok' ? 'shieldCheck' : 'alert')}<div><b>${r.ratio}% delivered</b> — ${num(r.delivered)} delivered, ${num(r.returned)} returned/cancelled out of ${num(r.total)} orders${r.sources?.length ? ` <span class="hint">(${esc(r.sources.join(', '))})</span>` : ''}.${tone === 'bad' ? ' Consider asking for the delivery charge in advance.' : ''}</div></div>`;
  } catch { el.innerHTML = ''; }
}

// ---------------------------------------------------------------- invoice / packing slip (print)
export async function invoice(ctx, { id }) {
  const o = await api(`/sales/orders/${Number(id)}`);
  ctx.view.innerHTML = `<div class="no-print row mb"><a class="btn" href="#orders?id=${o.id}">${icon('chevronLeft')}Back</a><button class="btn primary" data-act="print">${icon('file')}Print / save PDF</button></div>
    <article class="invoice"><header><div><h1>${esc(o.shop.name)}</h1><p class="hint">${esc(o.shop.description).slice(0, 160)}</p></div><div style="text-align:right"><h2>Invoice #${o.id}</h2><p>${fmtDate(o.created_at)}</p>${o.tracking_code ? `<p><b>${esc(label(o.courier || ''))}</b> ${esc(o.tracking_code)}</p>` : ''}</div></header>
      <section><h4>Deliver to</h4><p><b>${esc(o.customer_name)}</b><br>${esc(o.customer_phone)}<br>${esc(o.customer_address)}</p></section>
      <table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>
        ${o.items.map((l) => `<tr><td>${esc(l.name)}${l.variant ? ` (${esc(l.variant)})` : ''}</td><td>${l.qty}</td><td>${money(l.price, o.currency)}</td><td>${money(l.price * l.qty, o.currency)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">Subtotal</td><td>${money(o.subtotal ?? o.total, o.currency)}</td></tr><tr><td colspan="3">Delivery${o.delivery_zone ? ` (${esc(o.delivery_zone)})` : ''}</td><td>${money(o.delivery_charge, o.currency)}</td></tr>
        ${o.discount ? `<tr><td colspan="3">Discount</td><td>−${money(o.discount, o.currency)}</td></tr>` : ''}<tr><td colspan="3"><b>Total</b></td><td><b>${money(o.total, o.currency)}</b></td></tr>
        <tr><td colspan="3">Paid</td><td>${money(o.paid_amount, o.currency)}</td></tr><tr class="due"><td colspan="3"><b>Collect on delivery</b></td><td><b>${money(due(o), o.currency)}</b></td></tr></tfoot></table>
      ${o.note ? `<p><b>Note:</b> ${esc(o.note)}</p>` : ''}<footer class="hint">Thank you for your order!</footer></article>`;
  bind({ print: () => window.print() }, ctx.view);
}

// ---------------------------------------------------------------- delivery charges (settings)
export async function delivery(ctx) {
  const d = await api('/sales/delivery');
  const row = (z = {}) => `<div class="row nowrap zone-row"><input name="name" placeholder="Zone name" value="${esc(z.name || '')}" aria-label="Zone"><input name="charge" type="number" min="0" placeholder="Charge" value="${z.charge ?? ''}" style="max-width:110px" aria-label="Charge">
    <input name="match" placeholder="Words in the address, e.g. dhaka, mirpur" value="${esc(z.match || '')}" style="flex:2" aria-label="Address words"><button type="button" class="btn sm ghost icon-only" data-x aria-label="Remove">${icon('x', 'sm')}</button></div>`;
  ctx.view.innerHTML = `<div class="page-h"><div><h1>Delivery charges</h1><p>Added automatically to every order and quoted by the assistant. The first zone whose words appear in the address is used; the last zone covers everywhere else.</p></div></div>
    <form class="card" data-act="save"><label class="check"><input type="checkbox" name="enabled" ${d.enabled ? 'checked' : ''}> Charge delivery</label>
      <div id="zones">${d.zones.map(row).join('')}</div><button type="button" class="btn sm" data-add>${icon('plus', 'sm')}Add zone</button>
      <label>Free delivery for orders of at least <span class="hint">(0 = never)</span></label><input name="free_over" type="number" min="0" value="${d.free_over || 0}" style="max-width:180px">
      <div class="row mt"><button class="btn primary" type="submit">Save</button></div></form>`;
  const wire = () => $$('[data-x]', ctx.view).forEach((b) => { b.onclick = () => b.closest('.zone-row').remove(); });
  wire();
  $('[data-add]', ctx.view).addEventListener('click', () => { $('#zones').insertAdjacentHTML('beforeend', row()); wire(); });
  bind({ save: async (f) => {
    const zones = $$('.zone-row', f).map((r) => ({ name: $('[name=name]', r).value, charge: Number($('[name=charge]', r).value), match: $('[name=match]', r).value })).filter((z) => z.name);
    await api('/sales/delivery', { method: 'PUT', body: { enabled: f.enabled.checked, zones, free_over: Number(f.free_over.value) } }); toast('Saved');
  } }, ctx.view);
}

/** bKash / Nagad numbers and when to ask for advance payment. */
export async function payments(ctx) {
  const [p, coupons] = await Promise.all([api('/sales/payments'), api('/sales/coupons')]);
  ctx.view.innerHTML = `<div class="page-h"><div><h1>Payments</h1><p>Cash on delivery is always on. Add your bKash / Nagad numbers and the assistant tells customers where to pay, collects the Transaction ID (TrxID), and the order waits for you to verify it — nothing is marked paid automatically.</p></div></div>
    <form class="card" data-act="save" style="max-width:720px">
      <div class="grid g2">${Object.entries(p.available).map(([k, l]) => `<div><label>${esc(l)} number</label><input name="m_${k}" inputmode="tel" placeholder="01XXXXXXXXX" value="${esc(p.methods[k] || '')}"></div>`).join('')}</div>
      <label>Account type</label><select name="account_type">${[['personal', 'Personal (customers use Send Money)'], ['merchant', 'Merchant (customers use Payment)'], ['agent', 'Agent (Cash In)']].map(([v, l]) => `<option value="${v}" ${p.account_type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label>Advance payment</label><select name="advance">${[['none', 'Not required — cash on delivery'], ['delivery', 'Delivery charge in advance'], ['full', 'Full payment in advance'], ['risky', 'Only for risky customers (many returns)']].map(([v, l]) => `<option value="${v}" ${p.advance === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label>Extra note for customers <span class="hint">(optional)</span></label><input name="note" maxlength="400" value="${esc(p.note)}" placeholder="e.g. Reference e order number likhben">
      <button class="btn primary mt" type="submit">Save</button></form>
    <div class="card mt" style="max-width:720px"><h3>${icon('gift')} Coupon codes</h3><p class="hint">When a customer gives a code in chat, the discount is checked and applied by ChatPilot — the AI never invents discounts.</p>
      <div class="table-wrap"><table><thead><tr><th>Code</th><th>Discount</th><th>Min. order</th><th>Used</th><th>Expires</th><th></th></tr></thead><tbody>
        ${coupons.map((c) => `<tr><td><b>${esc(c.code)}</b></td><td>${c.kind === 'percent' ? `${c.value}%` : c.kind === 'fixed' ? esc(String(c.value)) : 'Free delivery'}</td><td>${c.min_order || '—'}</td>
          <td>${c.used}${c.max_uses ? ` / ${c.max_uses}` : ''}</td><td>${esc(c.expires_at || '—')}</td>
          <td class="nowrap"><label class="check" style="margin:0"><input type="checkbox" data-cp="${c.id}" ${c.active ? 'checked' : ''}> On</label> <button type="button" class="btn sm ghost danger" data-act="cpdel" data-id="${c.id}" aria-label="Delete">${icon('trash', 'sm')}</button></td></tr>`).join('') || '<tr><td colspan="6" class="hint">No coupons yet.</td></tr>'}</tbody></table></div>
      <form data-act="cpadd" class="grid g3 mt"><div><label>Code</label><input name="code" required placeholder="EID20"></div>
        <div><label>Type</label><select name="kind"><option value="percent">Percent off</option><option value="fixed">Amount off</option><option value="free_delivery">Free delivery</option></select></div>
        <div><label>Value</label><input name="value" type="number" min="0" placeholder="20"></div>
        <div><label>Minimum order</label><input name="min_order" type="number" min="0" placeholder="0"></div><div><label>Max uses</label><input name="max_uses" type="number" min="1" placeholder="unlimited"></div>
        <div><label>Expires</label><input name="expires_at" type="date"></div>
        <div><button class="btn primary" type="submit">${icon('plus')}Add coupon</button></div></form></div>`;
  ctx.view.querySelectorAll('[data-cp]').forEach((x) => x.addEventListener('change', () => api(`/sales/coupons/${x.dataset.cp}`, { method: 'PUT', body: { active: x.checked } }).then(() => toast('Saved'))));
  bind({ cpadd: async (f) => { await api('/sales/coupons', { method: 'POST', body: formData(f) }); toast('Coupon added'); ctx.route(); },
    cpdel: async (b) => { await api(`/sales/coupons/${b.dataset.id}`, { method: 'DELETE' }); ctx.route(); },
    save: async (f) => {
    const d = formData(f);
    const methods = Object.fromEntries(Object.keys(p.available).map((k) => [k, d[`m_${k}`] || '']));
    await api('/sales/payments', { method: 'PUT', body: { methods, account_type: d.account_type, advance: d.advance, note: d.note } }); toast('Saved');
  } }, ctx.view);
}
