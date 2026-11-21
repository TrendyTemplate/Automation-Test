import { $, $$, esc, icon, api, toast, bind, formData, badge, ago, fmtDate, fmtDay, empty, modal, confirmBox, switchEl, label } from '../ui.js';

const ERR = {
  limit: 'Your plan’s email-account limit is reached. Upgrade to add more.', provider_disabled: 'That connection option is not enabled yet.',
  no_refresh_token: 'The provider did not grant offline access. Remove the app from your Google/Microsoft account permissions and try again.',
  forbidden: 'Only workspace owners/admins can connect accounts.',
};
const G_ICON = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6C12.3 13.6 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.4 0-11.7-4.1-13.6-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>';
const MS_ICON = '<svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>';
const MODE = { off: 'Sort only', draft: 'Draft · I approve', auto: 'Autopilot' };

export async function mailboxes(ctx, params) {
  if (params.error) toast(ERR[params.error] || params.error, true);
  if (params.connected) toast('Account connected — fetching recent emails…');
  const [list, prov] = await Promise.all([api('/mailboxes'), api('/providers')]);
  const presets = prov.presets;
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Email accounts</h1><p>Connect every inbox you use. Credentials are encrypted with a key unique to your workspace.</p></div>
      <div class="actions"><button class="btn primary" data-act="add">${icon('plus')}Connect account</button></div></div>
    ${list.length ? `<div class="grid g2">${list.map((m) => `
      <div class="card">
        <div class="row nowrap"><span class="brand-mark" style="width:38px;height:38px">${icon('mail')}</span><div class="truncate" style="flex:1"><b>${esc(m.email)}</b>
          <div class="hint">${esc(m.label || presets[m.provider]?.name || m.provider)} · ${m.auth_type === 'password' ? 'app password' : `secure sign-in (${m.auth_type.replace('oauth_', '')})`}</div></div>
          ${m.last_error ? badge('error') : m.enabled ? badge('connected', 'ok') : badge('paused', 'warn')}</div>
        ${m.last_error ? `<div class="callout bad mt">${icon('alert')}<div>${esc(m.last_error).slice(0, 220)}</div></div>` : ''}
        <dl class="kv mt"><dt>Reply mode</dt><dd><select data-act="mode" data-id="${m.id}" style="height:32px">${Object.entries(MODE).map(([k, l]) => `<option value="${k}" ${m.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></dd>
          <dt>Emails</dt><dd>${m.message_count}</dd><dt>Last checked</dt><dd>${ago(m.last_sync_at)}</dd>
          ${m.mode === 'auto' ? `<dt>Autopilot for</dt><dd>${m.auto_categories ? (m.auto_categories.map((c) => esc(label(c))).join(', ') || 'no categories') : 'all categories'} · <a href="#autopilot">change</a></dd>` : ''}</dl>
        <div class="row mt"><button class="btn sm" data-act="sync" data-id="${m.id}">${icon('refresh')}Check now</button>
          <button class="btn sm" data-act="edit" data-id="${m.id}">${icon('settings')}Edit</button>
          <button class="btn sm" data-act="sig" data-id="${m.id}">${icon('note')}Signature</button>
          ${m.last_error && m.auth_type !== 'password' ? `<a class="btn sm primary" href="/api/oauth/${m.auth_type.replace('oauth_', '')}/connect">${icon('refresh')}Reconnect</a>` : ''}
          ${m.auth_type === 'password' ? `<button class="btn sm" data-act="pw" data-id="${m.id}">${icon('key')}Update password</button>` : ''}
          <button class="btn sm ghost" data-act="toggle" data-id="${m.id}" data-en="${m.enabled}">${m.enabled ? 'Pause' : 'Resume'}</button>
          <span class="spacer"></span><button class="btn sm ghost danger" data-act="del" data-id="${m.id}">${icon('trash')}</button></div>
      </div>`).join('')}</div>` : `<div class="card">${empty('mail', 'Connect your first inbox', 'Gmail, Outlook, Microsoft 365, Yahoo, iCloud, Zoho, Yandex or any business email (cPanel, Hostinger, GoDaddy…).', `<button class="btn primary mt" data-act="add">${icon('plus')}Connect account</button>`)}</div>`}
    <div class="callout info mt">${icon('shieldCheck')}<div><b>Your accounts are protected:</b> passwords and sign-in tokens are encrypted (AES-256) with a key unique to your workspace, connections always verify TLS certificates, and removing an account revokes our access at Google immediately.</div></div>`;

  const openAdd = () => modal(`
    <h2>Connect an email account</h2>
    ${prov.oauth.google?.mailbox || prov.oauth.microsoft?.mailbox ? `<p class="hint">Recommended — sign in securely, no password stored:</p><div class="grid g2">
      ${prov.oauth.google?.mailbox ? `<a class="btn oauth" href="/api/oauth/google/connect">${G_ICON} Gmail / Google Workspace</a>` : ''}
      ${prov.oauth.microsoft?.mailbox ? `<a class="btn oauth" href="/api/oauth/microsoft/connect">${MS_ICON} Outlook / Microsoft 365</a>` : ''}</div>
      <div class="divider"><span>or connect any provider with IMAP</span></div>` : ''}
    <form data-act="create">
      <div class="grid g2">
        <div><label>Provider</label><select name="provider" id="provider">${Object.entries(presets).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('')}</select></div>
        <div><label>Display name <span class="hint">(optional)</span></label><input name="label" placeholder="Support team"></div>
        <div><label>Email address</label><input name="email" type="email" required autocomplete="off"></div>
        <div><label>App password</label><input name="password" type="password" required autocomplete="new-password"></div>
      </div>
      <p class="field-hint" id="provider-help"></p>
      <div id="custom-fields" class="grid g2" hidden>
        <div><label>IMAP server</label><input name="imap_host" placeholder="mail.yourdomain.com"></div><div><label>IMAP port</label><input name="imap_port" value="993"></div>
        <div><label>SMTP server</label><input name="smtp_host" placeholder="mail.yourdomain.com"></div><div><label>SMTP port</label><input name="smtp_port" value="465"></div>
        <div><label>Username <span class="hint">(if not the email)</span></label><input name="username"></div></div>
      <label>Start in</label><select name="mode"><option value="draft">Draft mode — AI writes, you approve (recommended)</option><option value="auto">Autopilot — AI sends when it's safe</option><option value="off">Sort only — no replies</option></select>
      <div class="row mt"><button class="btn primary" type="submit">${icon('lock')}Test & connect securely</button><span class="hint">We test the login before saving.</span></div>
    </form>`, (el, close) => {
    const sel = $('#provider', el);
    const upd = () => { $('#provider-help', el).textContent = presets[sel.value].help; $('#custom-fields', el).hidden = sel.value !== 'custom'; };
    sel.addEventListener('change', upd); upd();
    bind({ create: async (f) => { await api('/mailboxes', { method: 'POST', body: formData(f) }); close(); toast('Connected! Fetching recent emails…'); ctx.route(); } }, el);
  }, { wide: true });

  bind({
    add: openAdd,
    mode: async (s) => { await api(`/mailboxes/${s.dataset.id}`, { method: 'PATCH', body: { mode: s.value } }); toast(`Mode: ${MODE[s.value]}`); },
    sync: async (b) => { const r = await api(`/mailboxes/${b.dataset.id}/sync`, { method: 'POST' }); toast(r.error ? r.error : `Checked — ${r.stored ?? 0} new`, Boolean(r.error)); ctx.route(); },
    toggle: async (b) => { await api(`/mailboxes/${b.dataset.id}`, { method: 'PATCH', body: { enabled: b.dataset.en !== '1' } }); ctx.route(); },
    del: async (b) => {
      if (!(await confirmBox('Remove this account?', 'Its stored emails are deleted and our access to the mailbox is revoked.', { danger: true, ok: 'Remove' }))) return;
      const r = await api(`/mailboxes/${b.dataset.id}`, { method: 'DELETE' }); toast(r.revoked ? 'Removed and access revoked at Google' : 'Removed'); ctx.route();
    },
    edit: (b) => {
      const m = list.find((x) => String(x.id) === b.dataset.id);
      const pw = m.auth_type === 'password';
      modal(`<h2>Edit ${esc(m.email)}</h2><form data-act="saveEdit">
        <label>Display name</label><input name="label" value="${esc(m.label || '')}" placeholder="e.g. Support team">
        ${pw ? `<h4 class="section-title">Server settings</h4><div class="grid g2">
          <div><label>IMAP server</label><input name="imap_host" value="${esc(m.imap_host)}"></div><div><label>IMAP port</label><input name="imap_port" type="number" value="${m.imap_port}"></div>
          <div><label>SMTP server</label><input name="smtp_host" value="${esc(m.smtp_host)}"></div><div><label>SMTP port</label><input name="smtp_port" type="number" value="${m.smtp_port}"></div>
          <div><label>Username</label><input name="username" value="${esc(m.username)}"></div></div>
          <p class="field-hint">Changing server settings re-tests the connection before saving.</p>` : `<p class="hint mt">Server settings are managed by ${m.auth_type === 'oauth_google' ? 'Google' : 'Microsoft'} for this account.</p>`}
        <button class="btn primary mt" type="submit">Save</button></form>`, (el, close) => bind({
        saveEdit: async (f) => {
          const d = formData(f);
          const body = { label: d.label };
          if (pw && ['imap_host', 'imap_port', 'smtp_host', 'smtp_port', 'username'].some((k) => String(d[k]) !== String(m[k]))) {
            Object.assign(body, { imap_host: d.imap_host, imap_port: Number(d.imap_port), smtp_host: d.smtp_host, smtp_port: Number(d.smtp_port), username: d.username,
              imap_secure: [993, 1993].includes(Number(d.imap_port)), smtp_secure: Number(d.smtp_port) === 465 });
          }
          await api(`/mailboxes/${m.id}`, { method: 'PATCH', body }); close(); toast('Saved'); ctx.route();
        },
      }, el));
    },
    pw: (b) => modal(`<h2>Update app password</h2><form data-act="savepw"><label>New app password</label><input type="password" name="password" required autocomplete="new-password"><button class="btn primary mt" type="submit">Test & save</button></form>`,
      (el, close) => bind({ savepw: async (f) => { await api(`/mailboxes/${b.dataset.id}`, { method: 'PATCH', body: formData(f) }); close(); toast('Saved — connection verified'); ctx.route(); } }, el)),
    sig: (b) => {
      const m = list.find((x) => String(x.id) === b.dataset.id);
      modal(`<h2>Signature for ${esc(m.email)}</h2><p class="hint">Overrides the workspace signature for replies sent from this account.</p><form data-act="s"><textarea name="signature">${esc(m.signature || '')}</textarea><button class="btn primary mt" type="submit">Save</button></form>`,
        (el, close) => bind({ s: async (f) => { await api(`/mailboxes/${m.id}`, { method: 'PATCH', body: formData(f) }); toast('Saved'); close(); ctx.route(); } }, el));
    },
  }, ctx.view);
}

export async function brain(ctx) {
  const [s, mailboxes, corrections] = await Promise.all([api('/settings'), api('/mailboxes'), api('/ai/corrections')]);
  const oooOn = s.ooo_until && new Date(s.ooo_until) > new Date();
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>AI training</h1><p>Teach the assistant who you are, what you sell and how you write.</p></div></div>
    <form data-act="save" class="col" style="gap:16px">
      <div class="card"><h3>Your business</h3>
        <div class="grid g2"><div><label>Workspace name</label><input name="name" value="${esc(s.name)}"></div><div><label>Brand name</label><input name="business_name" value="${esc(s.business_name)}"></div></div>
        <label>What does your business do?</label><textarea name="business_description" placeholder="Who you serve, what you sell, where you operate, what makes you different…">${esc(s.business_description)}</textarea>
        <div class="grid g3"><div><label>Reply tone</label><input name="reply_tone" value="${esc(s.reply_tone)}" placeholder="friendly and professional"></div>
          <div><label>Fallback language</label><input name="default_language" value="${esc(s.default_language)}" placeholder="auto"></div>
          <div><label>Your language <span class="hint">(for translations)</span></label><input name="owner_language" value="${esc(s.owner_language || 'en')}" placeholder="English, বাংলা, Español…"></div></div>
        <div class="grid g2"><div><label>Meeting booking link</label><input name="booking_link" value="${esc(s.booking_link)}" placeholder="https://cal.com/you"></div>
          <div><label>Your hourly rate <span class="hint">(to show money saved)</span></label><input name="hourly_rate" type="number" min="0" step="1" value="${esc(s.hourly_rate)}"></div></div>
        <label>Email signature</label><textarea name="signature" style="min-height:80px">${esc(s.signature)}</textarea>
      </div>
      <div class="card"><div class="card-h"><h3>${icon('wand')} Writing style</h3></div>
        <p class="hint">The AI writes like you. Learn your style automatically from emails you've already sent, or describe it.</p>
        <div class="row nowrap"><select id="style-mb" style="flex:1">${mailboxes.map((m) => `<option value="${m.id}">${esc(m.email)}</option>`).join('') || '<option value="">Connect an account first</option>'}</select>
          <button class="btn" type="button" data-act="learn">${icon('sparkles')}Learn from my sent emails</button></div>
        <textarea name="style_guide" id="style-guide" class="mt-s" placeholder="e.g. Short sentences. Greets with “Hi {name},”. Signs off “Cheers”. No emojis.">${esc(s.style_guide)}</textarea>
        <div class="setting-row"><div><div class="t">Learn from my edits</div><div class="d">When you change an AI draft before sending, the correction is remembered.</div></div>${switchEl('learn_from_edits', s.learn_from_edits)}</div>
        ${corrections.length ? `<details><summary class="hint" style="cursor:pointer">${corrections.length} lesson(s) learned from your edits</summary>${corrections.map((c) => `<div class="card flat mt-s"><div class="row hint">${esc(c.email_summary)} · ${fmtDay(c.created_at)}<span class="spacer"></span><button class="btn xs ghost" type="button" data-act="forget" data-id="${c.id}">Forget</button></div><div class="split mt-s"><div><div class="hint">AI wrote</div><pre class="mail-body small">${esc(c.ai_draft)}</pre></div><div><div class="hint">You sent</div><pre class="mail-body small">${esc(c.final_text)}</pre></div></div></div>`).join('')}</details>` : ''}
      </div>
      <div class="card"><h3>${icon('calendar')} Out of office</h3>
        <p class="hint">While you're away the AI keeps answering what it can, tells people when you're back, and holds the rest.</p>
        <div class="grid g2"><div><label>Away until</label><input type="date" name="ooo_until" value="${esc((s.ooo_until || '').slice(0, 10))}"></div>
          <div><label>Message to mention</label><input name="ooo_message" value="${esc(s.ooo_message)}" placeholder="I'm travelling until Monday with limited access."></div></div>
        ${oooOn ? `<div class="callout primary mt">${icon('calendar')}<div>Out-of-office is <b>on</b> until ${fmtDay(s.ooo_until)}.</div></div>` : ''}
      </div>
      <div class="card"><h3>Attachments</h3><div class="setting-row"><div><div class="t">Let the AI read attachments</div><div class="d">PDFs (orders, invoices, briefs) and images are read during analysis. They are never stored.</div></div>${switchEl('read_attachments', s.read_attachments)}</div></div>
      <div><button class="btn primary lg" type="submit">Save changes</button></div>
    </form>`;
  bind({
    save: async (f) => {
      const d = formData(f);
      d.learn_from_edits = d.learn_from_edits ? 1 : 0; d.read_attachments = d.read_attachments ? 1 : 0;
      d.ooo_until = d.ooo_until ? new Date(`${d.ooo_until}T23:59:00`).toISOString() : '';
      await api('/settings', { method: 'PUT', body: d }); toast('Saved');
    },
    learn: async () => {
      const id = $('#style-mb').value;
      if (!id) throw new Error('Connect an email account first');
      toast('Reading your sent emails…');
      const r = await api('/ai/learn-style', { method: 'POST', body: { mailbox_id: id } });
      $('#style-guide').value = r.style_guide; toast(`Learned your style from ${r.samples} emails`);
    },
    forget: async (b) => { await api(`/ai/corrections/${b.dataset.id}`, { method: 'DELETE' }); ctx.route(); },
  }, ctx.view);
}

export async function autopilot(ctx) {
  const [s, mailboxes, stats, meta] = await Promise.all([api('/settings'), api('/mailboxes'), api('/autopilot/stats'), api('/rules/meta')]);
  let sla = {}; try { sla = JSON.parse(s.sla_json || '{}'); } catch { /* default */ }
  let bh = {}; try { bh = s.business_hours ? JSON.parse(s.business_hours) : {}; } catch { /* none */ }
  const alerts = String(s.alert_on || '').split(',');
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Autopilot & rules</h1><p>Decide exactly when the AI may send on its own. Every reply passes deterministic safety checks first — the AI can't talk its way past them.</p></div></div>
    <div class="callout info">${icon('shieldCheck')}<div><b>Always on, can't be disabled:</b> never replies to newsletters, robots or phishing · never sends to anyone except the original sender · blocks invented prices, unknown links, third-party email addresses, secrets and card numbers · detects hidden "prompt injection" instructions · max one auto-reply per person per day.</div></div>
    <form data-act="save" class="col" style="gap:16px">
      <div class="card"><h3>${icon('target')} Earned autopilot</h3>
        <p class="hint">Let autopilot send only the kinds of email the AI has proven it gets right. Accuracy = AI drafts you sent without changing a word.</p>
        <div class="table-wrap"><table><thead><tr><th>Category</th><th>Sent</th><th>Accuracy</th><th>Recommendation</th></tr></thead><tbody>
          ${stats.map((x) => `<tr><td>${esc(label(x.category))}</td><td>${x.sent}</td><td><div class="row nowrap"><div class="bar ${x.accuracy >= 90 ? 'ok' : x.accuracy >= 70 ? 'warn' : 'bad'}" style="width:90px"><i style="width:${x.accuracy}%"></i></div>${x.accuracy}%</div></td><td>${x.recommended ? badge('ready for autopilot', 'ok') : x.sent < 10 ? '<span class="hint">needs 10+ replies</span>' : '<span class="hint">keep reviewing</span>'}</td></tr>`).join('') || `<tr><td colspan="4" class="hint">Approve some drafts first — accuracy builds up as you review.</td></tr>`}
        </tbody></table></div>
        ${mailboxes.filter((m) => m.mode === 'auto').map((m) => `<div class="card flat mt"><b>${esc(m.email)}</b> <span class="hint">may auto-send:</span>
          <div class="chips mt-s" data-mb="${m.id}">${meta.categories.filter((c) => !['newsletter', 'notification', 'spam'].includes(c)).map((c) => `<label class="chip" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-cat="${c}" ${!m.auto_categories || m.auto_categories.includes(c) ? 'checked' : ''}>${esc(label(c))}</label>`).join('')}</div>
          <button class="btn sm mt-s" type="button" data-act="cats" data-id="${m.id}">Save for this account</button></div>`).join('') || `<p class="hint mt">No account is in Autopilot mode yet. Change it in <a href="#mailboxes">Email accounts</a>.</p>`}
      </div>
      <div class="card"><h3>Confidence & timing</h3>
        <div class="grid g3">
          <div><label>Minimum AI confidence</label><input name="auto_send_min_confidence" type="number" step="0.05" min="0" max="1" value="${esc(s.auto_send_min_confidence)}"><div class="field-hint">0.8 = 80%. Below this, replies wait for you.</div></div>
          <div><label>Human-like delay (minutes)</label><div class="row nowrap"><input name="reply_delay_min" type="number" min="0" value="${esc(s.reply_delay_min)}"><span>to</span><input name="reply_delay_max" type="number" min="0" value="${esc(s.reply_delay_max)}"></div><div class="field-hint">Feels natural — and gives you an undo window.</div></div>
          <div><label>Follow up quiet leads after (days)</label><input name="followup_days" type="number" min="0" value="${esc(s.followup_days)}"><div class="field-hint">0 = off. Follow-ups always wait for approval.</div></div>
        </div>
        <h4 class="section-title">Business hours for autopilot</h4>
        <div class="grid g4"><div><label>Timezone</label><input name="bh_tz" value="${esc(bh.tz || '')}" placeholder="blank = 24/7"></div><div><label>From</label><input type="time" name="bh_start" value="${esc(bh.start || '09:00')}"></div>
          <div><label>To</label><input type="time" name="bh_end" value="${esc(bh.end || '18:00')}"></div><div><label>Days</label><div class="chips">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d, i) => `<label class="chip" style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" data-day="${i + 1}" ${!bh.days || bh.days.includes(i + 1) ? 'checked' : ''}>${d}</label>`).join('')}</div></div></div>
      </div>
      <div class="card"><h3>Always ask me first when…</h3>
        <label>The email mentions any of these topics</label><input name="sensitive_topics" value="${esc(s.sensitive_topics)}"><div class="field-hint">Comma separated. Example: refund, chargeback, lawyer, cancel subscription</div>
        <label>Never say <span class="hint">(phrases a reply must never contain)</span></label><textarea name="never_say" style="min-height:70px" placeholder="guarantee&#10;free of charge&#10;100% refund">${esc(s.never_say)}</textarea>
        <label>Links the AI may include <span class="hint">(domains)</span></label><input name="allowed_link_domains" value="${esc(s.allowed_link_domains)}" placeholder="yourshop.com, docs.yourshop.com"><div class="field-hint">Your mailbox domains, booking link and links in your knowledge base are always allowed.</div>
      </div>
      <div class="card"><h3>${icon('clock')} Response-time targets (SLA)</h3><p class="hint">You'll see overdue emails in the inbox and get an alert when a target is missed.</p>
        <div class="grid g3">${['urgent', 'high', 'normal'].map((k) => `<div><label>${label(k)} (minutes)</label><input type="number" min="0" data-sla="${k}" value="${esc(sla[k] ?? '')}"></div>`).join('')}</div></div>
      <div class="card"><h3>${icon('bell')} Instant alerts</h3><p class="hint">Push to Telegram/Slack (set up in <a href="#integrations">Alerts & API</a>) when an email is:</p>
        <div class="chips">${[['urgent', 'Urgent'], ['negative', 'From an angry customer'], ['vip', 'From a VIP'], ['phishing', 'Phishing'], ['hot_lead', 'A hot lead (80+)']].map(([k, l]) => `<label class="chip" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-alert="${k}" ${alerts.includes(k) ? 'checked' : ''}>${l}</label>`).join('')}</div>
        <div class="setting-row mt"><div><div class="t">Morning briefing email</div><div class="d">What needs you today, hot leads and stats.</div></div>${switchEl('digest_enabled', s.digest_enabled)}</div>
        <div class="grid g2"><div><label>Briefing hour (0–23)</label><input name="digest_hour" type="number" min="0" max="23" value="${esc(s.digest_hour)}"></div><div><label>Your timezone</label><input name="timezone" value="${esc(s.timezone)}" placeholder="Asia/Dhaka"></div></div></div>
      <div><button class="btn primary lg" type="submit">Save changes</button></div>
    </form>`;
  bind({
    save: async (f) => {
      const d = formData(f);
      const days = $$('[data-day]', f).filter((x) => x.checked).map((x) => Number(x.dataset.day));
      d.business_hours = d.bh_tz ? JSON.stringify({ tz: d.bh_tz, days, start: d.bh_start, end: d.bh_end }) : '';
      delete d.bh_tz; delete d.bh_start; delete d.bh_end;
      d.sla_json = JSON.stringify(Object.fromEntries($$('[data-sla]', f).filter((x) => x.value !== '').map((x) => [x.dataset.sla, Number(x.value)])));
      d.alert_on = $$('[data-alert]', f).filter((x) => x.checked).map((x) => x.dataset.alert).join(',');
      d.digest_enabled = d.digest_enabled ? 1 : 0;
      for (const k of Object.keys(d)) if (typeof d[k] === 'boolean') delete d[k];
      await api('/settings', { method: 'PUT', body: d }); toast('Saved');
    },
    cats: async (b) => {
      const cats = $$(`[data-mb="${b.dataset.id}"] input`).filter((x) => x.checked).map((x) => x.dataset.cat);
      await api(`/mailboxes/${b.dataset.id}`, { method: 'PATCH', body: { auto_categories: cats } }); toast('Autopilot categories saved');
    },
  }, ctx.view);
}

function crudView(path, title, intro, fields, extra = '', section = 'AI training') {
  return async (ctx) => {
    const list = await api(`/${path}`);
    ctx.view.innerHTML = `
      <div class="page-h"><div><h1>${section}</h1><p>${intro}</p></div><div class="actions"><button class="btn primary" data-act="new">${icon('plus')}Add ${path === 'knowledge' ? 'knowledge' : 'template'}</button></div></div>${extra}
      ${list.map((x) => `<div class="card mb"><form data-act="save" data-id="${x.id}">
        ${fields.map(([k, l, ta]) => `<label>${l}</label>${ta ? `<textarea name="${k}">${esc(x[k])}</textarea>` : `<input name="${k}" value="${esc(x[k])}">`}`).join('')}
        <div class="row mt"><button class="btn" type="submit">Save</button><span class="spacer"></span><button class="btn ghost danger" type="button" data-act="del" data-id="${x.id}">${icon('trash')}Delete</button></div>
      </form></div>`).join('') || `<div class="card">${empty(path === 'knowledge' ? 'book' : 'file', 'Nothing here yet', 'Add your first entry to get started.')}</div>`}`;
    bind({
      new: () => modal(`<h2>Add ${path === 'knowledge' ? 'knowledge' : 'template'}</h2><form data-act="add">${fields.map(([k, l, ta]) => `<label>${l}</label>${ta ? `<textarea name="${k}" required></textarea>` : `<input name="${k}" ${k === fields[0][0] ? 'required' : ''}>`}`).join('')}<button class="btn primary mt" type="submit">Add</button></form>`,
        (el, close) => bind({ add: async (f) => { await api(`/${path}`, { method: 'POST', body: formData(f) }); close(); toast('Added'); ctx.route(); } }, el)),
      save: async (f) => { await api(`/${path}/${f.dataset.id}`, { method: 'PUT', body: formData(f) }); toast('Saved'); },
      del: async (b) => { if (await confirmBox('Delete this entry?', 'This cannot be undone.', { danger: true, ok: 'Delete' })) { await api(`/${path}/${b.dataset.id}`, { method: 'DELETE' }); ctx.route(); } },
      import: async (f) => { toast('Reading page…'); const r = await api('/knowledge/import-url', { method: 'POST', body: formData(f) }); toast(`Imported ${r.chars.toLocaleString()} characters`); ctx.route(); },
    }, ctx.view);
  };
}
export const knowledge = crudView('knowledge', 'Knowledge base',
  'The AI only states facts written here — prices, packages, policies, delivery times, hours, FAQs, links. Replies that mention a price not found here are held for you automatically.',
  [['title', 'Title'], ['content', 'Content', true]],
  `<form class="card mb row nowrap" data-act="import" style="padding:12px">${icon('globe')}<input name="url" type="url" placeholder="https://yourwebsite.com/faq — import a page from your website" style="flex:1" required><button class="btn" type="submit">Import</button></form>`);
export const templates = crudView('templates', 'Templates', 'Canned replies for rules. Personalise with {{first_name}}, {{name}}, {{email}}, {{subject}}.',
  [['name', 'Name'], ['subject', 'Subject (blank = Re: original)'], ['body', 'Body', true]]);

export async function rules(ctx) {
  const [list, meta, tpls, teamRes] = await Promise.all([api('/rules'), api('/rules/meta'), api('/templates'), api('/team')]);
  const team = teamRes.members;
  const describe = (r) => `<b>When</b> ${r.conditions.items.map((c) => `${esc(label(c.field))} ${esc(c.op.replace('_', ' '))} “${esc(c.value)}”`).join(r.conditions.match === 'any' ? ' <b>or</b> ' : ' <b>and</b> ') || 'any email arrives'} <b>then</b> ${r.actions.map((a) => esc(label(a.type)) + (a.to ? ` ${esc(a.to)}` : '') + (a.mode ? ` (${esc(a.mode)})` : '') + (a.hours ? ` ${a.hours}h` : '') + (a.user_id ? ` → ${esc(team.find((u) => u.id === a.user_id)?.name || 'teammate')}` : '')).join(', ')}`;
  const recipes = [
    { name: 'Complaints → careful apology draft', conditions: { match: 'all', items: [{ field: 'category', op: 'equals', value: 'complaint' }] }, actions: [{ type: 'ai_reply', mode: 'draft', instructions: 'Apologize sincerely, acknowledge the problem, and say a manager will reply within 24 hours.' }] },
    { name: 'Ignore receipts from your tools', conditions: { match: 'all', items: [{ field: 'subject', op: 'regex', value: '^(receipt|your invoice|payment received)' }] }, actions: [{ type: 'ignore' }] },
    { name: 'Job applications → thank-you template', conditions: { match: 'all', items: [{ field: 'category', op: 'equals', value: 'job_application' }] }, actions: [{ type: 'template_reply', mode: 'auto' }] },
    { name: 'Sales leads → CRM webhook', conditions: { match: 'all', items: [{ field: 'category', op: 'equals', value: 'sales_inquiry' }] }, actions: [{ type: 'webhook', url: '' }] },
    { name: 'Billing → assign to finance', conditions: { match: 'all', items: [{ field: 'category', op: 'equals', value: 'billing' }] }, actions: [{ type: 'assign' }] },
    { name: 'VIP domain → urgent alert', conditions: { match: 'any', items: [{ field: 'from_domain', op: 'equals', value: 'bigclient.com' }] }, actions: [{ type: 'ai_reply', mode: 'draft', instructions: 'This is a key client. Be extra attentive.' }] },
  ];
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Autopilot & rules</h1><p>No-code automations that run on every new email, top to bottom. The first matching rule wins unless “continue” is ticked.</p></div>
      <div class="actions"><button class="btn primary" data-act="new">${icon('plus')}New rule</button></div></div>
    <div class="card pad-0 mb">${list.map((r, i) => `<div class="row nowrap" style="padding:14px 20px;border-bottom:1px solid var(--border)">
      <div class="col" style="gap:2px"><button class="btn xs ghost icon-only" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up" style="transform:rotate(180deg)">${icon('chevron', 'sm')}</button><button class="btn xs ghost icon-only" data-act="down" data-i="${i}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('chevron', 'sm')}</button></div>
      ${icon('zap')}<div style="flex:1;min-width:0"><b>${esc(r.name)}</b><div class="hint">${describe(r)}${r.stop_processing ? '' : ' · <i>continues to next rules</i>'}</div></div>
      <label class="switch" title="${r.enabled ? 'On' : 'Off'}"><input type="checkbox" data-act="toggle" data-id="${r.id}" ${r.enabled ? 'checked' : ''}><span></span></label>
      <button class="btn sm" data-act="edit" data-id="${r.id}">Edit</button><button class="btn sm ghost danger" data-act="del" data-id="${r.id}" aria-label="Delete">${icon('trash')}</button></div>`).join('') || `<div style="padding:8px">${empty('zap', 'No rules yet', 'Start from a recipe below or create your own.')}</div>`}</div>
    <div class="card"><h3>Recipes</h3><p class="hint">One click to pre-fill a common automation.</p><div class="chips">${recipes.map((x, i) => `<button class="chip" data-act="recipe" data-i="${i}">${esc(x.name)}</button>`).join('')}</div></div>`;

  const condRow = (c = { field: 'category', op: 'equals', value: '' }) => `<div class="row nowrap cond" style="margin-bottom:8px"><select data-k="field">${meta.fields.map((f) => `<option value="${f}" ${c.field === f ? 'selected' : ''}>${esc(label(f))}</option>`).join('')}</select>
    <select data-k="op">${meta.ops.map((o) => `<option value="${o}" ${c.op === o ? 'selected' : ''}>${esc(o.replace('_', ' '))}</option>`).join('')}</select>
    <input data-k="value" value="${esc(c.value)}" placeholder="value" style="flex:2" list="cat-list"><button type="button" class="btn sm ghost icon-only" data-rm aria-label="Remove">${icon('x', 'sm')}</button></div>`;
  const actExtra = (a) => ({
    ai_reply: `<input data-k="instructions" value="${esc(a.instructions || '')}" placeholder="Extra instructions for the AI (optional)" style="flex:2">`,
    forward: `<input data-k="to" type="email" value="${esc(a.to || '')}" placeholder="Forward to (email)" style="flex:2">`,
    webhook: `<input data-k="url" type="url" value="${esc(a.url || '')}" placeholder="https://… (signed POST)" style="flex:2">`,
    template_reply: `<select data-k="template_id" style="flex:2">${tpls.map((x) => `<option value="${x.id}" ${a.template_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('') || '<option value="">Create a template first</option>'}</select>`,
    assign: `<select data-k="user_id" style="flex:2">${team.map((u) => `<option value="${u.id}" ${a.user_id === u.id ? 'selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select>`,
    snooze: `<input data-k="hours" type="number" min="1" value="${esc(a.hours || 24)}" placeholder="Hours" style="flex:1">`,
  }[a.type] || '');
  const actRow = (a = { type: 'ai_reply' }) => `<div class="row nowrap act" style="margin-bottom:8px"><select data-k="type">${meta.actions.map((x) => `<option value="${x}" ${a.type === x ? 'selected' : ''}>${esc(label(x))}</option>`).join('')}</select>
    ${['ai_reply', 'template_reply'].includes(a.type) ? `<select data-k="mode"><option value="">account's mode</option><option value="draft" ${a.mode === 'draft' ? 'selected' : ''}>draft</option><option value="auto" ${a.mode === 'auto' ? 'selected' : ''}>auto-send</option></select>` : ''}
    <span class="x" style="display:contents">${actExtra(a)}</span><button type="button" class="btn sm ghost icon-only" data-rm aria-label="Remove">${icon('x', 'sm')}</button></div>`;

  const openBuilder = (rule) => modal(`<h2>${rule?.id ? 'Edit rule' : 'New rule'}</h2>
    <form data-act="saveRule"><label>Name</label><input name="name" required value="${esc(rule?.name || '')}" placeholder="e.g. Complaints go to manager">
      <div class="row mt"><b>When</b><select name="match" style="width:auto">${[['all', 'all conditions match'], ['any', 'any condition matches']].map(([v, l]) => `<option value="${v}" ${rule?.conditions?.match === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div id="conds" class="mt-s">${(rule?.conditions?.items || []).map(condRow).join('')}</div>
      <button type="button" class="btn sm" data-add="cond">${icon('plus', 'sm')}Add condition</button> <span class="hint">No conditions = every email.</span>
      <datalist id="cat-list">${meta.categories.map((c) => `<option value="${c}">`).join('')}${['urgent', 'high', 'normal', 'low', 'positive', 'neutral', 'negative'].map((c) => `<option value="${c}">`).join('')}</datalist>
      <div class="mt"><b>Then</b></div><div id="acts" class="mt-s">${(rule?.actions?.length ? rule.actions : [{ type: 'ai_reply' }]).map(actRow).join('')}</div>
      <button type="button" class="btn sm" data-add="act">${icon('plus', 'sm')}Add action</button>
      <label class="check mt"><input type="checkbox" name="continue" ${rule && !rule.stop_processing ? 'checked' : ''}> Continue checking the next rules after this one matches</label>
      <label class="check"><input type="checkbox" name="enabled" ${!rule || rule.enabled ? 'checked' : ''}> Rule is on</label>
      <button class="btn primary mt" type="submit">Save rule</button></form>`, (el, close) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-rm]')) e.target.closest('.cond, .act').remove();
      const add = e.target.closest('[data-add]');
      if (add) el.querySelector(add.dataset.add === 'cond' ? '#conds' : '#acts').insertAdjacentHTML('beforeend', add.dataset.add === 'cond' ? condRow() : actRow());
    });
    el.addEventListener('change', (e) => {
      if (e.target.matches('.act [data-k="type"]')) { const row = e.target.closest('.act'); row.outerHTML = actRow({ type: e.target.value }); }
    });
    bind({
      saveRule: async (f) => {
        const read = (row) => Object.fromEntries([...row.querySelectorAll('[data-k]')].map((x) => [x.dataset.k, x.value]).filter(([, v]) => v !== ''));
        const items = [...el.querySelectorAll('.cond')].map(read).filter((c) => c.value);
        const actions = [...el.querySelectorAll('.act')].map(read).map((a) => ({ ...a, ...(a.template_id ? { template_id: Number(a.template_id) } : {}), ...(a.user_id ? { user_id: Number(a.user_id) } : {}), ...(a.hours ? { hours: Number(a.hours) } : {}) }));
        if (!actions.length) throw new Error('Add at least one action');
        const d = formData(f);
        const body = { name: d.name, enabled: d.enabled, stop_processing: !d.continue, position: rule?.position ?? list.length, conditions: { match: d.match, items }, actions };
        await api(rule?.id ? `/rules/${rule.id}` : '/rules', { method: rule?.id ? 'PUT' : 'POST', body });
        close(); toast('Rule saved'); ctx.route();
      },
    }, el);
  }, { wide: true });

  const move = async (i, dir) => {
    const ids = list.map((r) => r.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    await api('/rules/reorder', { method: 'POST', body: { ids } }); ctx.route();
  };
  bind({
    new: () => openBuilder(null),
    edit: (b) => openBuilder(list.find((r) => String(r.id) === b.dataset.id)),
    recipe: (b) => openBuilder({ ...recipes[Number(b.dataset.i)], stop_processing: 1, enabled: 1 }),
    toggle: async (c) => { await api(`/rules/${c.dataset.id}`, { method: 'PATCH', body: { enabled: c.checked } }); toast(c.checked ? 'Rule on' : 'Rule off'); },
    up: (b) => move(Number(b.dataset.i), -1),
    down: (b) => move(Number(b.dataset.i), 1),
    del: async (b) => { if (await confirmBox('Delete this rule?', '', { danger: true, ok: 'Delete' })) { await api(`/rules/${b.dataset.id}`, { method: 'DELETE' }); ctx.route(); } },
  }, ctx.view);
}

export async function integrations(ctx) {
  const canManage = ['owner', 'admin'].includes(ctx.me.role);
  const [s, keys, secret] = await Promise.all([api('/settings'), canManage ? api('/api-keys') : [], canManage ? api('/integrations/webhook-secret') : {}]);
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Alerts & API</h1><p>Get notified instantly and connect your other tools.</p></div></div>
    <div class="split">
      <form class="card" data-act="save"><h3>${icon('bell')} Phone & team alerts</h3>
        <p class="hint">Choose which emails trigger alerts in <a href="#autopilot">Autopilot & safety</a>. Alerts never include the email content.</p>
        <label>Telegram chat ID</label><input name="telegram_chat_id" value="${esc(s.telegram_chat_id)}" placeholder="123456789"><div class="field-hint">Start a chat with our alerts bot, then message @userinfobot to see your ID.</div>
        <label>Slack incoming webhook</label><input name="slack_webhook" value="${esc(s.slack_webhook)}" placeholder="https://hooks.slack.com/services/…">
        <div class="row mt"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="test">${icon('send')}Send test alert</button></div></form>
      <div class="card"><h3>${icon('link')} Webhooks</h3>
        <p class="hint">Add a <b>Webhook</b> action in <a href="#rules">Rules</a> to POST email details (sender, summary, category, lead score, extracted phone/company/budget) to Zapier, Make, n8n or your CRM.</p>
        <p class="hint">Every request is signed: verify <code>X-MailPilot-Signature: v1=HMAC_SHA256(secret, timestamp + "." + body)</code> with header <code>X-MailPilot-Timestamp</code>.</p>
        ${canManage ? `<label>Signing secret</label><div class="row nowrap"><input value="${esc(secret.secret || '')}" readonly id="wh-secret" type="password"><button class="btn icon-only" data-act="reveal" title="Show">${icon('eye')}</button><button class="btn" data-act="rotate">Rotate</button></div>
        <form class="row nowrap mt" data-act="whtest"><input name="url" type="url" placeholder="https://your-endpoint…" required style="flex:1"><button class="btn" type="submit">Send test</button></form>` : ''}</div>
    </div>
    ${canManage ? `<div class="card mt"><div class="card-h"><h3>${icon('key')} API keys</h3><span class="spacer"></span><form class="row nowrap" data-act="key"><input name="name" placeholder="Key name, e.g. Zapier" required style="width:220px"><button class="btn primary" type="submit">Create key</button></form></div>
      <p class="hint">REST API at <code>${esc(location.origin)}/api/v1</code> with <code>Authorization: Bearer mp_live_…</code> — e.g. <code>GET /api/v1/messages</code>, <code>GET /api/v1/contacts</code>, <code>POST /api/v1/messages/:id/reply</code>. Keys can't access billing, account or admin endpoints.</p>
      ${keys.map((k) => `<div class="row nowrap" style="padding:10px 0;border-top:1px solid var(--border)">${icon('key', 'sm')}<b>${esc(k.name)}</b><code>${esc(k.prefix)}…</code><span class="hint">created ${fmtDay(k.created_at)} · last used ${ago(k.last_used_at)}</span><span class="spacer"></span><button class="btn sm ghost danger" data-act="revoke" data-id="${k.id}">Revoke</button></div>`).join('') || '<p class="hint">No keys yet.</p>'}</div>` : ''}`;
  bind({
    save: async (f) => { await api('/settings', { method: 'PUT', body: formData(f) }); toast('Saved'); },
    test: async () => { const r = await api('/integrations/test', { method: 'POST' }); toast(r.ok ? 'Test alert sent' : `Failed: ${r.errors.join(', ')}`, !r.ok); },
    reveal: () => { const i = $('#wh-secret'); i.type = i.type === 'password' ? 'text' : 'password'; },
    rotate: async () => { if (await confirmBox('Rotate signing secret?', 'Your receivers must be updated with the new secret.', { ok: 'Rotate' })) { await api('/integrations/webhook-secret/rotate', { method: 'POST' }); toast('Secret rotated'); ctx.route(); } },
    whtest: async (f) => { await api('/integrations/webhook-test', { method: 'POST', body: formData(f) }); toast('Webhook delivered'); },
    key: async (f) => { const r = await api('/api-keys', { method: 'POST', body: formData(f) }); modal(`<h2>Your new API key</h2><div class="callout warn">${icon('alert')}<div>Copy it now — for your security it won't be shown again.</div></div><pre class="mail-card mail-body" style="word-break:break-all">${esc(r.key)}</pre>`); ctx.route(); },
    revoke: async (b) => { if (await confirmBox('Revoke this key?', 'Apps using it will stop working immediately.', { danger: true, ok: 'Revoke' })) { await api(`/api-keys/${b.dataset.id}`, { method: 'DELETE' }); ctx.route(); } },
  }, ctx.view);
}

void fmtDate;
