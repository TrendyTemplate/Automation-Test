// Couriers setup: Steadfast, Pathao, RedX (booking) and BDCourier (fraud check).
import { esc, icon, api, toast, bind, formData, confirmBox, label } from '../ui.js';

const FORMS = {
  steadfast: { help: 'Steadfast merchant panel → API → API key & Secret key.', fields: [['api_key', 'API key'], ['secret_key', 'Secret key', 'password']] },
  pathao: { help: 'Pathao Merchant → Developers API: client ID & secret, your login email/phone & password, and the store ID to pick up from.',
    fields: [['client_id', 'Client ID'], ['client_secret', 'Client secret', 'password'], ['username', 'Merchant login (email)'], ['password', 'Merchant password', 'password'], ['store_id', 'Store ID']], sandbox: true },
  redx: { help: 'RedX merchant panel → Developer API → access token. Area = your default delivery area (id & name from RedX).',
    fields: [['token', 'API access token', 'password'], ['area_id', 'Default area ID'], ['area_name', 'Default area name'], ['pickup_store_id', 'Pickup store ID (optional)']], sandbox: true },
  bdcourier: { help: 'Optional: a bdcourier.com API key gives delivery history across all couriers for the fraud check. Without it, Steadfast\'s own check (if connected) and your past orders are used.',
    fields: [['api_key', 'API key', 'password']] },
};

export async function couriers(ctx) {
  const st = await api('/sales/couriers');
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Couriers</h1><p>Book parcels from an order with one click, get the tracking code into the chat automatically, and see a customer's delivery history before you ship cash on delivery.</p></div></div>
    <div class="grid g2">${Object.entries(FORMS).map(([k, f]) => { const c = st.couriers[k]; return `<form class="card" data-act="save" data-c="${k}">
      <div class="row nowrap"><h3 style="margin:0;flex:1">${esc(c.label)}</h3>${c.connected ? `<span class="badge ok">${icon('checkCircle', 'sm')} Connected${c.sandbox ? ' (sandbox)' : ''}</span>` : '<span class="badge">Not connected</span>'}</div>
      <p class="hint">${esc(f.help)}</p>
      ${c.connected ? `<div class="row"><button type="button" class="btn ghost danger" data-act="off" data-c="${k}">Disconnect</button><span class="hint">Re-enter the keys below to replace them.</span></div>` : ''}
      <div class="grid g2">${f.fields.map(([n, l, t]) => `<div><label>${esc(l)}</label><input name="${n}" type="${t || 'text'}" autocomplete="off"></div>`).join('')}</div>
      ${f.sandbox ? '<label class="check"><input type="checkbox" name="sandbox"> Sandbox (test) account</label>' : ''}
      <button class="btn primary mt" type="submit">${c.connected ? 'Update keys' : 'Connect'}</button></form>`; }).join('')}</div>
    ${st.webhookToken ? `<div class="card mt"><h3>${icon('link')} Faster status updates (optional)</h3><p class="hint">Paste this URL as the webhook / callback URL in your courier panels. Without it, ChatPilot checks open parcels every couple of hours.</p>
      <div class="row nowrap"><input readonly value="${esc(st.webhook_base + st.webhookToken)}" id="hook"><button class="btn" data-act="copy">${icon('copy')}Copy</button></div></div>` : ''}`;
  bind({
    save: async (f) => { const d = formData(f); await api(`/sales/couriers/${f.dataset.c}`, { method: 'PUT', body: d }); toast(`${label(f.dataset.c)} connected`); ctx.route(); },
    off: async (b) => { if (await confirmBox('Disconnect this courier?', 'Booked parcels keep their tracking codes.', { danger: true, ok: 'Disconnect' })) { await api(`/sales/couriers/${b.dataset.c}`, { method: 'DELETE' }); ctx.route(); } },
    copy: async () => { await navigator.clipboard.writeText(document.getElementById('hook').value); toast('Copied'); },
  }, ctx.view);
}
