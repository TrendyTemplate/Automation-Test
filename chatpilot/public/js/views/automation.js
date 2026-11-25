// Rules that work without the AI: comment rules, chat menu (Get Started / ice breakers / menu), business hours.
import { $, esc, icon, api, toast, bind, formData, modal, ago } from '../ui.js';

const lines = (a) => (a || []).join('\n');
const split = (t) => String(t || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

export function commentRules(ctx, c) {
  const r = c.comment_rules;
  const trig = (t = {}, i) => `<div class="card flat mt-s" data-trig="${i}"><div class="grid g2">
      <div><label>When a comment contains</label><input name="w${i}" value="${esc((t.words || []).join(', '))}" placeholder="price, dam koto, inbox"></div>
      <div><label>Public reply under the comment</label><input name="p${i}" value="${esc(t.public || '')}" placeholder="Inbox e details dilam ✅"></div></div>
      <label>Message to their inbox <span class="hint">(private reply, once per comment)</span></label><textarea name="m${i}" rows="2" placeholder="Price, sizes and how to order…">${esc(t.private || '')}</textarea></div>`;
  modal(`<h2>Comment rules · ${esc(c.name || '')}</h2><p class="hint">These run before the AI. Keyword replies are instant and free — the AI handles everything else.</p>
    <form data-act="save">
      <h3 class="mt">Hide automatically</h3>
      <label class="check"><input type="checkbox" name="hide_phones" ${r.hide_phones ? 'checked' : ''}> Comments with a phone number <span class="hint">(protects buyers; competitors can't call them)</span></label>
      <label class="check"><input type="checkbox" name="hide_links" ${r.hide_links ? 'checked' : ''}> Comments with links</label>
      <label>Comments with these words</label><input name="hide_words" value="${esc(r.hide_words.join(', '))}" placeholder="scam, fake, …">
      <h3 class="mt">Live & post selling</h3>
      <label class="check"><input type="checkbox" name="sku_replies" ${r.sku_replies ? 'checked' : ''}> Comments with a product code (SKU, e.g. "P12 L") get the price and how to order in their inbox instantly</label>
      <h3 class="mt">Keyword replies</h3><div id="trigs">${(r.triggers.length ? r.triggers : [{}]).map(trig).join('')}</div>
      <button type="button" class="btn sm mt-s" data-act="more">${icon('plus', 'sm')}Add keyword</button>
      <h3 class="mt">Which posts</h3>
      <label class="check"><input type="checkbox" name="once_per_person" ${r.once_per_person ? 'checked' : ''}> Answer each person once per post (no repeat replies)</label>
      <label>Only answer on these posts <span class="hint">(post links or ids, one per line; empty = all posts)</span></label><textarea name="only_posts" rows="2">${esc(lines(r.only_posts))}</textarea>
      <label>Never auto-answer on these posts</label><textarea name="skip_posts" rows="2">${esc(lines(r.skip_posts))}</textarea>
      <button class="btn primary mt" type="submit">Save rules</button></form>`, (el, close) => {
    let count = Math.max(1, r.triggers.length);
    bind({
      more: () => { $('#trigs', el).insertAdjacentHTML('beforeend', trig({}, count++)); },
      save: async (f) => {
        const d = formData(f);
        const triggers = [];
        for (let i = 0; i < count; i++) if (split(d[`w${i}`]).length) triggers.push({ words: split(d[`w${i}`]), public: d[`p${i}`] || '', private: d[`m${i}`] || '' });
        await api(`/sales/channels/${c.id}/rules`, { method: 'PUT', body: { sku_replies: Boolean(d.sku_replies), hide_phones: Boolean(d.hide_phones), hide_links: Boolean(d.hide_links), hide_words: split(d.hide_words),
          once_per_person: Boolean(d.once_per_person), only_posts: split(d.only_posts), skip_posts: split(d.skip_posts), triggers } });
        toast('Comment rules saved'); close(); ctx.route();
      },
    }, el);
  }, { wide: true });
}

export function chatMenu(ctx, c) {
  const p = c.profile || { greeting: c.greeting || '', ice_breakers: [], menu: [] };
  const wa = c.platform === 'whatsapp';
  modal(`<h2>Chat menu · ${esc(c.name || '')}</h2>
    <p class="hint">${wa ? 'WhatsApp shows up to 4 conversation starters when someone opens a chat with you.' : 'What people see before they type: a Get Started button, a greeting, up to 4 quick questions and a menu.'} Tapping one sends it to the assistant like a typed message.</p>
    <form data-act="save">
      ${wa || c.platform === 'instagram' ? '' : `<label>Greeting <span class="hint">(shown before the first message, 160 characters)</span></label><input name="greeting" maxlength="160" value="${esc(p.greeting || '')}" placeholder="আসসালামু আলাইকুম! অর্ডার করতে মেসেজ দিন।">`}
      <label>Quick questions <span class="hint">(one per line, up to 4)</span></label><textarea name="ice_breakers" rows="4" placeholder="দাম কত?\nডেলিভারি চার্জ কত?\nকিভাবে অর্ডার করব?">${esc(lines(p.ice_breakers))}</textarea>
      ${wa ? '' : `<label>Menu <span class="hint">(up to 5; with a link it opens the page, without one it asks the assistant)</span></label>
        ${[0, 1, 2, 3, 4].map((i) => `<div class="grid g2"><input name="t${i}" placeholder="Title" maxlength="30" value="${esc(p.menu?.[i]?.title || '')}"><input name="u${i}" placeholder="https://… (optional)" value="${esc(p.menu?.[i]?.url || '')}"></div>`).join('')}`}
      <button class="btn primary mt" type="submit">Publish to ${wa ? 'WhatsApp' : c.platform === 'instagram' ? 'Instagram' : 'Messenger'}</button></form>`, (el, close) => {
    bind({
      save: async (f) => {
        const d = formData(f);
        const menu = [0, 1, 2, 3, 4].map((i) => ({ title: d[`t${i}`] || '', url: d[`u${i}`] || '' })).filter((m) => m.title);
        await api(`/sales/channels/${c.id}/profile`, { method: 'PUT', body: { greeting: d.greeting || '', ice_breakers: String(d.ice_breakers || ''), menu } });
        toast('Published'); close(); ctx.route();
      },
    }, el);
  }, { wide: true });
}

const DAYS = [['sat', 'Saturday'], ['sun', 'Sunday'], ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday']];
export async function hours(ctx) {
  const h = await api('/sales/hours');
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Business hours</h1><p>When the shop is closed, customers get an away message — or the assistant keeps selling and tells them a person will confirm when you open.</p></div>
      <span class="badge ${h.open_now ? 'ok' : 'warn'}">${h.enabled ? (h.open_now ? 'Open now' : 'Closed now') : 'Always open'}</span></div>
    <form class="card" data-act="save" style="max-width:720px">
      <label class="check"><input type="checkbox" name="enabled" ${h.enabled ? 'checked' : ''}> Use business hours</label>
      <label>Time zone</label><input name="tz" value="${esc(h.tz)}">
      <div class="table-wrap mt-s"><table><tbody>${DAYS.map(([k, l]) => `<tr><td><label class="check" style="margin:0"><input type="checkbox" name="on_${k}" ${h.days[k] ? 'checked' : ''}> ${l}</label></td>
        <td><input type="time" name="from_${k}" value="${esc(h.days[k]?.[0] || '10:00')}"></td><td><input type="time" name="to_${k}" value="${esc(h.days[k]?.[1] || '22:00')}"></td></tr>`).join('')}</tbody></table></div>
      <p class="field-hint">An end time earlier than the start (e.g. 18:00 → 02:00) means open past midnight.</p>
      <label>Away message</label><textarea name="away" rows="3">${esc(h.away)}</textarea>
      <label class="check"><input type="checkbox" name="ai_after_hours" ${h.ai_after_hours ? 'checked' : ''}> Let the assistant keep answering after hours (it says a person will confirm when you open)</label>
      <p class="field-hint">The away message is sent at most once every 12 hours per customer, and only when the assistant isn't answering on its own.</p>
      <button class="btn primary mt" type="submit">Save</button></form>`;
  bind({
    save: async (f) => {
      const d = formData(f);
      const days = Object.fromEntries(DAYS.map(([k]) => [k, d[`on_${k}`] ? [d[`from_${k}`], d[`to_${k}`]] : null]));
      await api('/sales/hours', { method: 'PUT', body: { enabled: Boolean(d.enabled), tz: d.tz, days, away: d.away, ai_after_hours: Boolean(d.ai_after_hours) } });
      toast('Saved'); ctx.route();
    },
  }, ctx.view);
}

/** Broadcasts: one message to many customers, inside Meta's rules. */
export async function broadcasts(ctx) {
  const [list, chans, otpl] = await Promise.all([api('/sales/broadcasts'), api('/sales/channels'), api('/sales/order-templates').catch(() => ({}))]);
  const waChans = chans.filter((c) => c.platform === 'whatsapp');
  const PL = { messenger: 'Messenger', instagram: 'Instagram', whatsapp: 'WhatsApp' };
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Broadcasts</h1><p>Send news or an offer to many customers at once. Meta only allows this to people who wrote in the last 24 hours — on WhatsApp, everyone else needs an approved template (Meta charges per template message). Anyone who writes "stop" is never messaged again.</p></div></div>
    <form class="card" data-act="send" style="max-width:820px">
      <div class="grid g3"><div><label>From</label><select name="channel_id">${chans.map((c) => `<option value="${c.id}" data-p="${c.platform}">${esc(c.name || '')} · ${PL[c.platform]}</option>`).join('')}</select></div>
        <div><label>To</label><select name="segment"><option value="all">Everyone</option><option value="buyers">Buyers</option><option value="not_bought">Haven't bought yet</option></select></div>
        <div><label>With label <span class="hint">(optional)</span></label><input name="label" placeholder="vip"></div></div>
      <label>Message <span class="hint">({{name}} = first name)</span></label><textarea name="text" rows="3" maxlength="2000" placeholder="আসসালামু আলাইকুম {{name}}! নতুন কালেকশন এসেছে…"></textarea>
      <div id="tpl"></div>
      <label class="check"><input type="checkbox" name="confirm_optin"> These customers agreed to get messages from my shop</label>
      <div class="row mt"><button type="button" class="btn" data-act="preview">${icon('users')}Who gets it?</button><span class="hint" id="pv"></span><span class="spacer"></span><button class="btn primary" type="submit">${icon('send')}Send</button></div></form>
    <div class="card pad-0 mt"><div class="table-wrap"><table><thead><tr><th>When</th><th>From</th><th>Message</th><th>Sent</th><th>Status</th></tr></thead><tbody>
      ${list.map((b) => `<tr><td class="nowrap hint">${ago(b.created_at)}</td><td>${esc(b.channel_name || '')} <span class="pf ${esc(b.platform)}">${PL[b.platform] || ''}</span></td>
        <td class="truncate" style="max-width:320px">${esc(b.body || (b.template ? `Template: ${b.template.name}` : ''))}</td>
        <td>${b.sent}/${b.total}${b.failed ? ` <span class="badge bad">${b.failed} failed</span>` : ''}${b.skipped ? ` <span class="hint">· ${b.skipped} not allowed</span>` : ''}</td>
        <td>${b.status === 'sending' ? `<span class="badge warn">Sending</span> <button class="btn sm ghost" data-act="cancel" data-id="${b.id}">Stop</button>` : `<span class="badge ${b.status === 'done' ? 'ok' : ''}">${esc(b.status)}</span>`}</td></tr>`).join('')
      || '<tr><td colspan="5" class="hint">No broadcasts yet.</td></tr>'}</tbody></table></div></div>
    ${waChans.length ? `<div class="grid g2 mt">
      <form class="card" data-act="newtpl"><h3>${icon('plus')} New WhatsApp template</h3><p class="hint">Meta reviews it (usually minutes). <b>Utility</b> = order updates (cheaper, no offers allowed); <b>Marketing</b> = offers. Use {{1}}, {{2}} for values like the customer's name.</p>
        <div class="grid g2"><div><label>Number</label><select name="channel">${waChans.map((c) => `<option value="${c.id}">${esc(c.name || '')}</option>`).join('')}</select></div>
          <div><label>Category</label><select name="category"><option value="UTILITY">Utility (order updates)</option><option value="MARKETING">Marketing (offers)</option></select></div>
          <div><label>Name</label><input name="name" placeholder="order_shipped" required></div><div><label>Language</label><select name="language"><option value="bn">Bangla</option><option value="en">English</option></select></div></div>
        <label>Text</label><textarea name="body" rows="3" required placeholder="Hi {{1}}, your order #{{2}} has been shipped. Tracking: {{3}}"></textarea>
        <label>Examples for {{1}}, {{2}}… <span class="hint">(comma separated)</span></label><input name="examples" placeholder="Rahim, 1024, SF12345">
        <button class="btn primary mt" type="submit">Submit to Meta</button></form>
      <form class="card" data-act="otpl"><h3>${icon('send')} Order updates after 24 hours</h3><p class="hint">Couriers take days — after 24 hours WhatsApp only allows approved templates. Name the template for each update; values: {{name}}, {{order}}, {{total}}, {{tracking}}, {{courier}}.</p>
        ${['confirmed', 'shipped', 'delivered', 'cancelled'].map((st) => `<div class="grid g3"><div><label>${st[0].toUpperCase() + st.slice(1)}</label><input name="${st}_name" placeholder="order_${st}" value="${esc(otpl[st]?.name || '')}"></div>
          <div><label>Language</label><input name="${st}_lang" value="${esc(otpl[st]?.language || 'bn')}"></div><div><label>Values in order</label><input name="${st}_params" placeholder="{{name}}, {{order}}${st === 'shipped' ? ', {{tracking}}' : ''}" value="${esc((otpl[st]?.params || []).join(', '))}"></div></div>`).join('')}
        <button class="btn primary mt" type="submit">Save</button></form></div>` : ''}`;
  const form = ctx.view.querySelector('form');
  let templates = [];
  const body = () => {
    const d = formData(form); const t = templates.find((x) => x.name === d.template);
    return { channel_id: Number(d.channel_id), segment: d.segment, label: d.label || '', text: d.text || '', confirm_optin: Boolean(d.confirm_optin),
      template: t ? { name: t.name, language: t.language, params: Array.from({ length: t.params }, (_, i) => d[`tp${i}`] || '') } : null };
  };
  const loadTpl = async () => {
    const sel = form.channel_id.selectedOptions[0];
    const box = $('#tpl', ctx.view);
    if (sel?.dataset.p !== 'whatsapp') { box.innerHTML = ''; templates = []; return; }
    templates = await api(`/sales/channels/${sel.value}/templates`).catch(() => []);
    box.innerHTML = `<label>WhatsApp template for people outside 24 hours <span class="hint">(approved in WhatsApp Manager)</span></label><select name="template"><option value="">— none: only people inside 24 hours —</option>${templates.map((t) => `<option value="${esc(t.name)}">${esc(t.name)} (${esc(t.language)}) — ${esc(t.body.slice(0, 60))}</option>`).join('')}</select><div id="tparams"></div>`;
    box.querySelector('select').addEventListener('change', (e) => {
      const t = templates.find((x) => x.name === e.target.value);
      $('#tparams', box).innerHTML = t ? Array.from({ length: t.params }, (_, i) => `<input name="tp${i}" placeholder="{{${i + 1}}} e.g. {{name}}" class="mt-s">`).join('') : '';
    });
  };
  if (chans.length) loadTpl();
  form.channel_id?.addEventListener('change', loadTpl);
  bind({
    preview: async () => { const p = await api('/sales/broadcasts/preview', { method: 'POST', body: body() }); $('#pv', ctx.view).textContent = `${p.total} will get it${p.template ? ` (${p.template} by template)` : ''} · ${p.outside_window} outside 24 hours · ${p.opted_out} said stop`; },
    send: async () => { const r = await api('/sales/broadcasts', { method: 'POST', body: body() }); toast(`Sending to ${r.total} customers`); ctx.route(); },
    newtpl: async (f) => { const d = formData(f); const r = await api(`/sales/channels/${d.channel}/templates`, { method: 'POST', body: d }); toast(`Submitted "${r.name}" — status: ${r.status}`); f.reset(); },
    otpl: async (f) => {
      const d = formData(f);
      const body = Object.fromEntries(['confirmed', 'shipped', 'delivered', 'cancelled'].map((st) => [st, d[`${st}_name`] ? { name: d[`${st}_name`], language: d[`${st}_lang`] || 'bn', params: d[`${st}_params`] } : null]));
      await api('/sales/order-templates', { method: 'PUT', body }); toast('Saved');
    },
    cancel: async (b) => { await api(`/sales/broadcasts/${b.dataset.id}/cancel`, { method: 'POST' }); ctx.route(); },
  }, ctx.view);
}
