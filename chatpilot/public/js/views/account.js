import { $, esc, icon, api, toast, bind, formData, badge, ago, fmtDate, fmtDay, money, num, empty, modal, confirmBox, switchEl, avatar, label } from '../ui.js';

/** Ask for permission and register this browser for Web Push. */
export async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser does not support notifications. On iPhone, add ChatPilot to your home screen first.');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked — allow them in your browser settings.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { key } = await api('/sales/push');
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)) });
  return api('/sales/push', { method: 'POST', body: { subscription: sub.toJSON() } });
}

export async function profile(ctx) {
  const p = await api('/auth/profile');
  const me = ctx.me;
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Settings</h1><p>Your profile, team, plan and security in one place.</p></div></div>
    <div class="split">
      <form class="card" data-act="save"><h3>${icon('users')} Your profile</h3>
        <div class="row nowrap mb">${avatar(p.name, p.email, 'lg')}<div><b>${esc(p.name || p.email)}</b><div class="hint">${esc(p.email)} · ${esc(label(me.role))} of ${esc(me.workspace.name)}</div></div></div>
        <label>Full name</label><input name="name" value="${esc(p.name)}" autocomplete="name">
        <label>Theme</label><select name="ui_theme">${[['system', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}" ${p.ui_theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn primary mt" type="submit">Save profile</button></form>
      <div class="col" style="gap:16px">
        <div class="card" id="push-card"><h3>${icon('bell')} Phone & desktop notifications</h3><p class="hint">Get a notification for a new order or when a customer needs a person — even when ChatPilot is closed. On a phone, first add ChatPilot to your home screen (browser menu → Install app / Add to Home Screen).</p>
          <div class="row"><button class="btn" type="button" data-act="push">${icon('bell')}Turn on on this device</button><button class="btn ghost" type="button" data-act="pushtest">Send a test</button><span class="hint" id="push-st"></span></div></div>
        <form class="card" data-act="email"><h3>${icon('mail')} Sign-in email</h3>
          <p class="hint">Currently <b>${esc(p.email)}</b>${p.email_verified ? ' · verified' : ' · <span style="color:var(--warn)">not verified</span>'}. We'll send a confirmation link to the new address.</p>
          <label>New email</label><input name="email" type="email" required autocomplete="email">
          ${p.has_password ? '<label>Current password</label><input name="password" type="password" required autocomplete="current-password">' : ''}
          <button class="btn mt" type="submit">Send confirmation</button></form>
        <div class="card"><h3>${icon('lock')} Sign-in methods</h3>
          <dl class="kv"><dt>Password</dt><dd>${p.has_password ? 'Set' : 'Not set'} · <a href="#security">change</a></dd>
            <dt>Google</dt><dd>${p.google ? 'Connected' : 'Not connected'}</dd><dt>Microsoft</dt><dd>${p.microsoft ? 'Connected' : 'Not connected'}</dd>
            <dt>Two-factor</dt><dd>${p.totp_enabled ? badge('on', 'ok') : `${badge('off', 'warn')} <a href="#security">Turn on</a>`}</dd>
            <dt>Member since</dt><dd>${fmtDay(p.created_at)}</dd></dl></div>
      </div>
    </div>`;
  const pushSt = (t) => { const e = document.getElementById('push-st'); if (e) e.textContent = t; };
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) pushSt('This browser does not support notifications.');
  else api('/sales/push').then((p) => pushSt(p.devices ? `On for ${p.devices} device${p.devices > 1 ? 's' : ''}` : 'Off')).catch(() => {});
  ctx.view.querySelector('[data-act=push]')?.addEventListener('click', async () => {
    try { pushSt(`On for ${(await enablePush()).devices} device(s)`); toast('Notifications are on'); } catch (e) { toast(e.message, true); }
  });
  ctx.view.querySelector('[data-act=pushtest]')?.addEventListener('click', async () => { const r = await api('/sales/push/test', { method: 'POST' }); toast(r.delivered ? 'Sent — check your notifications' : 'No device is subscribed yet', !r.delivered); });
  bind({
    save: async (f) => {
      const d = formData(f);
      await api('/auth/profile', { method: 'PUT', body: d });
      (await import('../ui.js')).applyTheme(d.ui_theme);
      toast('Profile saved'); await ctx.loadMe();
    },
    email: async (f) => { await api('/auth/change-email', { method: 'POST', body: formData(f) }); toast('Check the new inbox for a confirmation link'); f.reset(); },
  }, ctx.view);
}

export async function team(ctx) {
  const t = await api('/team');
  const manage = ['owner', 'admin'].includes(t.myRole);
  const isOwner = t.myRole === 'owner';
  const used = t.members.length + t.invites.length;
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Settings</h1><p>Answer customers together — everyone sees the same conversations, drafts and orders.</p></div>
      ${manage ? `<div class="actions"><span class="hint">${used} of ${t.seats} seat${t.seats > 1 ? 's' : ''} used</span><button class="btn primary" data-act="invite">${icon('plus')}Invite teammate</button></div>` : ''}</div>
    <div class="card pad-0 mb"><div class="table-wrap"><table><thead><tr><th>Member</th><th>Role</th><th>Last active</th><th>2FA</th><th></th></tr></thead><tbody>
      ${t.members.map((u) => `<tr><td><div class="row nowrap">${avatar(u.name, u.email, 'sm')}<div><b>${esc(u.name || u.email)}</b>${u.id === t.me ? ' <span class="hint">(you)</span>' : ''}<div class="hint">${esc(u.email)}</div></div></div></td>
        <td>${manage && u.role !== 'owner' && u.id !== t.me ? `<select data-act="role" data-id="${u.id}" style="height:32px;width:auto">${['admin', 'member'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${label(r)}</option>`).join('')}</select>` : badge(u.role, u.role === 'owner' ? 'info' : '')}</td>
        <td class="hint">${ago(u.last_login_at)}</td><td>${u.totp_enabled ? badge('on', 'ok') : '<span class="hint">off</span>'}</td>
        <td style="text-align:right">${manage && u.role !== 'owner' && u.id !== t.me ? `<button class="btn sm ghost danger" data-act="del" data-id="${u.id}">Remove</button>` : ''}</td></tr>`).join('')}
      ${t.invites.map((i) => `<tr><td><div class="row nowrap"><span class="avatar sm" style="background:var(--surface-3);color:var(--muted)">${icon('mail', 'sm')}</span><div><b>${esc(i.email)}</b><div class="hint">Invitation sent ${ago(i.created_at)} · expires ${fmtDay(i.expires_at)}</div></div></div></td>
        <td>${badge('invited', 'warn')} <span class="hint">${esc(label(i.role))}</span></td><td></td><td></td>
        <td style="text-align:right"><button class="btn sm ghost" data-act="resend" data-id="${i.id}">Resend</button><button class="btn sm ghost danger" data-act="revoke" data-id="${i.id}">Cancel</button></td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="grid g3">
      <div class="card"><h3>${icon('info')} Roles</h3><dl class="kv"><dt>Owner</dt><dd>Everything, including billing and deleting the workspace</dd><dt>Admin</dt><dd>Channels, assistant training, team and billing</dd><dt>Member</dt><dd>Conversations, orders, products and test chat</dd></dl></div>
      <form class="card" data-act="ws"><h3>${icon('layers')} Agency? Add a client workspace</h3><p class="hint">Each client gets separate pages, products, assistant training and billing. Switch from the sidebar.</p>
        <label>Client name</label><input name="name" required><button class="btn mt" type="submit">${icon('plus')}Create workspace</button></form>
      <div class="card"><h3>${icon('settings')} This workspace</h3>
        ${isOwner ? `<p class="hint">Hand ownership to another member (you become an admin).</p>
          <div class="row nowrap"><select id="new-owner">${t.members.filter((u) => u.id !== t.me).map((u) => `<option value="${u.id}">${esc(u.name || u.email)}</option>`).join('') || '<option value="">Invite someone first</option>'}</select><button class="btn" data-act="transfer">Transfer</button></div>
          <hr style="border:0;border-top:1px solid var(--border);margin:16px 0"><button class="btn danger" data-act="delws">${icon('trash')}Delete workspace</button>`
    : `<p class="hint">Leave "${esc(ctx.me.workspace.name)}". You'll lose access to its conversations.</p><button class="btn danger" data-act="leave">Leave workspace</button>`}</div>
    </div>`;
  bind({
    invite: () => modal(`<h2>Invite a teammate</h2><p class="hint">They'll get an email with a link to join — no need to sign up first.</p>
      <form data-act="send"><label>Email</label><input name="email" type="email" required placeholder="teammate@company.com">
      <label>Role</label><select name="role"><option value="member">Member — answers customers & handles orders</option><option value="admin">Admin — manages setup & billing</option></select>
      <button class="btn primary mt" type="submit">${icon('send')}Send invitation</button></form>`,
    (el, close) => bind({ send: async (f) => { await api('/team/invite', { method: 'POST', body: formData(f) }); close(); toast('Invitation sent'); ctx.route(); } }, el)),
    role: async (s) => { await api(`/team/${s.dataset.id}`, { method: 'PATCH', body: { role: s.value } }); toast('Role updated'); },
    del: async (b) => { if (await confirmBox('Remove teammate?', 'They lose access to this workspace immediately. Chats assigned to them become unassigned.', { danger: true, ok: 'Remove' })) { await api(`/team/${b.dataset.id}`, { method: 'DELETE' }); ctx.route(); } },
    resend: async (b) => { await api(`/team/invites/${b.dataset.id}/resend`, { method: 'POST' }); toast('Invitation re-sent'); ctx.route(); },
    revoke: async (b) => { await api(`/team/invites/${b.dataset.id}`, { method: 'DELETE' }); toast('Invitation cancelled'); ctx.route(); },
    ws: async (f) => { await api('/auth/workspaces', { method: 'POST', body: formData(f) }); location.hash = 'dashboard'; location.reload(); },
    transfer: async () => {
      const id = ctx.view.querySelector('#new-owner').value;
      if (!id) throw new Error('Invite someone first');
      if (await confirmBox('Transfer ownership?', 'The new owner controls billing and can remove you. You become an admin.', { ok: 'Transfer' })) { await api('/team/transfer', { method: 'POST', body: { user_id: Number(id) } }); toast('Ownership transferred'); await ctx.loadMe(); location.reload(); }
    },
    leave: async () => { if (await confirmBox('Leave this workspace?', 'You will need a new invitation to come back.', { danger: true, ok: 'Leave' })) { await api('/team/leave', { method: 'POST' }); location.hash = 'dashboard'; location.reload(); } },
    delws: async () => {
      const name = await confirmBox('Delete this workspace?', 'All its channels are disconnected and every conversation, order, product and setting is destroyed. This cannot be undone.', { danger: true, ok: 'Delete', input: `Type: ${ctx.me.workspace.name}` });
      if (!name) return;
      await api('/workspace', { method: 'DELETE', body: { confirm: name } }); location.hash = 'dashboard'; location.reload();
    },
  }, ctx.view);
}

export async function billing(ctx, params) {
  const [{ plans, stripeEnabled, manualInstructions }, me, payments] = await Promise.all([fetch('/api/billing/plans').then((r) => r.json()), api('/auth/me'), api('/billing/payments')]);
  const ws = me.workspace;
  let interval = params.interval || 'monthly';
  if (params.success) toast('Payment successful — thank you! Your plan updates in a few seconds.');
  const render = () => {
    ctx.view.innerHTML = `
      <div class="page-h"><div><h1>Settings</h1><p>Simple pricing. Cancel anytime. No hidden usage fees — you always see your limits.</p></div></div>
      <div class="card mb"><div class="row"><div><div class="hint">Current plan</div><h2 style="margin:2px 0">${esc(me.effectivePlan.name)} ${badge(ws.subscription_status || (ws.plan === 'trial' ? 'trial' : ''))}</h2>
        <div class="hint">${ws.plan === 'trial' ? `Trial ends ${fmtDate(ws.trial_ends_at)}` : ws.billing_interval === 'once' ? 'Lifetime license — no renewals' : ws.current_period_end ? `Renews ${fmtDay(ws.current_period_end)} (${esc(ws.billing_interval)})` : ''}</div></div>
        <span class="spacer"></span>${ws.billing_interval && !['once', 'manual'].includes(ws.billing_interval) ? `<button class="btn" data-act="portal">${icon('card')}Manage subscription & invoices</button>` : ''}</div></div>
      <div style="text-align:center" class="mb"><div class="seg"><button data-i="monthly" class="${interval === 'monthly' ? 'on' : ''}">Monthly</button><button data-i="yearly" class="${interval === 'yearly' ? 'on' : ''}">Yearly · 2 months free</button></div></div>
      <div class="grid g4">${plans.map((p) => {
        const once = p.priceOnce && !p.priceMonthly;
        const amt = once ? p.priceOnce : interval === 'yearly' ? p.priceYearly : p.priceMonthly;
        const current = ws.plan === p.key && (once || ws.billing_interval === interval);
        return `<div class="card col" style="${p.highlight || params.plan === p.key ? 'border:2px solid var(--primary)' : ''}"><div class="row"><h3 style="margin:0">${esc(p.name)}</h3>${p.highlight ? badge('most popular', 'info') : ''}</div>
          <p class="hint" style="margin:0">${esc(p.description || '')}</p>
          <div><span style="font-size:32px;font-weight:800;letter-spacing:-.02em">${amt == null ? '—' : money(amt)}</span> <span class="hint">${once ? 'one-time' : interval === 'yearly' ? '/ year' : '/ month'}</span></div>
          <ul style="padding-left:18px;margin:0;color:var(--text-2);flex:1"><li>${p.channels} channels (Page / Instagram / WhatsApp)</li><li>${num(p.aiRepliesPerMonth)} AI replies / month</li><li>${num(p.products)} products · ${p.teamMembers} seat${p.teamMembers > 1 ? 's' : ''}</li>${(p.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
          <button class="btn ${p.highlight ? 'primary' : ''} block" data-act="buy" data-plan="${p.key}" ${current || !stripeEnabled ? 'disabled' : ''}>${current ? 'Current plan' : once ? 'Buy lifetime' : 'Choose'}</button></div>`;
      }).join('')}</div>
      ${manualInstructions ? `<div class="card mt"><h3>${icon('dollar')} Pay locally (bKash, bank transfer, PayPal…)</h3><pre class="mail-body">${esc(manualInstructions)}</pre><p class="hint">After paying, <a href="#support">open a support ticket</a> with your transaction ID — we activate your plan right away.</p></div>` : ''}
      ${!stripeEnabled && !manualInstructions ? `<div class="callout info mt">${icon('info')}<div>Online payments are not set up yet. Contact support to upgrade.</div></div>` : ''}
      <div class="card mt"><h3>Payment history</h3>${payments.map((p) => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--border)"><b>${money(p.amount, p.currency)}</b>${badge(p.method)}${badge(p.status)}<span class="hint">${esc(p.plan || '')} ${esc(p.interval || '')}</span><span class="spacer"></span><span class="hint">${fmtDate(p.created_at)}</span></div>`).join('') || '<p class="hint">No payments yet.</p>'}</div>`;
    ctx.view.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { interval = b.dataset.i; render(); }));
    bind({
      buy: async (b) => { const r = await api('/billing/checkout', { method: 'POST', body: { plan: b.dataset.plan, interval } }); location.href = r.url; },
      portal: async () => { const r = await api('/billing/portal', { method: 'POST' }); location.href = r.url; },
    }, ctx.view);
  };
  render();
}

const EVT = { login: 'Signed in', new_device_login: 'Sign-in from a new device', login_failed: 'Failed sign-in attempt', '2fa_failed': 'Wrong 2FA code', login_blocked_locked: 'Sign-in blocked (account locked)',
  password_changed: 'Password changed', password_reset: 'Password reset', password_reset_requested: 'Password reset requested', '2fa_enabled': '2FA turned on', '2fa_disabled': '2FA turned off',
  session_revoked: 'Device signed out', signed_out_everywhere: 'Signed out everywhere', channel_connected: 'Channel connected', channel_removed: 'Channel removed',
  api_key_created: 'API key created', api_key_revoked: 'API key revoked',
  support_access_granted: 'Support access granted', support_access_revoked: 'Support access revoked', support_impersonation: 'Support viewed your account', data_exported: 'Data exported',
  emergency_lockdown: 'Emergency lockdown', webhook_secret_rotated: 'Webhook secret rotated' };
const BAD_EVT = new Set(['login_failed', '2fa_failed', 'login_blocked_locked', 'new_device_login', 'support_impersonation', 'emergency_lockdown', '2fa_disabled']);
const device = (ua) => { const u = String(ua || ''); const b = /Edg\//.test(u) ? 'Edge' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : 'Browser'; const os = /Windows/.test(u) ? 'Windows' : /Mac OS/.test(u) ? 'macOS' : /Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iOS' : /Linux/.test(u) ? 'Linux' : ''; return `${b}${os ? ` on ${os}` : ''}`; };

export async function security(ctx) {
  const isOwner = ctx.me.role === 'owner';
  const [s, sessions, events, aiLog] = await Promise.all([api('/settings'), api('/auth/sessions'), api('/auth/security-events'), api('/ai/log')]);
  const me = ctx.me;
  const support = me.workspace.support_access_until && new Date(me.workspace.support_access_until) > new Date();
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Settings</h1><p>You're in control of who and what can access your shop and your customers' chats.</p></div></div>
    <div class="grid g3 mb">
      <div class="card stat ${me.user.totp_enabled ? 'ok' : 'warn'}"><div class="ic">${icon('lock')}</div><div class="l">Two-factor authentication</div><div class="n" style="font-size:20px">${me.user.totp_enabled ? 'On' : 'Off'}</div><div class="d">${me.user.totp_enabled ? 'Your account is protected' : 'Strongly recommended'}</div></div>
      <div class="card stat ok"><div class="ic">${icon('shieldCheck')}</div><div class="l">Encryption</div><div class="n" style="font-size:20px">AES-256</div><div class="d">Chats & tokens, per-workspace key</div></div>
      <div class="card stat"><div class="ic">${icon('monitor')}</div><div class="l">Active sessions</div><div class="n" style="font-size:20px">${sessions.length}</div><div class="d">Devices signed in</div></div>
    </div>
    <div class="split">
      <div class="card"><h3>${icon('lock')} Two-factor authentication</h3>
        <p class="hint">Require a code from an authenticator app (Google Authenticator, Authy, 1Password, Microsoft Authenticator) when signing in.</p>
        ${me.user.totp_enabled ? `${badge('enabled', 'ok')}<form class="row nowrap mt" data-act="off2fa"><input name="code" placeholder="6-digit code to turn off" inputmode="numeric" autocomplete="one-time-code" style="max-width:220px"><button class="btn danger" type="submit">Turn off</button></form>` : `<button class="btn primary" data-act="setup2fa">${icon('lock')}Set up 2FA</button><div id="tfa"></div>`}</div>
      <form class="card" data-act="pw"><h3>${icon('key')} Password</h3>
        <label>Current password</label><input type="password" name="current" autocomplete="current-password"><div class="field-hint">Leave empty if you signed up with Google or Microsoft.</div>
        <label>New password</label><input type="password" name="next" minlength="10" autocomplete="new-password"><div class="field-hint">At least 10 characters. Changing it signs out your other devices.</div>
        <button class="btn mt" type="submit">Update password</button></form>
      <div class="card" style="grid-column:1/-1"><div class="card-h"><h3>${icon('monitor')} Where you're signed in</h3><span class="spacer"></span><button class="btn sm" data-act="others">Sign out all other devices</button></div>
        ${sessions.map((x) => `<div class="row nowrap" style="padding:10px 0;border-top:1px solid var(--border)">${icon('monitor', 'sm')}<div style="flex:1"><b>${esc(device(x.user_agent))}</b>${x.current ? ' <span class="badge ok">this device</span>' : ''}${x.impersonator_id ? ' <span class="badge warn">support</span>' : ''}<div class="hint">${esc(x.ip || '')} · last active ${ago(x.last_seen_at)} · signed in ${fmtDate(x.created_at)}</div></div>${x.current ? '' : `<button class="btn sm ghost" data-act="revoke" data-id="${esc(x.id)}">Sign out</button>`}</div>`).join('')}</div>
      <form class="card" data-act="privacy"><h3>${icon('shield')} Privacy Shield</h3>
        <div class="setting-row"><div><div class="t">Mask sensitive data before AI</div><div class="d">Card numbers, IBANs, passwords and one-time codes are replaced before any chat reaches the AI.</div></div>${switchEl('privacy_shield', s.privacy_shield)}</div>
        <label>Automatically delete chat messages after</label><select name="retention_days">${[[0, 'Keep (no auto-delete)'], [30, '30 days'], [90, '90 days'], [180, '6 months'], [365, '1 year']].map(([v, l]) => `<option value="${v}" ${Number(s.retention_days) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="callout info mt">${icon('info')}<div>We never sell or share your data, never use your customers' chats to train AI models, and never show ads. AI processing is done by Anthropic under a no-training agreement.</div></div>
        <button class="btn mt" type="submit">Save privacy settings</button></form>
      <div class="card"><h3>${icon('lifebuoy')} Support access</h3>
        <p class="hint">Our support team <b>cannot</b> see your account unless you allow it. Access expires automatically, and every visit is logged below.</p>
        ${support ? `<div class="callout warn">${icon('eye')}<div>Support access is <b>on</b> until ${fmtDate(me.workspace.support_access_until)}.</div></div><button class="btn" data-act="support" data-h="0">Revoke now</button>`
    : `<div class="row">${[[1, '1 hour'], [24, '24 hours'], [72, '3 days']].map(([h, l]) => `<button class="btn sm" data-act="support" data-h="${h}">Allow for ${l}</button>`).join('')}</div>`}</div>
    </div>
    <div class="card mt"><div class="card-h"><h3>${icon('activity')} Security log</h3><span class="hint">Sign-ins, changes and support access to your account</span></div>
      <div class="table-wrap"><table><thead><tr><th>Event</th><th>Where</th><th>When</th></tr></thead><tbody>
      ${events.slice(0, 40).map((e) => `<tr><td>${BAD_EVT.has(e.type) ? icon('alert', 'sm') : icon('checkCircle', 'sm')} ${esc(EVT[e.type] || label(e.type))}${e.detail ? `<div class="hint truncate" style="max-width:420px">${esc(e.detail)}</div>` : ''}</td><td class="hint">${esc(e.ip || '')}<div>${esc(device(e.user_agent))}</div></td><td class="hint nowrap">${fmtDate(e.created_at)}</td></tr>`).join('') || '<tr><td colspan="3" class="hint">Nothing yet.</td></tr>'}</tbody></table></div></div>
    <div class="card mt"><div class="card-h"><h3>${icon('eye')} AI transparency log</h3><span class="hint">Every time a chat was shown to the AI, and why</span></div>
      <div class="table-wrap"><table><thead><tr><th>Purpose</th><th>Conversation</th><th>Masked items</th><th>When</th></tr></thead><tbody>
      ${aiLog.slice(0, 40).map((l) => `<tr><td>${esc(label(l.purpose))}</td><td class="truncate" style="max-width:340px">${l.conversation_id ? `<a href="#chats?id=${l.conversation_id}">${esc(l.customer_name || `#${l.conversation_id}`)}</a>` : '—'}</td><td>${l.redactions || 0}</td><td class="hint nowrap">${fmtDate(l.created_at)}</td></tr>`).join('') || '<tr><td colspan="4" class="hint">The AI hasn\'t read any chat yet.</td></tr>'}</tbody></table></div></div>
    <div class="split mt">
      <div class="card"><h3>${icon('download')} Your data</h3><p class="hint">Download everything we store about you and your workspaces (GDPR / CCPA).</p><a class="btn" href="/api/auth/export">${icon('download')}Export my data</a></div>
      ${isOwner ? `<div class="card" style="border-color:var(--bad)"><h3 style="color:var(--bad)">${icon('alert')} Emergency lockdown</h3><p class="hint">Think someone got in? This instantly wipes every channel token and stops the assistant, deletes API keys, discards pending drafts and signs out everyone but you.</p><button class="btn danger solid" data-act="lockdown">Lock everything down</button></div>` : ''}
      <form class="card" data-act="delete"><h3>Delete account</h3><p class="hint">Permanently deletes your account, owned workspaces, conversations, orders and settings. Encryption keys are destroyed, so nothing can be recovered.</p>
        <label>Type your email</label><input name="confirm" placeholder="${esc(me.user.email)}" autocomplete="off"><label>Password</label><input type="password" name="password" autocomplete="current-password">
        <button class="btn danger mt" type="submit">Delete my account</button></form>
    </div>`;
  bind({
    setup2fa: async () => {
      const r = await api('/auth/2fa/setup', { method: 'POST' });
      $('#tfa').innerHTML = `<div class="row mt" style="align-items:flex-start"><img src="${r.qr}" alt="QR code for 2FA" width="180" height="180" style="border-radius:12px;background:#fff;padding:6px"><div style="flex:1;min-width:200px"><p>1. Scan this with your authenticator app.<br>2. Enter the 6-digit code it shows.</p><p class="hint">Can't scan? Enter this key: <code>${esc(r.secret)}</code></p>
        <form class="row nowrap" data-act="on2fa"><input name="code" placeholder="123456" inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="max-width:140px"><button class="btn primary" type="submit">Verify & turn on</button></form></div></div>`;
      bind({ on2fa: async (f) => { await api('/auth/2fa/enable', { method: 'POST', body: formData(f) }); toast('2FA is on — your other devices were signed out'); await ctx.loadMe(); ctx.route(); } }, $('#tfa'));
    },
    off2fa: async (f) => { await api('/auth/2fa/disable', { method: 'POST', body: formData(f) }); toast('2FA turned off'); await ctx.loadMe(); ctx.route(); },
    pw: async (f) => { await api('/auth/change-password', { method: 'POST', body: formData(f) }); toast('Password updated — other devices signed out'); f.reset(); ctx.route(); },
    others: async () => { await api('/auth/sessions/revoke-others', { method: 'POST' }); toast('Signed out all other devices'); ctx.route(); },
    revoke: async (b) => { await api(`/auth/sessions/${b.dataset.id}/revoke`, { method: 'POST' }); toast('Device signed out'); ctx.route(); },
    privacy: async (f) => { const d = formData(f); d.privacy_shield = d.privacy_shield ? 1 : 0; await api('/settings', { method: 'PUT', body: d }); toast('Saved'); },
    support: async (b) => { await api('/auth/support-access', { method: 'POST', body: { hours: Number(b.dataset.h) } }); toast(Number(b.dataset.h) ? 'Support access granted' : 'Support access revoked'); await ctx.loadMe(); ctx.route(); },
    lockdown: async () => {
      if (!(await confirmBox('Lock everything down?', 'Every channel stops and needs a fresh access token afterwards. Everyone except you is signed out.', { danger: true, ok: 'Lock down now' }))) return;
      const r = await api('/auth/lockdown', { method: 'POST' }); toast(`Locked down — ${r.channels} channel(s) stopped`); ctx.route();
    },
    delete: async (f) => {
      if (!(await confirmBox('Delete your account forever?', 'This cannot be undone.', { danger: true, ok: 'Delete forever' }))) return;
      await api('/auth/delete-account', { method: 'POST', body: formData(f) }); location.href = '/';
    },
  }, ctx.view);
}

export async function referrals(ctx) {
  const r = await api('/referrals');
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Settings</h1><p>Earn ${r.commissionPct}% of every payment from customers you refer.</p></div></div>
    <div class="card mb"><h3>Your referral link</h3><div class="row nowrap"><input id="ref" value="${esc(r.link)}" readonly style="flex:1"><button class="btn primary" data-act="copy">${icon('copy')}Copy</button></div></div>
    <div class="grid g4">
      <div class="card stat"><div class="ic">${icon('users')}</div><div class="l">Sign-ups</div><div class="n">${r.signups}</div></div>
      <div class="card stat"><div class="ic">${icon('card')}</div><div class="l">Paid conversions</div><div class="n">${r.payments}</div></div>
      <div class="card stat ok"><div class="ic">${icon('dollar')}</div><div class="l">Earned</div><div class="n">${money(r.total)}</div></div>
      <div class="card stat"><div class="ic">${icon('clock')}</div><div class="l">Pending payout</div><div class="n">${money(r.total - r.paid)}</div></div></div>`;
  bind({ copy: async () => { await navigator.clipboard?.writeText(r.link).catch(() => {}); $('#ref').select(); toast('Link copied'); } }, ctx.view);
}

export async function support(ctx) {
  const list = await api('/tickets');
  const faq = [
    ['Why didn\'t a customer get an automatic reply?', 'Open the chat: the AI draft shows why it was held — e.g. a price not in your catalog, low confidence, a complaint or refund request, or the channel is in Draft mode.'],
    ['Meta says my token expired', 'Page tokens can expire when you change your Facebook password or remove the app. Generate a new token and paste it in Channels → Replace token. For WhatsApp, use a permanent System-user token.'],
    ['Customers can message but nothing arrives', 'Check the webhook in your Meta app: the Callback URL and Verify token must match the channel card, and the page must be subscribed to "messages". Until App Review is approved only app admins/testers can reach it.'],
    ['Can the assistant give discounts?', 'Only if you write the discount in your knowledge base. Anything else is held for you — the assistant never invents prices.'],
    ['Why can\'t I reply to an old chat?', 'Meta only allows replies within 24 hours of the customer\'s last message. When they write again you can answer.'],
    ['Can your team read my chats?', 'No. Support can only view your account if you grant temporary access in Security & privacy, and every visit is logged.'],
  ];
  ctx.view.innerHTML = `
    <div class="page-h"><div><h1>Help & support</h1><p>We usually reply within a few hours.</p></div></div>
    <div class="split">
      <form class="card" data-act="new"><h3>Contact support</h3>
        <label>Subject</label><input name="subject" required>
        <label>Priority</label><select name="priority"><option value="normal">Normal</option><option value="high">High — something is broken</option><option value="low">Low — a question</option></select>
        <label>Message</label><textarea name="body" required placeholder="Never include passwords — we will never ask for them."></textarea>
        <button class="btn primary mt" type="submit">${icon('send')}Send</button></form>
      <div class="card"><h3>Quick answers</h3>${faq.map(([q, a]) => `<details style="border-bottom:1px solid var(--border);padding:10px 0"><summary style="cursor:pointer;font-weight:600">${esc(q)}</summary><p class="hint mt-s">${esc(a)}</p></details>`).join('')}</div>
    </div>
    <div class="card mt"><h3>Your tickets</h3>${list.map((t) => `<a class="row nowrap" style="padding:10px 0;border-top:1px solid var(--border);color:inherit;text-decoration:none" href="#ticket?id=${t.id}">${icon('lifebuoy', 'sm')}<b style="flex:1">#${t.id} ${esc(t.subject)}</b>${badge(t.status)}<span class="hint">${ago(t.updated_at)}</span></a>`).join('') || '<p class="hint">No tickets yet.</p>'}</div>`;
  bind({ new: async (f) => { await api('/tickets', { method: 'POST', body: formData(f) }); toast('Sent — we will reply by email'); ctx.route(); } }, ctx.view);
}

export async function ticket(ctx, { id }) {
  const t = await api(`/tickets/${id}`);
  ctx.view.innerHTML = `<a href="#support" class="hint">${icon('chevronLeft', 'sm')} Support</a>
    <div class="page-h mt-s"><div><h1>#${t.id} ${esc(t.subject)}</h1></div><div class="actions">${badge(t.status)}</div></div>
    <div class="thread">${t.messages.map((m) => `<div class="msg ${m.is_staff ? 'staff' : ''}"><div class="hint">${m.is_staff ? 'Support team' : 'You'} · ${fmtDate(m.created_at)}</div><pre class="mail-body mt-s">${esc(m.body)}</pre></div>`).join('')}</div>
    <form class="card" data-act="reply"><textarea name="body" required placeholder="Write a reply…"></textarea><button class="btn primary mt" type="submit">${icon('send')}Send</button></form>`;
  bind({ reply: async (f) => { await api(`/tickets/${id}/reply`, { method: 'POST', body: formData(f) }); ctx.route(); } }, ctx.view);
}

void modal;
