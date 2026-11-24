import { $, $$, esc, icon, fmtDate, fmtDay, money, badge, formData, toast, api, bind, bars, modal, csvDownload, confirmBox, applyTheme } from './ui.js';

const view = $('#view');
const views = {};
let plans = [];
const planOpts = (cur, withEmpty) => `${withEmpty ? '<option value="">—</option>' : ''}${plans.map((p) => `<option value="${p.key}" ${p.key === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
const isoLocal = (d) => (d ? new Date(/Z$|T/.test(d) ? d : `${d.replace(' ', 'T')}Z`).toISOString().slice(0, 16) : '');
const fromLocal = (v) => (v ? new Date(v).toISOString() : '');

// =============== Overview ===============
views.overview = async () => {
  const o = await api('/admin/overview');
  const days = (rows, key) => rows.map((r) => ({ label: r.day, short: r.day.slice(5), value: r[key] }));
  view.innerHTML = `
    <h1>Overview</h1>
    ${!o.aiEnabled ? '<div class="banner">⚠ AI is not configured. Add your Anthropic API key in <a href="#settings">Settings → AI</a>.</div>' : ''}
    <div class="grid g4">
      <div class="card stat"><div class="n">${money(o.mrr)}</div><div class="l">MRR (ARR ${money(o.arr)})</div></div>
      <div class="card stat"><div class="n">${money(o.revenue30)}</div><div class="l">Revenue last 30 days</div></div>
      <div class="card stat"><div class="n">${money(o.revenueAll)}</div><div class="l">Revenue all-time</div></div>
      <div class="card stat"><div class="n">${o.paying}</div><div class="l">Paying customers</div></div>
      <div class="card stat"><div class="n">${o.users}</div><div class="l">Users (+${o.newUsers7} this week)</div></div>
      <div class="card stat"><div class="n">${o.trials}</div><div class="l">Active trials</div></div>
      <div class="card stat"><div class="n">${o.channels}</div><div class="l">Channels (${o.channelErrors} with errors)</div></div>
      <div class="card stat"><div class="n">${o.messages24h}</div><div class="l">Customer messages (24h)</div></div>
      <div class="card stat"><div class="n">${money(o.aiCost)}</div><div class="l">AI cost this month (est.)</div></div>
      <div class="card stat"><div class="n">${o.openTickets}</div><div class="l">Open tickets</div></div>
      <div class="card stat"><div class="n">${o.churned}</div><div class="l">Canceled subscriptions</div></div>
      <div class="card stat"><div class="n">${o.usage?.messages_sent || 0}</div><div class="l">Messages sent this month</div></div>
    </div>
    <div class="split" style="margin-top:16px">
      <div class="card"><h3>Sign-ups (30 days)</h3>${bars(days(o.signups, 'n'))}</div>
      <div class="card"><h3>Revenue (30 days)</h3>${bars(days(o.revenue, 'v'), { fmt: money })}</div>
      <div class="card"><h3>Customer messages (14 days)</h3>${bars(days(o.volume, 'n'))}</div>
      <div class="card"><h3>Customers by plan</h3>${o.byPlan.map((p) => `<div class="row" style="margin:6px 0">${badge(p.plan)}<span class="spacer"></span><b>${p.n}</b></div>`).join('')}</div>
      <div class="card"><h3>Newest users</h3>${o.recentUsers.map((u) => `<div class="row" style="margin:5px 0"><a href="#user?id=${u.id}">${esc(u.email)}</a><span class="spacer"></span><span class="hint">${fmtDay(u.created_at)}</span></div>`).join('') || '<p class="hint">None yet</p>'}</div>
      <div class="card"><h3>Latest payments</h3>${o.recentPayments.map((p) => `<div class="row" style="margin:5px 0"><b>${money(p.amount, p.currency)}</b> ${badge(p.method)} <span class="hint">${esc(p.workspace_name || '')}</span><span class="spacer"></span><span class="hint">${fmtDay(p.created_at)}</span></div>`).join('') || '<p class="hint">None yet</p>'}</div>
    </div>`;
};

// =============== Users ===============
views.users = async (params) => {
  const list = await api(`/admin/users?${new URLSearchParams(params)}`);
  view.innerHTML = `
    <h1>Users</h1>
    <form class="row card" data-act="filter" style="margin-bottom:16px">
      <input name="q" placeholder="Search email or name" value="${esc(params.q || '')}" style="flex:2">
      <select name="filter" style="flex:1">${[['', 'All users'], ['admins', 'Admins'], ['suspended', 'Suspended'], ['unverified', 'Unverified email'], ['2fa', '2FA enabled']].map(([v, l]) => `<option value="${v}" ${params.filter === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn">Search</button>
    </form>
    <div class="card table-wrap"><table>
      <thead><tr><th>User</th><th>Sign-in</th><th>Status</th><th>Workspaces</th><th>Joined</th><th>Last login</th></tr></thead>
      <tbody>${list.map((u) => `<tr class="click" data-href="#user?id=${u.id}">
        <td><b>${esc(u.name || '—')}</b><div class="hint">${esc(u.email)}</div>${u.referred_by_email ? `<div class="hint">ref: ${esc(u.referred_by_email)}</div>` : ''}</td>
        <td>${u.google ? badge('google', 'ok') : ''} ${u.microsoft ? badge('microsoft', 'ok') : ''} ${u.totp_enabled ? badge('2FA', 'ok') : ''}</td>
        <td>${u.is_admin ? badge('admin', 'active') : ''} ${u.suspended ? badge('suspended') : ''} ${u.email_verified ? '' : badge('unverified', 'warning')}</td>
        <td>${u.workspaces}</td><td class="hint">${fmtDay(u.created_at)}</td><td class="hint">${fmtDate(u.last_login_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="hint">No users</td></tr>'}</tbody>
    </table></div>`;
  bind({ filter: (f) => { location.hash = `users?${new URLSearchParams(Object.entries(formData(f)).filter(([, v]) => v))}`; } }, view);
  rowLinks();
};

views.user = async ({ id }) => {
  const u = await api(`/admin/users/${id}`);
  view.innerHTML = `
    <a href="#users">← Users</a>
    <h1 style="margin-top:10px">${esc(u.name || u.email)}</h1>
    <div class="split">
      <div class="card">
        <h3>Profile</h3>
        <form data-act="save">
          <label>Name</label><input name="name" value="${esc(u.name)}">
          <label>Email</label><input name="email" value="${esc(u.email)}">
          <label class="check"><input type="checkbox" name="email_verified" ${u.email_verified ? 'checked' : ''}> Email verified</label>
          <label class="check"><input type="checkbox" name="is_admin" ${u.is_admin ? 'checked' : ''}> Platform admin</label>
          <label class="check"><input type="checkbox" name="suspended" ${u.suspended ? 'checked' : ''}> Suspended (can't log in)</label>
          <button class="btn primary">Save</button>
        </form>
        <dl class="kv" style="margin-top:16px">
          <dt>Joined</dt><dd>${fmtDate(u.created_at)}</dd><dt>Last login</dt><dd>${fmtDate(u.last_login_at)} ${u.last_login_ip ? `(${esc(u.last_login_ip)})` : ''}</dd>
          <dt>Sign-in methods</dt><dd>Password ${u.google ? '· Google' : ''} ${u.microsoft ? '· Microsoft' : ''}</dd>
          <dt>2FA</dt><dd>${u.totp_enabled ? 'Enabled' : 'Off'}</dd><dt>Referral code</dt><dd>${esc(u.referral_code)}</dd><dt>Language</dt><dd>${esc(u.locale)}</dd>
        </dl>
      </div>
      <div class="card">
        <h3>Actions</h3>
        <div class="row">
          <button class="btn" data-act="impersonate">Log in as this user</button>
          <button class="btn" data-act="signout">Sign out everywhere</button>
          <button class="btn" data-act="unlock">Unlock account</button>
          <button class="btn" data-act="resetpw">Reset password</button>
          ${u.totp_enabled ? '<button class="btn" data-act="no2fa">Disable 2FA</button>' : ''}
          <button class="btn danger" data-act="del">Delete user</button>
        </div>
        <form data-act="mail" style="margin-top:16px">
          <h3>Send an email</h3>
          <input name="subject" placeholder="Subject" required><textarea name="body" placeholder="Message" required></textarea>
          <button class="btn" style="margin-top:8px">Send</button>
        </form>
      </div>
      <div class="card"><h3>Workspaces</h3>${u.workspaces.map((w) => `<div class="row" style="margin:5px 0"><a href="#workspace?id=${w.id}">${esc(w.name)}</a> ${badge(w.role)} ${badge(w.plan)}</div>`).join('') || '<p class="hint">None</p>'}</div>
      <div class="card"><h3>Support tickets</h3>${u.tickets.map((t) => `<div class="row" style="margin:5px 0"><a href="#ticket?id=${t.id}">#${t.id} ${esc(t.subject)}</a>${badge(t.status)}</div>`).join('') || '<p class="hint">None</p>'}
        <h3 style="margin-top:14px">Referred users (${u.referrals.length})</h3>${u.referrals.map((x) => `<div class="hint">${esc(x.email)} · ${fmtDay(x.created_at)}</div>`).join('') || '<p class="hint">None</p>'}</div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Audit trail</h3>${auditTable(u.audit)}</div>`;
  bind({
    save: async (f) => { await api(`/admin/users/${id}`, { method: 'PUT', body: formData(f) }); toast('Saved'); },
    impersonate: async () => {
      const reason = await confirmBox('Log in as this customer?', 'Only possible if the customer granted support access. The session lasts 1 hour, and your reason is shown in the customer\'s security log.', { ok: 'Start support session', input: 'Reason, e.g. ticket #12 — channel error' });
      if (!reason) return;
      await api(`/admin/users/${id}/impersonate`, { method: 'POST', body: { reason } }); location.href = '/app';
    },
    signout: async () => { await api(`/admin/users/${id}/sign-out`, { method: 'POST' }); toast('Signed out of all devices'); },
    unlock: async () => { await api(`/admin/users/${id}/unlock`, { method: 'POST' }); toast('Account unlocked'); route(); },
    resetpw: async () => { if (!(await confirmBox('Generate a temporary password?', 'The user is signed out everywhere.', { ok: 'Generate' }))) return; const r = await api(`/admin/users/${id}/reset-password`, { method: 'POST' }); modal(`<h3>Temporary password</h3><p>Share this securely with the user:</p><pre class="mail">${esc(r.tempPassword)}</pre>`); },
    no2fa: async () => { await api(`/admin/users/${id}/disable-2fa`, { method: 'POST' }); toast('2FA disabled'); route(); },
    del: async () => { if ((await confirmBox('Delete this user?', 'Their account and owned workspaces are deleted permanently.', { danger: true, ok: 'Delete', input: 'Type DELETE' })) === 'DELETE') { await api(`/admin/users/${id}`, { method: 'DELETE' }); location.hash = 'users'; } },
    mail: async (f) => { await api(`/admin/users/${id}/email`, { method: 'POST', body: formData(f) }); toast('Email sent'); f.reset(); },
  }, view);
};

// =============== Workspaces ===============
views.workspaces = async (params) => {
  const list = await api(`/admin/workspaces?${new URLSearchParams(params)}`);
  view.innerHTML = `
    <h1>Workspaces / customers</h1>
    <form class="row card" data-act="filter" style="margin-bottom:16px">
      <input name="q" placeholder="Search name or owner email" value="${esc(params.q || '')}" style="flex:2">
      <select name="plan" style="flex:1">${planOpts(params.plan, true)}</select>
      <select name="status" style="flex:1">${[['', 'Any status'], ['suspended', 'Suspended'], ['trial_expired', 'Trial expired'], ['past_due', 'Payment past due']].map(([v, l]) => `<option value="${v}" ${params.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn">Filter</button>
    </form>
    <div class="card table-wrap"><table>
      <thead><tr><th>Workspace</th><th>Plan</th><th>Billing</th><th>Channels</th><th>Chats</th><th>Members</th><th>Created</th></tr></thead>
      <tbody>${list.map((w) => `<tr class="click" data-href="#workspace?id=${w.id}">
        <td><b>${esc(w.name)}</b><div class="hint">${esc(w.owner_email)}</div></td>
        <td>${badge(w.plan)} ${w.effective === 'expired' ? badge('expired') : ''} ${w.suspended ? badge('suspended') : ''}</td>
        <td>${badge(w.subscription_status)} <div class="hint">${esc(w.billing_interval || '')} ${w.plan === 'trial' ? `ends ${fmtDay(w.trial_ends_at)}` : w.current_period_end ? `→ ${fmtDay(w.current_period_end)}` : ''}</div></td>
        <td>${w.channel_count}</td><td>${w.conversation_count}</td><td>${w.members}</td><td class="hint">${fmtDay(w.created_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="hint">None</td></tr>'}</tbody>
    </table></div>`;
  bind({ filter: (f) => { location.hash = `workspaces?${new URLSearchParams(Object.entries(formData(f)).filter(([, v]) => v))}`; } }, view);
  rowLinks();
};

views.workspace = async ({ id }) => {
  const d = await api(`/admin/workspaces/${id}`);
  const w = d.workspace;
  view.innerHTML = `
    <a href="#workspaces">← Workspaces</a>
    <h1 style="margin-top:10px">${esc(w.name)} ${badge(w.effective.key)}</h1>
    <div class="grid g4" style="margin-bottom:16px">
      <div class="card stat"><div class="n">${d.stats.conversations || 0}</div><div class="l">Conversations</div></div>
      <div class="card stat"><div class="n">${d.stats.orders || 0}</div><div class="l">Orders</div></div>
      <div class="card stat"><div class="n">${d.stats.products || 0}</div><div class="l">Products</div></div>
      <div class="card stat"><div class="n">${d.thisMonth?.ai_replies || 0} / ${w.effective.aiRepliesPerMonth}</div><div class="l">AI replies this month</div></div>
    </div>
    <div class="split">
      <div class="card">
        <h3>Subscription & limits</h3>
        <form data-act="save">
          <label>Name</label><input name="name" value="${esc(w.name)}">
          <div class="grid g2">
            <div><label>Plan</label><select name="plan">${planOpts(w.plan)}</select></div>
            <div><label>Subscription status</label><select name="subscription_status">${['', 'active', 'trialing', 'past_due', 'canceled', 'unpaid'].map((s) => `<option ${w.subscription_status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
            <div><label>Billing interval</label><select name="billing_interval">${['', 'monthly', 'yearly', 'once', 'manual'].map((s) => `<option ${w.billing_interval === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
            <div><label>Trial ends</label><input type="datetime-local" name="trial_ends_at" value="${isoLocal(w.trial_ends_at)}"></div>
            <div><label>Period ends / renews</label><input type="datetime-local" name="current_period_end" value="${isoLocal(w.current_period_end)}"></div>
          </div>
          <label>Custom limits override (JSON)</label>
          <input name="limits_override_json" value="${esc(w.limits_override_json || '')}" placeholder='{"channels": 20, "aiRepliesPerMonth": 10000}'>
          <label>Internal notes</label><textarea name="admin_notes" style="min-height:70px">${esc(w.admin_notes || '')}</textarea>
          <label class="check"><input type="checkbox" name="suspended" ${w.suspended ? 'checked' : ''}> Suspended (automation stops)</label>
          <button class="btn primary">Save</button>
        </form>
        <dl class="kv" style="margin-top:16px"><dt>Stripe customer</dt><dd>${esc(w.stripe_customer_id || '—')}</dd><dt>Stripe subscription</dt><dd>${esc(w.stripe_subscription_id || '—')}</dd>
          <dt>Effective limits</dt><dd>${w.effective.channels} channels · ${w.effective.aiRepliesPerMonth} AI replies · ${w.effective.products} products · ${w.effective.teamMembers} seats</dd></dl>
      </div>
      <div class="card">
        <h3>Quick actions</h3>
        <form class="row" data-act="extend"><input name="days" type="number" value="7" style="width:90px"><button class="btn">Extend trial (days)</button></form>
        <form class="row" data-act="grant" style="margin-top:10px"><select name="plan" style="flex:1">${planOpts('pro')}</select><input name="days" type="number" placeholder="days (blank = no end)" style="width:150px"><button class="btn">Grant plan</button></form>
        <div class="row" style="margin-top:10px">
          <button class="btn" data-act="reset">Reset this month's usage</button>
          ${w.stripe_subscription_id ? '<button class="btn danger" data-act="cancel">Cancel Stripe subscription</button>' : ''}
          <button class="btn danger" data-act="del">Delete workspace</button>
        </div>
        <h3 style="margin-top:18px">Members</h3>${d.members.map((m) => `<div class="row" style="margin:5px 0"><a href="#user?id=${m.id}">${esc(m.email)}</a>${badge(m.role)}</div>`).join('')}
        <h3 style="margin-top:18px">Channels</h3>${d.channels.map((c) => `<div style="margin:6px 0"><b>${esc(c.name || c.external_id)}</b> ${badge(c.platform, 'info')} ${badge(c.mode)} ${c.last_error ? badge('error') : ''}<div class="hint">${esc(c.last_error || `last message ${fmtDate(c.last_event_at)}`)}</div></div>`).join('') || '<p class="hint">None</p>'}
      </div>
      <div class="card"><h3>Payments</h3>${paymentsTable(d.payments)}</div>
      <div class="card"><h3>Usage history</h3><table><thead><tr><th>Month</th><th>AI calls</th><th>AI replies</th><th>Sent</th><th>Tokens in/out</th></tr></thead><tbody>
        ${d.usage.map((u) => `<tr><td>${u.period}</td><td>${u.ai_calls}</td><td>${u.ai_replies}</td><td>${u.messages_sent}</td><td class="hint">${u.input_tokens.toLocaleString()} / ${u.output_tokens.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Recent activity</h3>${activityList(d.activity)}</div>`;
  bind({
    save: async (f) => { const b = formData(f); b.trial_ends_at = fromLocal(b.trial_ends_at); b.current_period_end = fromLocal(b.current_period_end); await api(`/admin/workspaces/${id}`, { method: 'PUT', body: b }); toast('Saved'); route(); },
    extend: async (f) => { await api(`/admin/workspaces/${id}/extend-trial`, { method: 'POST', body: formData(f) }); toast('Trial extended'); route(); },
    grant: async (f) => { await api(`/admin/workspaces/${id}/grant`, { method: 'POST', body: formData(f) }); toast('Plan granted'); route(); },
    reset: async () => { await api(`/admin/workspaces/${id}/reset-usage`, { method: 'POST' }); toast('Usage reset'); route(); },
    cancel: async () => { if (await confirmBox('Cancel the Stripe subscription?', 'It is cancelled immediately.', { danger: true, ok: 'Cancel subscription' })) { await api(`/admin/workspaces/${id}/cancel-stripe`, { method: 'POST' }); toast('Canceled'); route(); } },
    del: async () => { if ((await confirmBox('Delete workspace?', 'All its data is destroyed.', { danger: true, ok: 'Delete', input: 'Type DELETE' })) === 'DELETE') { await api(`/admin/workspaces/${id}`, { method: 'DELETE' }); location.hash = 'workspaces'; } },
  }, view);
};

// =============== Payments ===============
function paymentsTable(rows, editable) {
  return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Status</th><th>Customer</th><th>Plan</th><th>Reference</th><th>Commission</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>
    ${rows.map((p) => `<tr><td class="hint">${fmtDate(p.created_at)}</td><td><b>${money(p.amount, p.currency)}</b></td><td>${badge(p.method)}</td><td>${badge(p.status)}</td>
      <td>${p.workspace_id ? `<a href="#workspace?id=${p.workspace_id}">${esc(p.workspace_name || `#${p.workspace_id}`)}</a>` : '—'}<div class="hint">${esc(p.owner_email || '')}</div></td>
      <td>${esc(p.plan || '')} <span class="hint">${esc(p.interval || '')}</span></td><td class="hint">${esc(p.reference || '')}${p.note ? `<div>${esc(p.note)}</div>` : ''}</td>
      <td>${p.commission ? `${money(p.commission)} ${p.commission_paid ? badge('paid') : badge('owed', 'warning')}` : '—'}</td>
      ${editable ? `<td><select data-act="pstatus" data-id="${p.id}">${['paid', 'refunded', 'failed', 'pending'].map((s) => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>` : ''}</tr>`).join('') || '<tr><td colspan="9" class="hint">No payments</td></tr>'}
  </tbody></table></div>`;
}
views.payments = async (params) => {
  const d = await api(`/admin/payments?${new URLSearchParams(params)}`);
  const wss = await api('/admin/workspaces');
  view.innerHTML = `
    <h1>Payments & revenue</h1>
    <div class="grid g4" style="margin-bottom:16px">
      <div class="card stat"><div class="n">${money(d.totals.paid)}</div><div class="l">Collected</div></div>
      <div class="card stat"><div class="n">${money(d.totals.refunded)}</div><div class="l">Refunded</div></div>
      ${d.byMethod.map((m) => `<div class="card stat"><div class="n">${money(m.v)}</div><div class="l">${esc(m.method)} (${m.n})</div></div>`).join('')}
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3>Record a manual payment (bKash, Nagad, bank transfer, PayPal, cash…)</h3>
      <form data-act="add">
        <div class="grid g4">
          <div><label>Customer workspace</label><select name="workspace_id"><option value="">—</option>${wss.map((w) => `<option value="${w.id}">${esc(w.name)} (${esc(w.owner_email)})</option>`).join('')}</select></div>
          <div><label>Amount</label><input name="amount" type="number" step="0.01" required></div>
          <div><label>Currency</label><input name="currency" value="usd"></div>
          <div><label>Method</label><select name="method">${['bkash', 'nagad', 'rocket', 'bank', 'paypal', 'wise', 'payoneer', 'crypto', 'cash', 'other'].map((m) => `<option>${m}</option>`).join('')}</select></div>
          <div><label>Plan</label><select name="plan">${planOpts('', true)}</select></div>
          <div><label>Interval</label><select name="interval"><option>monthly</option><option>yearly</option><option>once</option></select></div>
          <div><label>Transaction ID / reference</label><input name="reference"></div>
          <div><label>Note</label><input name="note"></div>
        </div>
        <label class="check"><input type="checkbox" name="activate" checked> Activate / extend the plan for this customer now</label>
        <button class="btn primary">Record payment</button>
      </form>
    </div>
    <form class="row card" data-act="filter" style="margin-bottom:16px">
      <input name="q" placeholder="Customer, email or reference" value="${esc(params.q || '')}" style="flex:2">
      <select name="method" style="flex:1"><option value="">All methods</option>${['stripe', 'bkash', 'nagad', 'bank', 'paypal', 'other'].map((m) => `<option ${params.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <select name="status" style="flex:1"><option value="">Any status</option>${['paid', 'refunded', 'failed', 'pending'].map((m) => `<option ${params.status === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <button class="btn">Filter</button><button class="btn" type="button" data-act="csv">Export CSV</button>
    </form>
    <div class="card">${paymentsTable(d.rows, true)}</div>`;
  bind({
    add: async (f) => { await api('/admin/payments', { method: 'POST', body: formData(f) }); toast('Payment recorded'); route(); },
    filter: (f) => { location.hash = `payments?${new URLSearchParams(Object.entries(formData(f)).filter(([, v]) => v))}`; },
    csv: () => csvDownload('/admin/payments.csv'),
    pstatus: async (s) => { await api(`/admin/payments/${s.dataset.id}`, { method: 'PUT', body: { status: s.value } }); toast('Updated'); },
  }, view);
};

// =============== Plans ===============
views.plans = async () => {
  const list = await api('/admin/plans');
  view.innerHTML = `
    <h1>Plans & pricing</h1>
    <p class="hint">Changes apply instantly to the pricing page and to limits. For Stripe checkout, create matching Prices in Stripe and paste their IDs (price_…).</p>
    ${list.map((p) => `
      <div class="card" style="margin-bottom:14px">
        <form data-act="save" data-key="${p.key}">
          <div class="row"><h3 style="margin:0">${esc(p.name)} <span class="hint">(${p.key})</span></h3><span class="spacer"></span><span class="hint">${p.workspaces} customer(s)</span></div>
          <div class="grid g4">
            <div><label>Name</label><input name="name" value="${esc(p.name)}"></div>
            <div><label>Tagline</label><input name="description" value="${esc(p.description || '')}"></div>
            <div><label>Sort order</label><input name="sort" type="number" value="${p.sort}"></div>
            <div><label>Channels</label><input name="channels" type="number" value="${p.channels}"></div>
            <div><label>AI replies / month</label><input name="ai_replies" type="number" value="${p.aiRepliesPerMonth}"></div>
            <div><label>AI actions / month <span class="hint">(cost cap)</span></label><input name="ai_calls" type="number" value="${p.aiCalls ?? ''}"></div>
            <div><label>Products</label><input name="products" type="number" value="${p.products}"></div>
            <div><label>Team seats</label><input name="team_members" type="number" value="${p.teamMembers}"></div>
            <div><label>Price / month ($)</label><input name="price_monthly" type="number" step="0.01" value="${p.priceMonthly ?? ''}"></div>
            <div><label>Price / year ($)</label><input name="price_yearly" type="number" step="0.01" value="${p.priceYearly ?? ''}"></div>
            <div><label>One-time price ($)</label><input name="price_once" type="number" step="0.01" value="${p.priceOnce ?? ''}"></div>
            <div><label>Stripe price ID (monthly)</label><input name="stripe_price_monthly" value="${esc(p.stripe.monthly || '')}"></div>
            <div><label>Stripe price ID (yearly)</label><input name="stripe_price_yearly" value="${esc(p.stripe.yearly || '')}"></div>
            <div><label>Stripe price ID (one-time)</label><input name="stripe_price_once" value="${esc(p.stripe.once || '')}"></div>
          </div>
          <label>Extra feature bullets (one per line, shown on pricing page)</label><textarea name="features" style="min-height:60px">${esc((p.features || []).join('\n'))}</textarea>
          <div class="row">
            <label class="check"><input type="checkbox" name="public" ${p.public ? 'checked' : ''}> Show on pricing page</label>
            <label class="check"><input type="checkbox" name="highlight" ${p.highlight ? 'checked' : ''}> Highlight ("Most popular")</label>
            <label class="check"><input type="checkbox" name="auto_send" ${p.autoSend ? 'checked' : ''}> Auto-pilot allowed</label>
            <span class="spacer"></span><button class="btn primary">Save</button>${p.key !== 'trial' ? `<button class="btn danger" type="button" data-act="del" data-key="${p.key}">Delete</button>` : ''}
          </div>
        </form>
      </div>`).join('')}
    <form class="card row" data-act="add"><input name="key" placeholder="new plan key, e.g. agency" required style="flex:1"><input name="name" placeholder="Display name" style="flex:1"><button class="btn primary">Add plan</button></form>`;
  bind({
    save: async (f) => { await api(`/admin/plans/${f.dataset.key}`, { method: 'PUT', body: formData(f) }); toast('Plan saved'); plans = await api('/admin/plans'); },
    del: async (b) => { if (await confirmBox('Delete this plan?', '', { danger: true, ok: 'Delete' })) { await api(`/admin/plans/${b.dataset.key}`, { method: 'DELETE' }); route(); } },
    add: async (f) => { await api('/admin/plans', { method: 'POST', body: formData(f) }); plans = await api('/admin/plans'); route(); },
  }, view);
};

// =============== Affiliates ===============
views.referrals = async () => {
  const list = await api('/admin/referrals');
  view.innerHTML = `
    <h1>Affiliates & referrals</h1>
    <p class="hint">Every user gets a referral link (Dashboard → Refer & earn). Commission % is set in <a href="#settings">Settings → Payments</a>.</p>
    <div class="card table-wrap"><table><thead><tr><th>Affiliate</th><th>Code</th><th>Sign-ups</th><th>Earned</th><th>Paid out</th><th>Owed</th><th></th></tr></thead><tbody>
      ${list.map((a) => `<tr><td><a href="#user?id=${a.id}">${esc(a.email)}</a></td><td>${esc(a.referral_code)}</td><td>${a.signups}</td><td>${money(a.earned)}</td><td>${money(a.paid)}</td>
        <td><b>${money(a.earned - a.paid)}</b></td><td>${a.earned - a.paid > 0 ? `<button class="btn sm" data-act="paid" data-id="${a.id}">Mark paid</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="hint">No referrals yet</td></tr>'}
    </tbody></table></div>`;
  bind({ paid: async (b) => { await api(`/admin/referrals/${b.dataset.id}/mark-paid`, { method: 'POST' }); route(); } }, view);
};

// =============== Channels ===============
views.channels = async (params) => {
  const list = await api(`/admin/channels?${new URLSearchParams(params)}`);
  view.innerHTML = `
    <h1>Channel monitor</h1>
    <form class="row card" data-act="filter" style="margin-bottom:16px">
      <input name="q" placeholder="Page / number name, ID or workspace" value="${esc(params.q || '')}" style="flex:2">
      <label class="check"><input type="checkbox" name="errors" ${params.errors ? 'checked' : ''}> Only with errors</label>
      <button class="btn">Filter</button>
    </form>
    <div class="card table-wrap"><table><thead><tr><th>Channel</th><th>Workspace</th><th>Mode</th><th>Chats</th><th>Last message</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><b>${esc(c.name || c.external_id)}</b><div class="hint">${esc(c.platform)} · ${esc(c.external_id)}</div></td><td><a href="#workspace?id=${c.workspace_id}">${esc(c.workspace_name)}</a></td>
        <td>${badge(c.mode)}</td><td>${c.conversations}</td><td class="hint">${fmtDate(c.last_event_at)}</td>
        <td>${c.last_error ? `${badge('error')}<div class="hint">${esc(c.last_error).slice(0, 140)}</div>` : c.enabled ? badge('active') : badge('paused')}</td>
        <td><button class="btn sm" data-act="toggle" data-id="${c.id}" data-en="${c.enabled}">${c.enabled ? 'Disable' : 'Enable'}</button></td></tr>`).join('') || '<tr><td colspan="7" class="hint">None</td></tr>'}
    </tbody></table></div>`;
  bind({
    filter: (f) => { const d = formData(f); location.hash = `channels?${new URLSearchParams(Object.entries({ q: d.q, errors: d.errors ? '1' : '' }).filter(([, v]) => v))}`; },
    toggle: async (b) => { await api(`/admin/channels/${b.dataset.id}`, { method: 'PUT', body: { enabled: b.dataset.en !== '1' } }); route(); },
  }, view);
};

// =============== AI usage ===============
views.ai = async (params) => {
  const d = await api(`/admin/ai-usage?${new URLSearchParams(params)}`);
  view.innerHTML = `
    <h1>AI usage & margins</h1>
    <p class="hint">Costs are estimates from token counts × prices set in <a href="#settings">Settings → AI</a>. Compare with plan revenue to keep margins healthy.</p>
    <div class="card" style="margin-bottom:16px"><h3>Monthly</h3>${bars(d.months.slice().reverse().map((m) => ({ label: m.period, short: m.period, value: m.cost })), { fmt: money })}
      <table style="margin-top:12px"><thead><tr><th>Month</th><th>AI calls</th><th>AI replies</th><th>Messages sent</th><th>Tokens in</th><th>Tokens out</th><th>Est. cost</th></tr></thead><tbody>
      ${d.months.map((m) => `<tr><td><a href="#ai?period=${m.period}">${m.period}</a></td><td>${m.ai_calls}</td><td>${m.ai_replies}</td><td>${m.messages_sent}</td><td>${m.input_tokens.toLocaleString()}</td><td>${m.output_tokens.toLocaleString()}</td><td><b>${money(m.cost)}</b></td></tr>`).join('')}</tbody></table></div>
    <div class="card table-wrap"><h3>Top workspaces — ${esc(d.period)}</h3><table><thead><tr><th>Workspace</th><th>Plan</th><th>AI replies / limit</th><th>Calls</th><th>Tokens in/out</th><th>Est. cost</th><th>Revenue / mo</th><th>Margin</th></tr></thead><tbody>
      ${d.rows.map((x) => `<tr><td><a href="#workspace?id=${x.workspace_id}">${esc(x.name)}</a></td><td>${badge(x.plan)}</td><td>${x.ai_replies} / ${x.plan_limit ?? '—'}</td><td>${x.ai_calls}</td><td class="hint">${x.input_tokens.toLocaleString()} / ${x.output_tokens.toLocaleString()}</td><td><b>${money(x.cost)}</b></td><td>${x.revenue ? money(x.revenue) : '—'}</td><td>${x.margin == null ? '<span class="hint">n/a</span>' : badge(`${x.margin}%`, x.margin < 30 ? 'bad' : x.margin < 60 ? 'warn' : 'ok')}</td></tr>`).join('') || '<tr><td colspan="8" class="hint">No usage</td></tr>'}
    </tbody></table></div>`;
};

// =============== Tickets ===============
views.tickets = async (params) => {
  const status = params.status || 'open';
  const list = await api(`/admin/tickets?status=${status}`);
  view.innerHTML = `
    <h1>Support tickets</h1>
    <div class="tabs">${['open', 'answered', 'closed', 'all'].map((s) => `<button data-s="${s}" class="${s === status ? 'on' : ''}">${s}</button>`).join('')}</div>
    <div class="card table-wrap"><table><thead><tr><th>#</th><th>Subject</th><th>Customer</th><th>Priority</th><th>Status</th><th>Messages</th><th>Updated</th></tr></thead><tbody>
      ${list.map((t) => `<tr class="click" data-href="#ticket?id=${t.id}"><td>${t.id}</td><td><b>${esc(t.subject)}</b></td><td>${esc(t.email)}</td><td>${badge(t.priority)}</td><td>${badge(t.status)}</td><td>${t.replies}</td><td class="hint">${fmtDate(t.updated_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="hint">No tickets</td></tr>'}
    </tbody></table></div>`;
  view.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { location.hash = `tickets?status=${b.dataset.s}`; }));
  rowLinks();
};
views.ticket = async ({ id }) => {
  const t = await api(`/admin/tickets/${id}`);
  view.innerHTML = `
    <a href="#tickets">← Tickets</a>
    <h1 style="margin-top:10px">#${t.id} ${esc(t.subject)}</h1>
    <div class="row" style="margin-bottom:12px">${badge(t.status)} ${badge(t.priority)} <span class="hint">from <a href="#user?id=${t.user_id}">${esc(t.email)}</a> · ${fmtDate(t.created_at)}</span><span class="spacer"></span>
      <select data-act="prio">${['low', 'normal', 'high', 'urgent'].map((p) => `<option ${t.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <button class="btn sm" data-act="close">${t.status === 'closed' ? 'Reopen' : 'Close'}</button></div>
    <div class="thread">${t.messages.map((m) => `<div class="msg ${m.is_staff ? 'staff' : ''}"><div class="hint">${m.is_staff ? 'Support' : esc(m.author_email || 'Customer')} · ${fmtDate(m.created_at)}</div><pre class="mail" style="background:none;padding:6px 0 0">${esc(m.body)}</pre></div>`).join('')}</div>
    <form class="card" data-act="reply"><label>Reply (also emailed to the customer)</label><textarea name="body" required></textarea>
      <div class="row" style="margin-top:10px"><button class="btn primary">Send reply</button><label class="check"><input type="checkbox" name="close"> Close ticket after replying</label></div></form>`;
  bind({
    reply: async (f) => { await api(`/admin/tickets/${id}/reply`, { method: 'POST', body: formData(f) }); toast('Reply sent'); route(); },
    close: async () => { await api(`/admin/tickets/${id}`, { method: 'PUT', body: { status: t.status === 'closed' ? 'open' : 'closed' } }); route(); },
    prio: async (s) => { await api(`/admin/tickets/${id}`, { method: 'PUT', body: { priority: s.value } }); toast('Priority updated'); },
  }, view);
};

// =============== Announcements & broadcast ===============
views.announce = async () => {
  const list = await api('/admin/announcements');
  view.innerHTML = `
    <h1>Announcements & email</h1>
    <div class="split">
      <form class="card" data-act="add">
        <h3>In-app banner</h3><p class="hint">Shown at the top of every customer's dashboard.</p>
        <textarea name="message" placeholder="e.g. New: AI now learns your writing style! Try it in Settings." required></textarea>
        <div class="grid g2"><div><label>Style</label><select name="level"><option>info</option><option>success</option><option>warning</option></select></div>
          <div><label>Ends (optional)</label><input type="datetime-local" name="ends_at"></div></div>
        <button class="btn primary" style="margin-top:10px">Publish</button>
      </form>
      <form class="card" data-act="broadcast">
        <h3>Email broadcast</h3><p class="hint">Product updates, offers, maintenance notices. Uses your system SMTP.</p>
        <label>Audience</label><select name="audience"><option value="all">All users</option><option value="paying">Paying customers</option><option value="trial">Trial users</option></select>
        <label>Subject</label><input name="subject" required><label>Message</label><textarea name="body" required></textarea>
        <button class="btn primary" style="margin-top:10px">Send broadcast</button>
      </form>
    </div>
    <div class="card" style="margin-top:16px"><h3>Banners</h3>${list.map((a) => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div class="ann ${esc(a.level)}" style="flex:1;margin:0">${esc(a.message)}</div>${a.active ? badge('active') : badge('off')}<span class="hint">${a.ends_at ? `until ${fmtDate(a.ends_at)}` : ''}</span>
      <button class="btn sm" data-act="toggle" data-id="${a.id}" data-on="${a.active}">${a.active ? 'Hide' : 'Show'}</button><button class="btn sm danger" data-act="del" data-id="${a.id}">Delete</button></div>`).join('') || '<p class="hint">None</p>'}</div>`;
  bind({
    add: async (f) => { const d = formData(f); d.ends_at = d.ends_at ? fromLocal(d.ends_at).replace('T', ' ').slice(0, 19) : ''; await api('/admin/announcements', { method: 'POST', body: d }); route(); },
    broadcast: async (f) => { if (!(await confirmBox('Send this email now?', 'It goes to every user in the audience.', { ok: 'Send' }))) return; const r = await api('/admin/broadcast', { method: 'POST', body: formData(f) }); toast(`Sending to ${r.queued} users`); f.reset(); },
    toggle: async (b) => { await api(`/admin/announcements/${b.dataset.id}`, { method: 'PUT', body: { active: b.dataset.on !== '1' } }); route(); },
    del: async (b) => { await api(`/admin/announcements/${b.dataset.id}`, { method: 'DELETE' }); route(); },
  }, view);
};

// =============== Settings ===============
const GROUPS = { general: 'General', security: 'Security', ai: 'AI', oauth: 'Google & Microsoft sign-in', meta: 'Meta (Facebook / Instagram / WhatsApp)', email: 'System email (SMTP)', payments: 'Payments', notifications: 'Notifications' };
views.settings = async (params) => {
  const list = await api('/admin/settings');
  const group = params.g || 'general';
  const field = (s) => {
    if (s.type === 'bool') return `<label class="check"><input type="checkbox" name="${s.key}" ${['1', 'true'].includes(String(s.value)) ? 'checked' : ''}> ${esc(s.label)}</label>`;
    const input = s.type === 'textarea' ? `<textarea name="${s.key}">${esc(s.value)}</textarea>`
      : `<input name="${s.key}" type="${s.secret ? 'password' : s.type === 'number' ? 'number' : 'text'}" step="any" value="${esc(s.value)}" placeholder="${s.secret ? (s.isSet ? '•••••••• (saved — leave blank to keep)' : 'not set') : ''}" autocomplete="off">`;
    return `<label>${esc(s.label)} ${s.secret && s.isSet ? `${badge('saved', 'ok')} <a href="#" data-act="clear" data-key="${s.key}" class="hint">clear</a>` : ''}</label>${input}${s.help ? `<p class="hint">${esc(s.help)}</p>` : ''}`;
  };
  const help = {
    oauth: `<div class="banner"><b>Redirect URIs</b> to register:<br>Google: <code>${esc(location.origin)}/api/oauth/google/callback</code><br>Microsoft: <code>${esc(location.origin)}/api/oauth/microsoft/callback</code><br>Sign-in uses basic scopes only (no review needed).</div>`,
    meta: `<div class="banner"><b>Your Meta app</b> (developers.facebook.com → Business app with Messenger, Instagram and WhatsApp products):<br>
      Valid OAuth redirect URI: <code>${esc(location.origin)}/api/oauth/meta/callback</code><br>
      Webhook callback URL: <code>${esc(location.origin)}/api/social/webhook</code> (verify token = the value below; subscribe to <i>messages</i>, <i>message_echoes</i>)<br>
      Data deletion callback: <code>${esc(location.origin)}/api/meta/data-deletion</code> · Deauthorize callback: <code>${esc(location.origin)}/api/meta/deauthorize</code><br>
      Privacy policy: <code>${esc(location.origin)}/privacy</code> · Terms: <code>${esc(location.origin)}/terms</code><br>
      Until App Review is approved, only people with a role on the app can connect. See <code>docs/META_APP_REVIEW_BN.md</code>.</div>`,
    payments: `<div class="banner">Stripe webhook URL: <code>${esc(location.origin)}/api/billing/webhook</code> — events: checkout.session.completed, customer.subscription.*, invoice.paid, invoice.payment_failed, charge.refunded.</div>`,
    notifications: '<div class="banner">Create a Telegram bot with @BotFather and paste its token here. Customers then add their own chat ID in Settings → Alerts to get instant alerts on their phone.</div>',
  };
  view.innerHTML = `
    <h1>Settings</h1>
    <div class="tabs">${Object.entries(GROUPS).map(([k, l]) => `<button data-g="${k}" class="${k === group ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${help[group] || ''}
    <form class="card" data-act="save">${list.filter((s) => s.group === group).map(field).join('')}
      <div class="row" style="margin-top:14px"><button class="btn primary">Save settings</button>${group === 'email' ? '<button class="btn" type="button" data-act="test">Send test email to me</button>' : ''}</div></form>`;
  view.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { location.hash = `settings?g=${b.dataset.g}`; }));
  bind({
    save: async (f) => {
      const d = formData(f);
      for (const [k, v] of Object.entries(d)) if (typeof v === 'boolean') d[k] = v ? '1' : '0';
      await api('/admin/settings', { method: 'PUT', body: d }); toast('Settings saved'); route();
    },
    clear: async (a) => { if (await confirmBox('Remove this saved secret?', '', { danger: true, ok: 'Remove' })) { await api('/admin/settings/clear', { method: 'POST', body: { key: a.dataset.key } }); route(); } },
    test: async () => { const r = await api('/admin/settings/test-email', { method: 'POST', body: {} }); toast(r.logged ? 'SMTP not configured — email was only logged to the server console' : 'Test email sent', r.logged); },
  }, view);
};

// =============== Health ===============
views.health = async () => {
  const h = await api('/admin/health');
  const check = (ok, label, fix) => `<div class="row" style="margin:6px 0">${ok ? badge('ok') : badge('missing', 'warning')} <span>${label}</span>${ok ? '' : `<span class="hint">— ${fix}</span>`}</div>`;
  view.innerHTML = `
    <h1>System health & backup</h1>
    <div class="grid g4">
      <div class="card stat"><div class="n">${Math.floor(h.uptimeSec / 3600)}h ${Math.floor((h.uptimeSec % 3600) / 60)}m</div><div class="l">Uptime</div></div>
      <div class="card stat"><div class="n">${h.memoryMb} MB</div><div class="l">Memory</div></div>
      <div class="card stat"><div class="n">${h.dbSizeMb} MB</div><div class="l">Database size</div></div>
      <div class="card stat"><div class="n">${h.queue.pendingDrafts}</div><div class="l">AI drafts awaiting approval</div></div>
      <div class="card stat"><div class="n">${h.queue.needsHuman}</div><div class="l">Chats waiting for a human</div></div>
      <div class="card stat"><div class="n">${h.queue.failedSends24h}</div><div class="l">Send failures (24h)</div></div>
    </div>
    <div class="split" style="margin-top:16px">
      <div class="card"><h3>Launch readiness</h3>
        ${check(h.checks.productionMode, 'NODE_ENV=production', 'set in .env')}
        ${check(h.checks.https, 'Public URL uses HTTPS', 'Settings → General → Public URL')}
        ${check(h.checks.ai, 'Anthropic API key', 'Settings → AI')}
        ${check(h.checks.stripe, 'Stripe payments', 'Settings → Payments (or use manual payments)')}
        ${check(h.checks.smtp, 'System email (password resets, digests)', 'Settings → System email')}
        ${check(h.checks.google, 'Google sign-in / Gmail connect', 'Settings → Google & Microsoft')}
        ${check(h.checks.microsoft, 'Microsoft sign-in / Outlook connect', 'Settings → Google & Microsoft')}
      </div>
      <div class="card"><h3>Background worker</h3>
        <dl class="kv"><dt>Started</dt><dd>${fmtDate(h.worker.startedAt)}</dd><dt>Last cycle</dt><dd>${fmtDate(h.worker.lastTickAt)} (${h.worker.lastTickMs} ms)</dd>
        <dt>Cycles</dt><dd>${h.worker.ticks}</dd><dt>Last error</dt><dd>${esc(h.worker.lastError || 'none')}</dd>
        <dt>Version</dt><dd>${esc(h.version)} · Node ${esc(h.node)}</dd><dt>Load</dt><dd>${h.loadAvg.map((x) => x.toFixed(2)).join(' / ')}</dd></dl>
        <h3 style="margin-top:16px">Backup</h3><p class="hint">Download a consistent snapshot of the whole database. Keep it with your ENCRYPTION_KEY — both are needed to restore.</p>
        <a class="btn" href="/api/admin/backup">⬇ Download database backup</a></div>
    </div>`;
};

// =============== Logs ===============
function auditTable(rows) {
  return `<div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td class="hint">${fmtDate(a.created_at)}</td><td>${esc(a.actor_email)}</td><td>${badge(a.action, 'info')}</td><td>${esc(a.target || '')}</td><td class="hint">${esc((a.detail || '').slice(0, 160))}</td></tr>`).join('') || '<tr><td colspan="5" class="hint">Nothing yet</td></tr>'}</tbody></table></div>`;
}
function activityList(rows) {
  return rows.map((a) => `<div class="hint" style="margin:4px 0">${fmtDate(a.created_at)} · ${a.workspace_name ? `<a href="#workspace?id=${a.workspace_id}">${esc(a.workspace_name)}</a> · ` : ''}<b>${esc(a.type.replace(/_/g, ' '))}</b> ${esc((a.detail || '').slice(0, 160))}</div>`).join('') || '<p class="hint">Nothing yet</p>';
}
views.audit = async (params) => {
  const rows = await api(`/admin/audit?${new URLSearchParams(params)}`);
  view.innerHTML = `<h1>Audit log</h1><p class="hint">Every admin action, impersonation and account deletion.</p>
    <form class="row card" data-act="filter" style="margin-bottom:16px"><input name="q" value="${esc(params.q || '')}" placeholder="Search action, admin or target" style="flex:1"><button class="btn">Search</button></form>
    <div class="card">${auditTable(rows)}</div>`;
  bind({ filter: (f) => { location.hash = `audit?q=${encodeURIComponent(formData(f).q)}`; } }, view);
};
views.activity = async (params) => {
  const rows = await api(`/admin/activity?${new URLSearchParams(params)}`);
  const types = ['', 'chat_auto_reply', 'chat_approved_sent', 'chat_draft', 'chat_handoff', 'order_created', 'channel_added', 'send_failed', 'error', 'subscription_updated', 'payment_failed'];
  view.innerHTML = `<h1>Activity log</h1><p class="hint">What the automation is doing across all customers.</p>
    <div class="card" style="margin-bottom:16px"><select data-act="type">${types.map((t) => `<option value="${t}" ${params.type === t ? 'selected' : ''}>${t ? t.replace(/_/g, ' ') : 'All events'}</option>`).join('')}</select></div>
    <div class="card">${activityList(rows)}</div>`;
  bind({ type: (s) => { location.hash = `activity?type=${s.value}`; } }, view);
};

// =============== Security center ===============
views.security = async () => {
  const d = await api('/admin/security');
  view.innerHTML = `
    <div class="page-h"><div><h1>Security center</h1><p>Attacks, risky accounts and encryption status across the platform.</p></div>
      <div class="actions"><button class="btn" data-act="reenc">${icon('refresh')}Re-encrypt with current key</button></div></div>
    <div class="grid g4">
      <div class="card stat ${d.failedLogins24h > 50 ? 'bad' : ''}"><div class="ic">${icon('alert')}</div><div class="l">Failed sign-ins (24h)</div><div class="n">${d.failedLogins24h}</div></div>
      <div class="card stat"><div class="ic">${icon('lock')}</div><div class="l">Locked accounts</div><div class="n">${d.lockedAccounts.length}</div></div>
      <div class="card stat"><div class="ic">${icon('monitor')}</div><div class="l">Active sessions</div><div class="n">${d.activeSessions}</div></div>
      <div class="card stat ${d.adminsWithout2fa.length ? 'bad' : 'ok'}"><div class="ic">${icon('shieldCheck')}</div><div class="l">Admins without 2FA</div><div class="n">${d.adminsWithout2fa.length}</div></div>
      <div class="card stat ${d.unencrypted.messages + d.unencrypted.channels ? 'warn' : 'ok'}"><div class="ic">${icon('key')}</div><div class="l">Unencrypted rows</div><div class="n">${d.unencrypted.messages + d.unencrypted.channels}</div><div class="d">Master key version ${d.keyVersion}</div></div>
    </div>
    ${d.adminsWithout2fa.length ? `<div class="callout bad mt">${icon('alert')}<div>Admins without 2FA: ${d.adminsWithout2fa.map((u) => esc(u.email)).join(', ')}</div></div>` : ''}
    ${d.lockedAccounts.length ? `<div class="card mt"><h3>Locked accounts</h3>${d.lockedAccounts.map((u) => `<div class="row" style="padding:6px 0"><a href="#user?id=${u.id}">${esc(u.email)}</a><span class="hint">${u.failed_logins} failed · until ${fmtDate(u.locked_until)}</span></div>`).join('')}</div>` : ''}
    <div class="card mt pad-0"><div class="table-wrap"><table><thead><tr><th>Event</th><th>User</th><th>IP</th><th>Detail</th><th>When</th></tr></thead><tbody>
      ${d.events.map((e) => `<tr><td>${badge(e.type, /fail|lock|imperson|lockdown/.test(e.type) ? 'warn' : 'info')}</td><td>${e.user_id ? `<a href="#user?id=${e.user_id}">${esc(e.email || e.user_id)}</a>` : '—'}</td><td class="hint">${esc(e.ip || '')}</td><td class="hint truncate" style="max-width:280px">${esc(e.detail || '')}</td><td class="hint nowrap">${fmtDate(e.created_at)}</td></tr>`).join('')}</tbody></table></div></div>`;
  bind({ reenc: async () => { const r = await api('/admin/security/reencrypt', { method: 'POST' }); toast(`Done: ${Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ')}`); route(); } }, view);
};

// =============== Router ===============
function rowLinks() { view.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a,button,select,input')) location.hash = tr.dataset.href.slice(1); })); }

async function route() {
  const [name, qs] = (location.hash.slice(1) || 'overview').split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const parent = { user: 'users', workspace: 'workspaces', ticket: 'tickets' }[name] || name;
  document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${parent}`));
  $('#side').classList.remove('open');
  view.innerHTML = '<p class="hint">Loading…</p>';
  try { await (views[name] || views.overview)(params); } catch (e) { view.innerHTML = `<div class="card err-text">${esc(e.message)}</div>`; }
  api('/admin/tickets?status=open').then((l) => { $('#open-tickets').textContent = l.length; $('#open-tickets').hidden = !l.length; }).catch(() => {});
}

(async () => {
  try {
    applyTheme();
    $('#brand-mark').innerHTML = icon('logo');
    $('#menu-btn').innerHTML = icon('menu');
    $$('.nav-link[data-i]').forEach((a) => a.insertAdjacentHTML('afterbegin', icon(a.dataset.i)));
    const me = await api('/auth/me');
    $('#admin-who').textContent = me.user.email;
    if (!me.user.is_admin) { view.innerHTML = '<div class="card"><h2>Admins only</h2><p><a href="/app">Back to the app</a></p></div>'; return; }
    try { plans = await api('/admin/plans'); } catch (e) {
      view.innerHTML = `<div class="callout warn">${icon('lock')}<div>${esc(e.message)} ${e.code === 'admin_2fa_required' ? '<a href="/app#security">Turn on 2FA</a>' : ''}</div></div>`;
      return;
    }
  } catch { return; }
  $('#menu-btn').addEventListener('click', () => $('#side').classList.toggle('open'));
  window.addEventListener('hashchange', route);
  route();
})();
