import { Router } from 'express';
import { one, all, run, getUsage, audit, securityEvent } from '../db.js';
import { requireRole, sha256 } from '../auth.js';
import { randomToken } from '../crypto.js';
import { effectivePlan } from '../plans.js';
import { aiEnabled } from '../services/ai.js';
import { sendTelegram, sendSlack, notifyAdmins } from '../services/notify.js';
import { getNum, appUrl } from '../settings.js';
import salesRoutes from './sales.js';

const r = Router();
r.use('/sales', salesRoutes); // the sales assistant: channels, products, conversations, orders, test chat
const manage = requireRole('owner', 'admin');
const wsId = (req) => req.workspace.id;
const int = (v) => Number.parseInt(v, 10);
const str = (v, max = 1000) => String(v ?? '').slice(0, max);

// ---------- Home dashboard ----------
r.get('/dashboard', (req, res) => {
  const id = wsId(req);
  const n = (sql, ...p) => one(sql, ...p).n || 0;
  const plan = effectivePlan(req.workspace);
  res.json({
    plan, usage: getUsage(id), aiEnabled: aiEnabled(), emailVerified: Boolean(req.user.email_verified),
    setup: {
      business: Boolean(req.workspace.business_description),
      products: n('SELECT COUNT(*) AS n FROM products WHERE workspace_id = ? AND active = 1', id),
      knowledge: n('SELECT COUNT(*) AS n FROM knowledge WHERE workspace_id = ?', id),
      channels: n('SELECT COUNT(*) AS n FROM channels WHERE workspace_id = ?', id),
      live: n(`SELECT COUNT(*) AS n FROM channels WHERE workspace_id = ? AND last_event_at IS NOT NULL`, id),
    },
    today: one(`SELECT COUNT(*) AS conversations, SUM(stage = 'ordered') AS ordered FROM conversations WHERE workspace_id = ? AND last_inbound_at > datetime('now','-1 day')`, id),
    needsHuman: n(`SELECT COUNT(*) AS n FROM conversations WHERE workspace_id = ? AND status = 'needs_human'`, id),
    drafts: n(`SELECT COUNT(*) AS n FROM chat_messages WHERE workspace_id = ? AND status = 'draft'`, id),
    orders30: one(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS revenue, MAX(currency) AS currency FROM orders WHERE workspace_id = ? AND status != 'cancelled' AND created_at > datetime('now','-30 days')`, id),
    aiSent30: n(`SELECT COUNT(*) AS n FROM chat_messages WHERE workspace_id = ? AND source = 'ai' AND status = 'sent' AND created_at > datetime('now','-30 days')`, id),
    daily: all(`SELECT substr(c.created_at,1,10) AS day, SUM(c.direction = 'in') AS received, SUM(c.direction = 'out' AND c.status = 'sent') AS answered
      FROM chat_messages c WHERE c.workspace_id = ? AND c.created_at > datetime('now','-14 days') GROUP BY day ORDER BY day`, id),
    byPlatform: all(`SELECT ch.platform, COUNT(*) AS n FROM conversations v JOIN channels ch ON ch.id = v.channel_id
      WHERE v.workspace_id = ? AND v.last_inbound_at > datetime('now','-30 days') GROUP BY ch.platform`, id),
    hotLeads: all(`SELECT v.id, v.customer_name, v.customer_id, v.intent, v.lead_score, v.stage, ch.platform FROM conversations v JOIN channels ch ON ch.id = v.channel_id
      WHERE v.workspace_id = ? AND v.lead_score >= 70 AND v.stage NOT IN ('ordered', 'lost') AND v.last_inbound_at > datetime('now','-3 days') ORDER BY v.lead_score DESC LIMIT 6`, id),
    activity: all('SELECT * FROM activity WHERE workspace_id = ? ORDER BY id DESC LIMIT 12', id),
  });
});

// ---------- Knowledge base (delivery charges, payment, returns, FAQs) ----------
for (const [path, table, fields] of [['knowledge', 'knowledge', ['title', 'content']]]) {
  r.get(`/${path}`, (req, res) => res.json(all(`SELECT * FROM ${table} WHERE workspace_id = ? ORDER BY id`, wsId(req))));
  r.post(`/${path}`, manage, (req, res) => {
    if (!req.body[fields[0]] || !req.body[fields.at(-1)]) return res.status(400).json({ error: `${fields[0]} and ${fields.at(-1)} are required` });
    const x = run(`INSERT INTO ${table} (workspace_id, ${fields.join(',')}) VALUES (?, ${fields.map(() => '?').join(',')})`,
      wsId(req), ...fields.map((f) => String(req.body[f] ?? '')));
    res.json({ id: Number(x.lastInsertRowid) });
  });
  r.put(`/${path}/:id`, manage, (req, res) => {
    run(`UPDATE ${table} SET ${fields.map((f) => `${f}=?`).join(',')} WHERE id=? AND workspace_id=?`,
      ...fields.map((f) => String(req.body[f] ?? '')), int(req.params.id), wsId(req));
    res.json({ ok: true });
  });
  r.delete(`/${path}/:id`, manage, (req, res) => {
    run(`DELETE FROM ${table} WHERE id=? AND workspace_id=?`, int(req.params.id), wsId(req));
    res.json({ ok: true });
  });
}


// ---------- Assistant & workspace settings ----------
const SETTINGS = ['name', 'business_name', 'business_description', 'reply_tone', 'default_language', 'auto_send_min_confidence',
  'sensitive_topics', 'never_say', 'allowed_link_domains', 'privacy_shield', 'retention_days', 'timezone', 'telegram_chat_id', 'slack_webhook'];
r.get('/settings', (req, res) => {
  const ws = one('SELECT * FROM workspaces WHERE id = ?', wsId(req));
  res.json(Object.fromEntries(SETTINGS.map((k) => [k, ws[k]])));
});
r.put('/settings', manage, (req, res) => {
  const ws = one('SELECT * FROM workspaces WHERE id = ?', wsId(req));
  const v = Object.fromEntries(SETTINGS.map((k) => [k, req.body[k] ?? ws[k]]));
  for (const k of ['privacy_shield', 'retention_days']) v[k] = Math.max(0, Number.parseInt(v[k], 10) || 0);
  v.privacy_shield = v.privacy_shield ? 1 : 0;
  if (v.slack_webhook && !/^https:\/\/hooks\.slack\.com\//.test(v.slack_webhook)) return res.status(400).json({ error: 'Slack webhook must start with https://hooks.slack.com/' });
  try { new Intl.DateTimeFormat('en', { timeZone: v.timezone || 'UTC' }); } catch { return res.status(400).json({ error: 'Unknown timezone' }); }
  v.timezone ||= 'UTC';
  for (const k of ['business_description', 'never_say', 'sensitive_topics', 'allowed_link_domains']) if (v[k] != null) v[k] = String(v[k]).slice(0, 20000);
  v.sensitive_topics ??= '';
  v.name ||= ws.name;
  v.reply_tone ||= 'friendly and helpful';
  v.default_language ||= 'auto';
  v.auto_send_min_confidence = Math.max(0, Math.min(1, Number(v.auto_send_min_confidence)));
  run(`UPDATE workspaces SET ${SETTINGS.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...SETTINGS.map((k) => (v[k] === '' && k !== 'sensitive_topics' ? null : v[k])), ws.id);
  res.json({ ok: true });
});

// Transparency: every time the AI read one of your customer chats.
r.get('/ai/log', (req, res) => res.json(all(`SELECT l.id, l.conversation_id, l.purpose, l.model, l.input_tokens, l.output_tokens, l.redactions, l.created_at,
    v.customer_name FROM ai_log l LEFT JOIN conversations v ON v.id = l.conversation_id WHERE l.workspace_id = ? ORDER BY l.id DESC LIMIT 200`, wsId(req))));

// ---------- Team ----------
const owner = (req, res, next) => (req.role === 'owner' && !req.viaApiKey && !req.impersonatedBy ? next() : res.status(403).json({ error: 'Only the workspace owner can do this' }));
r.get('/team', (req, res) => {
  const members = all(`SELECT u.id, u.email, u.name, u.last_login_at, u.totp_enabled, wm.role FROM workspace_members wm JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ? ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`, wsId(req));
  const invites = ['owner', 'admin'].includes(req.role) ? all(`SELECT id, email, role, created_at, expires_at FROM invites
    WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > datetime('now') ORDER BY id DESC`, wsId(req)) : [];
  const plan = effectivePlan(req.workspace);
  res.json({ members, invites, seats: plan.teamMembers, me: req.user.id, myRole: req.role });
});
async function sendInvite(req, email, role) {
  const token = randomToken(24);
  run(`INSERT INTO invites (workspace_id, email, role, token_hash, invited_by, expires_at) VALUES (?,?,?,?,?, datetime('now','+7 days'))`,
    wsId(req), email, role, sha256(token), req.user.id);
  const { sendSystemEmail } = await import('../services/notify.js');
  const { appName } = await import('../settings.js');
  await sendSystemEmail(email, `${req.user.name || req.user.email} invited you to ${req.workspace.name} on ${appName()}`,
    `You've been invited to join the "${req.workspace.name}" workspace as ${role}.\n\nAccept the invitation (valid for 7 days):\n${appUrl()}/join?token=${token}`).catch(() => {});
  return token;
}
r.post('/team/invite', manage, async (req, res) => {
  const email = str(req.body.email, 254).trim().toLowerCase();
  const role = req.body.role === 'admin' ? 'admin' : 'member';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  const plan = effectivePlan(req.workspace);
  const used = one('SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?', wsId(req)).n
    + one(`SELECT COUNT(*) AS n FROM invites WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > datetime('now')`, wsId(req)).n;
  if (used >= plan.teamMembers) return res.status(402).json({ error: `Your ${plan.name} plan includes ${plan.teamMembers} seat(s). Upgrade to add more people.` });
  const existing = one('SELECT id FROM users WHERE email = ?', email);
  if (existing && one('SELECT 1 AS x FROM workspace_members WHERE workspace_id = ? AND user_id = ?', wsId(req), existing.id)) return res.status(409).json({ error: 'Already a member' });
  if (one(`SELECT 1 AS x FROM invites WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL AND expires_at > datetime('now')`, wsId(req), email)) return res.status(409).json({ error: 'An invitation is already pending for this email' });
  const token = await sendInvite(req, email, role);
  securityEvent(req, 'teammate_invited', { email, role });
  res.json({ ok: true, ...(process.env.NODE_ENV === 'test' ? { token } : {}) });
});
r.post('/team/invites/:id/resend', manage, async (req, res) => {
  const inv = one('SELECT * FROM invites WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL', int(req.params.id), wsId(req));
  if (!inv) return res.status(404).json({ error: 'Not found' });
  run('DELETE FROM invites WHERE id = ?', inv.id);
  await sendInvite(req, inv.email, inv.role);
  res.json({ ok: true });
});
r.delete('/team/invites/:id', manage, (req, res) => {
  run('DELETE FROM invites WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL', int(req.params.id), wsId(req));
  res.json({ ok: true });
});
// Legacy: add an existing user directly (kept for the API).
r.post('/team', manage, (req, res) => {
  const plan = effectivePlan(req.workspace);
  if (one('SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?', wsId(req)).n >= plan.teamMembers) {
    return res.status(402).json({ error: `Your plan allows ${plan.teamMembers} team member(s)` });
  }
  const u = one('SELECT id FROM users WHERE email = ?', str(req.body.email, 254).toLowerCase());
  if (!u) return res.status(404).json({ error: 'No account with that email — send an invitation instead' });
  run('INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)', wsId(req), u.id, req.body.role === 'admin' ? 'admin' : 'member');
  res.json({ ok: true });
});
r.patch('/team/:userId', manage, (req, res) => {
  const uid = int(req.params.userId);
  const m = one('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?', wsId(req), uid);
  if (!m) return res.status(404).json({ error: 'Not a member' });
  if (m.role === 'owner') return res.status(400).json({ error: "The owner's role can't be changed — transfer ownership instead" });
  if (!['admin', 'member'].includes(req.body.role)) return res.status(400).json({ error: 'Role must be admin or member' });
  run('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?', req.body.role, wsId(req), uid);
  securityEvent(req, 'teammate_role_changed', { user: uid, role: req.body.role });
  res.json({ ok: true });
});
r.delete('/team/:userId', manage, (req, res) => {
  const uid = int(req.params.userId);
  if (uid === req.workspace.owner_id) return res.status(400).json({ error: 'Cannot remove the owner' });
  run('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?', wsId(req), uid);
  run('UPDATE conversations SET assigned_to = NULL WHERE workspace_id = ? AND assigned_to = ?', wsId(req), uid);
  securityEvent(req, 'teammate_removed', { user: uid });
  res.json({ ok: true });
});
r.post('/team/transfer', owner, (req, res) => {
  const uid = int(req.body.user_id);
  if (!one('SELECT 1 AS x FROM workspace_members WHERE workspace_id = ? AND user_id = ?', wsId(req), uid) || uid === req.user.id) return res.status(400).json({ error: 'Choose another member of this workspace' });
  run(`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ? AND user_id = ?`, wsId(req), req.user.id);
  run(`UPDATE workspace_members SET role = 'owner' WHERE workspace_id = ? AND user_id = ?`, wsId(req), uid);
  run('UPDATE workspaces SET owner_id = ? WHERE id = ?', uid, wsId(req));
  securityEvent(req, 'ownership_transferred', { to: uid });
  res.json({ ok: true });
});
r.post('/team/leave', (req, res) => {
  if (req.role === 'owner') return res.status(400).json({ error: 'Transfer ownership before leaving, or delete the workspace' });
  run('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?', wsId(req), req.user.id);
  run('UPDATE conversations SET assigned_to = NULL WHERE workspace_id = ? AND assigned_to = ?', wsId(req), req.user.id);
  // Never leave someone without a workspace: give them a fresh personal one (on the free trial).
  if (!one('SELECT 1 AS x FROM workspace_members WHERE user_id = ?', req.user.id)) {
    const w = run('INSERT INTO workspaces (name, owner_id, business_name, trial_ends_at) VALUES (?,?,?,?)',
      `${req.user.name || req.user.email.split('@')[0]}'s shop`, req.user.id, '', new Date(Date.now() + getNum('trial_days') * 86400_000).toISOString());
    run('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)', Number(w.lastInsertRowid), req.user.id, 'owner');
  }
  run('UPDATE users SET current_workspace_id = NULL WHERE id = ?', req.user.id);
  res.json({ ok: true });
});
r.delete('/workspace', owner, async (req, res) => {
  if (str(req.body.confirm, 200).trim() !== req.workspace.name) return res.status(400).json({ error: 'Type the workspace name to confirm' });
  const owned = one('SELECT COUNT(*) AS n FROM workspace_members WHERE user_id = ?', req.user.id).n;
  if (owned < 2) return res.status(400).json({ error: "This is your only workspace — delete your account instead (Security & privacy)" });
  run('DELETE FROM workspaces WHERE id = ?', wsId(req));
  run('UPDATE users SET current_workspace_id = NULL WHERE id = ?', req.user.id);
  const { forgetKey } = await import('../vault.js');
  forgetKey(wsId(req));
  audit(req, 'workspace_deleted_by_owner', `workspace:${wsId(req)}`);
  res.json({ ok: true });
});

// ---------- Notifications (bell) ----------
r.get('/notifications', (req, res) => {
  const seen = one('SELECT notifications_seen_at FROM users WHERE id = ?', req.user.id).notifications_seen_at;
  const items = all(`SELECT id, type, detail, created_at, created_at > COALESCE(?, '1970') AS unread FROM activity WHERE workspace_id = ?
    AND type IN ('send_failed','payment_failed','subscription_updated','order_created','chat_handoff','chat_draft','channel_added')
    ORDER BY id DESC LIMIT 30`, seen, wsId(req));
  res.json(items);
});
r.post('/notifications/seen', (req, res) => {
  run(`UPDATE users SET notifications_seen_at = datetime('now') WHERE id = ?`, req.user.id);
  res.json({ ok: true });
});

// ---------- Contacts (CRM-lite, built automatically from email) ----------
// ---------- Integrations: API keys + alert tests ----------
r.get('/api-keys', manage, (req, res) => res.json(all('SELECT id, name, prefix, last_used_at, created_at FROM api_keys WHERE workspace_id = ?', wsId(req))));
r.post('/api-keys', manage, (req, res) => {
  if (req.viaApiKey) return res.status(403).json({ error: 'Use the dashboard to create API keys' });
  const key = `cp_live_${randomToken(24)}`;
  run('INSERT INTO api_keys (workspace_id, name, prefix, key_hash) VALUES (?,?,?,?)', wsId(req), str(req.body.name || 'API key', 80), key.slice(0, 14), sha256(key));
  securityEvent(req, 'api_key_created', { name: str(req.body.name, 80) });
  res.json({ key }); // shown once
});
r.delete('/api-keys/:id', manage, (req, res) => {
  securityEvent(req, 'api_key_revoked', { id: int(req.params.id) });
  run('DELETE FROM api_keys WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  res.json({ ok: true });
});
r.post('/integrations/test', manage, async (req, res) => {
  const ws = one('SELECT * FROM workspaces WHERE id = ?', wsId(req));
  const text = `✅ Test alert from your sales assistant (${ws.name}). Alerts are working!`;
  const results = await Promise.allSettled([sendTelegram(ws.telegram_chat_id, text), sendSlack(ws.slack_webhook, text)]);
  const errs = results.filter((x) => x.status === 'rejected').map((x) => x.reason.message);
  if (!ws.telegram_chat_id && !ws.slack_webhook) return res.status(400).json({ error: 'Add a Telegram chat ID or Slack webhook first' });
  res.json({ ok: !errs.length, errors: errs });
});

// ---------- Support tickets (customer side) ----------
r.get('/tickets', (req, res) => res.json(all('SELECT * FROM tickets WHERE user_id = ? ORDER BY updated_at DESC', req.user.id)));
r.get('/tickets/:id', (req, res) => {
  const t = one('SELECT * FROM tickets WHERE id = ? AND user_id = ?', int(req.params.id), req.user.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  t.messages = all('SELECT id, is_staff, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id', t.id);
  res.json(t);
});
r.post('/tickets', (req, res) => {
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  if (!subject || !body) return res.status(400).json({ error: 'Subject and message are required' });
  const t = run('INSERT INTO tickets (workspace_id, user_id, subject, priority) VALUES (?,?,?,?)', wsId(req), req.user.id, subject.slice(0, 200), ['low', 'normal', 'high'].includes(req.body.priority) ? req.body.priority : 'normal');
  const id = Number(t.lastInsertRowid);
  run('INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES (?,?,?)', id, req.user.id, body.slice(0, 20000));
  notifyAdmins(`New support ticket #${id}`, `${req.user.email}: ${subject}\n\n${body}`).catch(() => {});
  res.json({ id });
});
r.post('/tickets/:id/reply', (req, res) => {
  const t = one('SELECT * FROM tickets WHERE id = ? AND user_id = ?', int(req.params.id), req.user.id);
  if (!t || !req.body.body) return res.status(400).json({ error: 'Message required' });
  run('INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES (?,?,?)', t.id, req.user.id, String(req.body.body).slice(0, 20000));
  run(`UPDATE tickets SET status='open', updated_at=datetime('now') WHERE id=?`, t.id);
  res.json({ ok: true });
});

// ---------- Referral / affiliate program ----------
r.get('/referrals', (req, res) => {
  const u = one('SELECT referral_code FROM users WHERE id = ?', req.user.id);
  const signups = one('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?', req.user.id).n;
  const earn = one(`SELECT COALESCE(SUM(commission),0) AS total, COALESCE(SUM(CASE WHEN commission_paid=1 THEN commission ELSE 0 END),0) AS paid,
    COUNT(*) AS payments FROM payments WHERE referral_user_id = ? AND status = 'paid'`, req.user.id);
  res.json({ link: `${appUrl()}/?ref=${u.referral_code}`, code: u.referral_code, signups, ...earn, commissionPct: getNum('referral_commission_pct') });
});


export default r;
