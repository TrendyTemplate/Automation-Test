// Rules that work without the AI: comment rules, chat menu (Get Started / ice breakers / menu), business hours.
import { $, esc, icon, api, toast, bind, formData, modal } from '../ui.js';

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
        await api(`/sales/channels/${c.id}/rules`, { method: 'PUT', body: { hide_phones: Boolean(d.hide_phones), hide_links: Boolean(d.hide_links), hide_words: split(d.hide_words),
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
