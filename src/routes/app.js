import { Router } from 'express';
import { one, all, run, getUsage, logActivity, audit, securityEvent } from '../db.js';
import { requireRole, sha256 } from '../auth.js';
import { randomToken } from '../crypto.js';
import { effectivePlan } from '../plans.js';
import { PROVIDERS, guessProvider } from '../services/providers.js';
import { testConnection, fetchSentSamples, sendNew } from '../services/mail.js';
import { syncMailbox } from '../services/worker.js';
import { processMessage, sendStoredReply, recordCorrection, guardReply, deliverWebhook } from '../services/processor.js';
import { askInbox, learnStyle, translate, aiEnabled, analyzeEmail, CATEGORIES, fallbackTriage } from '../services/ai.js';
import { sendTelegram, sendSlack, notifyAdmins } from '../services/notify.js';
import { oauthAvailability, revokeMailboxGrant } from '../services/oauth.js';
import { safeFetch } from '../services/net.js';
import { detectInjection } from '../services/guard.js';
import { seal, open, openMessage, openReply } from '../vault.js';
import { getBool, getNum, appUrl } from '../settings.js';
import { validateRule, FIELDS, OPS, ACTIONS } from '../services/rules.js';

const r = Router();
const manage = requireRole('owner', 'admin');
const wsId = (req) => req.workspace.id;
const int = (v) => Number.parseInt(v, 10);
const str = (v, max = 1000) => String(v ?? '').slice(0, max);

// Who is looking at which email right now (collision detection for teams). In-memory, expires after 60s.
const viewers = new Map(); // messageId -> Map(userId -> {name, at})
function touchViewer(msgId, user) {
  const m = viewers.get(msgId) || new Map();
  m.set(user.id, { name: user.name || user.email, at: Date.now() });
  viewers.set(msgId, m);
}
function currentViewers(msgId, exceptUserId) {
  const m = viewers.get(msgId);
  if (!m) return [];
  for (const [k, v] of m) if (Date.now() - v.at > 60_000) m.delete(k);
  return [...m.entries()].filter(([k]) => k !== exceptUserId).map(([, v]) => v.name);
}

// ---------- Dashboard ----------
r.get('/dashboard', (req, res) => {
  const id = wsId(req);
  const now = new Date().toISOString();
  const counts = one(`SELECT
      COUNT(*) AS total,
      SUM(status='drafted') AS awaiting_approval,
      SUM(status='replied') AS replied,
      SUM(status='ignored') AS ignored,
      SUM(priority='urgent' AND done=0) AS urgent,
      SUM(datetime(received_at) > datetime('now','-1 day')) AS last24h,
      SUM(sla_due_at IS NOT NULL AND sla_due_at < ? AND done = 0) AS overdue,
      SUM(assigned_to = ? AND done = 0) AS mine
    FROM messages WHERE workspace_id = ?`, now, req.user.id, id);
  const byCategory = all(`SELECT category, COUNT(*) AS n FROM messages WHERE workspace_id = ? AND category IS NOT NULL
      AND datetime(received_at) > datetime('now','-30 days') GROUP BY category ORDER BY n DESC`, id);
  const daily = all(`SELECT substr(received_at,1,10) AS day, COUNT(*) AS received,
      SUM(status='replied') AS replied FROM messages WHERE workspace_id = ? AND datetime(received_at) > datetime('now','-14 days')
      GROUP BY day ORDER BY day`, id);
  const activity = all('SELECT * FROM activity WHERE workspace_id = ? ORDER BY id DESC LIMIT 12', id);
  const hotLeads = all(`SELECT id, from_name, from_email, subject, intent, lead_score, status FROM messages
    WHERE workspace_id = ? AND lead_score >= 70 AND datetime(received_at) > datetime('now','-14 days') ORDER BY lead_score DESC, id DESC LIMIT 6`, id);
  const scheduled = one(`SELECT COUNT(*) AS n FROM replies WHERE workspace_id = ? AND status = 'scheduled'`, id).n;
  const acc = one(`SELECT COUNT(*) AS n, SUM(edited = 0) AS unedited FROM replies WHERE workspace_id = ? AND status = 'sent' AND edited IS NOT NULL
    AND sent_at > datetime('now','-30 days')`, id);
  const plan = effectivePlan(req.workspace);
  const minutesSaved = (counts.replied || 0) * 4 + (counts.ignored || 0) * 0.5;
  res.json({ counts, byCategory, daily, activity, hotLeads, scheduled, usage: getUsage(id), plan, aiEnabled: aiEnabled(),
    emailVerified: Boolean(req.user.email_verified),
    mailboxes: one('SELECT COUNT(*) AS n FROM mailboxes WHERE workspace_id = ?', id).n,
    mailboxErrors: one('SELECT COUNT(*) AS n FROM mailboxes WHERE workspace_id = ? AND last_error IS NOT NULL AND enabled = 1', id).n,
    aiAccuracy: acc.n ? Math.round((acc.unedited / acc.n) * 100) : null,
    minutesSaved, moneySaved: Math.round((minutesSaved / 60) * (req.workspace.hourly_rate || 0)) });
});

// ---------- Mailboxes ----------
r.get('/providers', (req, res) => res.json({ presets: PROVIDERS, oauth: oauthAvailability() }));

r.get('/mailboxes', (req, res) => {
  res.json(all(`SELECT id, label, email, provider, imap_host, imap_port, smtp_host, smtp_port, username, mode, enabled,
      last_sync_at, last_error, created_at, auth_type, signature, auto_categories, revoked_at,
      (SELECT COUNT(*) FROM messages m WHERE m.mailbox_id = mailboxes.id) AS message_count FROM mailboxes WHERE workspace_id = ? ORDER BY id`, wsId(req))
    .map((m) => ({ ...m, auto_categories: m.auto_categories ? JSON.parse(m.auto_categories) : null })));
});

r.post('/mailboxes', manage, async (req, res) => {
  if (getBool('require_email_verification') && !req.user.email_verified) return res.status(403).json({ error: 'Please verify your email address first (check your inbox).' });
  const plan = effectivePlan(req.workspace);
  const count = one('SELECT COUNT(*) AS n FROM mailboxes WHERE workspace_id = ?', wsId(req)).n;
  if (count >= plan.mailboxes) return res.status(402).json({ error: `Your ${plan.name} plan allows ${plan.mailboxes} email account(s). Upgrade to add more.` });

  const email = str(req.body.email, 254).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const provider = PROVIDERS[req.body.provider] ? req.body.provider : guessProvider(email);
  const preset = PROVIDERS[provider];
  const mb = {
    workspace_id: wsId(req), email, provider, label: str(req.body.label, 100),
    imap_host: str(req.body.imap_host || preset.imap_host, 253).trim(), imap_port: int(req.body.imap_port) || preset.imap_port,
    imap_secure: req.body.imap_secure ?? preset.imap_secure,
    smtp_host: str(req.body.smtp_host || preset.smtp_host, 253).trim(), smtp_port: int(req.body.smtp_port) || preset.smtp_port,
    smtp_secure: req.body.smtp_secure ?? preset.smtp_secure,
    username: str(req.body.username || email, 254),
    mode: ['off', 'draft', 'auto'].includes(req.body.mode) ? req.body.mode : 'draft',
  };
  if (!req.body.password || !mb.imap_host || !mb.smtp_host) return res.status(400).json({ error: 'Email, password, IMAP host and SMTP host are required' });
  if (Number(mb.imap_port) === 993 || Number(mb.imap_port) === 1993) mb.imap_secure = true;
  if (Number(mb.smtp_port) === 465) mb.smtp_secure = true;
  if (Number(mb.smtp_port) === 587) mb.smtp_secure = false; // STARTTLS (required)

  // The connection test also validates that the servers are public mail servers (SSRF protection).
  try { await testConnection(mb, String(req.body.password)); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const result = run(`INSERT INTO mailboxes (workspace_id, label, email, provider, imap_host, imap_port, imap_secure,
        smtp_host, smtp_port, smtp_secure, username, password_enc, mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    wsId(req), mb.label, mb.email, mb.provider, mb.imap_host, mb.imap_port, mb.imap_secure ? 1 : 0,
    mb.smtp_host, mb.smtp_port, mb.smtp_secure ? 1 : 0, mb.username, seal(wsId(req), 'mailboxes.password', String(req.body.password)), mb.mode);
    const id = Number(result.lastInsertRowid);
    logActivity(wsId(req), 'mailbox_added', { email });
    securityEvent(req, 'mailbox_connected', { email, via: 'imap' });
    syncMailbox(id).catch(() => {});
    res.json({ id });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return res.status(409).json({ error: 'This mailbox is already connected' });
    throw e;
  }
});

r.patch('/mailboxes/:id', manage, async (req, res) => {
  const mb = one('SELECT * FROM mailboxes WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!mb) return res.status(404).json({ error: 'Not found' });
  const mode = ['off', 'draft', 'auto'].includes(req.body.mode) ? req.body.mode : mb.mode;
  const enabled = req.body.enabled === undefined ? mb.enabled : (req.body.enabled ? 1 : 0);
  const label = req.body.label === undefined ? mb.label : str(req.body.label, 100);
  const signature = req.body.signature === undefined ? mb.signature : str(req.body.signature, 2000);
  let autoCats = mb.auto_categories;
  if (req.body.auto_categories !== undefined) {
    autoCats = Array.isArray(req.body.auto_categories) ? JSON.stringify(req.body.auto_categories.filter((c) => CATEGORIES.includes(c))) : null;
  }
  if (req.body.password) {
    try { await testConnection({ ...mb, auth_type: 'password' }, String(req.body.password)); } catch (e) { return res.status(400).json({ error: e.message }); }
    run(`UPDATE mailboxes SET password_enc=?, auth_type='password', last_error=NULL, revoked_at=NULL WHERE id=?`, seal(mb.workspace_id, 'mailboxes.password', String(req.body.password)), mb.id);
    securityEvent(req, 'mailbox_password_updated', { email: mb.email });
  }
  const serverKeys = ['imap_host', 'imap_port', 'imap_secure', 'smtp_host', 'smtp_port', 'smtp_secure', 'username'];
  if (serverKeys.some((k) => req.body[k] !== undefined) && !req.body.password) {
    if (mb.auth_type !== 'password') return res.status(400).json({ error: 'Server settings are managed by Google/Microsoft for this account' });
    const next = { ...mb };
    for (const k of serverKeys) if (req.body[k] !== undefined) next[k] = k.endsWith('_port') ? int(req.body[k]) : k.endsWith('_secure') ? (req.body[k] ? 1 : 0) : str(req.body[k], 254).trim();
    try { await testConnection(next); } catch (e) { return res.status(400).json({ error: e.message }); }
    run('UPDATE mailboxes SET imap_host=?, imap_port=?, imap_secure=?, smtp_host=?, smtp_port=?, smtp_secure=?, username=?, last_error=NULL WHERE id=?',
      next.imap_host, next.imap_port, next.imap_secure, next.smtp_host, next.smtp_port, next.smtp_secure, next.username, mb.id);
    securityEvent(req, 'mailbox_settings_changed', { email: mb.email });
  }
  run('UPDATE mailboxes SET mode=?, enabled=?, label=?, signature=?, auto_categories=? WHERE id=?', mode, enabled, label, signature, autoCats, mb.id);
  res.json({ ok: true });
});

r.delete('/mailboxes/:id', manage, async (req, res) => {
  const mb = one('SELECT * FROM mailboxes WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!mb) return res.status(404).json({ error: 'Not found' });
  const revoked = await revokeMailboxGrant(mb).catch(() => false);
  run('DELETE FROM mailboxes WHERE id = ?', mb.id);
  securityEvent(req, 'mailbox_removed', { email: mb.email, providerAccessRevoked: revoked });
  res.json({ ok: true, revoked });
});

r.post('/mailboxes/:id/sync', async (req, res) => {
  const mb = one('SELECT id FROM mailboxes WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!mb) return res.status(404).json({ error: 'Not found' });
  res.json(await syncMailbox(mb.id));
});

// "Earned autopilot": per category, how often the AI's drafts were sent without edits.
r.get('/autopilot/stats', (req, res) => {
  const rows = all(`SELECT m.category, COUNT(*) AS sent, SUM(r.edited = 0) AS unedited FROM replies r JOIN messages m ON m.id = r.message_id
    WHERE r.workspace_id = ? AND r.status = 'sent' AND r.source = 'ai' AND r.edited IS NOT NULL GROUP BY m.category ORDER BY sent DESC`, wsId(req));
  res.json(rows.map((x) => {
    const accuracy = x.sent ? Math.round((x.unedited / x.sent) * 100) : 0;
    return { ...x, accuracy, recommended: x.sent >= 10 && accuracy >= 90 };
  }));
});

// ---------- Messages (unified inbox) ----------
r.get('/messages', (req, res) => {
  const where = ['m.workspace_id = ?'];
  const params = [wsId(req)];
  const now = new Date().toISOString();
  const view = req.query.view || 'inbox';
  if (view === 'inbox') { where.push(`(m.snoozed_until IS NULL OR m.snoozed_until < ?)`); params.push(now); }
  if (view === 'snoozed') { where.push('m.snoozed_until > ?'); params.push(now); }
  if (view === 'mine') { where.push('m.assigned_to = ? AND m.done = 0'); params.push(req.user.id); }
  if (view === 'unassigned') where.push(`m.assigned_to IS NULL AND m.done = 0 AND m.status IN ('triaged','drafted')`);
  if (view === 'overdue') { where.push('m.sla_due_at IS NOT NULL AND m.sla_due_at < ? AND m.done = 0'); params.push(now); }
  if (view === 'flagged') where.push('(m.guard_flags IS NOT NULL OR m.injection_flag = 1 OR m.is_phishing = 1)');
  if (view === 'awaiting') {
    // We replied and they haven't answered yet.
    where.push(`m.status = 'replied' AND NOT EXISTS (SELECT 1 FROM messages m2 WHERE m2.workspace_id = m.workspace_id AND m2.from_email = m.from_email AND m2.received_at > m.received_at)`);
  }
  if (req.query.starred) where.push('m.starred = 1');
  if (req.query.contact_id) { where.push('m.contact_id = ?'); params.push(req.query.contact_id); }
  if (req.query.min_lead) { where.push('m.lead_score >= ?'); params.push(Number(req.query.min_lead)); }
  for (const f of ['status', 'category', 'priority', 'mailbox_id']) {
    if (req.query[f]) { where.push(`m.${f} = ?`); params.push(String(req.query[f])); }
  }
  if (req.query.q) {
    where.push('(m.subject LIKE ? OR m.from_email LIKE ? OR m.from_name LIKE ? OR m.summary LIKE ? OR m.intent LIKE ?)');
    const q = `%${str(req.query.q, 200)}%`; params.push(q, q, q, q, q);
  }
  const limit = Math.min(int(req.query.limit) || 50, 200);
  const offset = Math.max(0, int(req.query.offset) || 0);
  res.json(all(`SELECT m.id, m.mailbox_id, mb.email AS mailbox_email, m.from_name, m.from_email, m.subject, m.summary,
      m.category, m.priority, m.sentiment, m.language, m.status, m.received_at, m.confidence, m.lead_score, m.intent, m.starred,
      m.is_phishing, m.injection_flag, m.guard_flags IS NOT NULL AS flagged, m.assigned_to, u.name AS assignee_name, m.snoozed_until,
      m.sla_due_at, m.done, m.attachments_json IS NOT NULL AS has_attachments
    FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id LEFT JOIN users u ON u.id = m.assigned_to
    WHERE ${where.join(' AND ')} ORDER BY m.received_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset));
});

r.get('/messages/counts', (req, res) => {
  const now = new Date().toISOString();
  res.json(one(`SELECT
      SUM(snoozed_until IS NULL OR snoozed_until < ?) AS inbox,
      SUM(assigned_to = ? AND done = 0) AS mine,
      SUM(assigned_to IS NULL AND done = 0 AND status IN ('triaged','drafted')) AS unassigned,
      SUM(sla_due_at IS NOT NULL AND sla_due_at < ? AND done = 0) AS overdue,
      SUM(snoozed_until > ?) AS snoozed,
      SUM(guard_flags IS NOT NULL OR injection_flag = 1 OR is_phishing = 1) AS flagged
    FROM messages WHERE workspace_id = ?`, now, req.user.id, now, now, wsId(req)));
});

function loadMessage(req) {
  const m = one(`SELECT m.*, mb.email AS mailbox_email FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
    WHERE m.id = ? AND m.workspace_id = ?`, int(req.params.id), wsId(req));
  return m ? openMessage(m) : null;
}

r.get('/messages/:id', (req, res) => {
  const m = loadMessage(req);
  if (!m) return res.status(404).json({ error: 'Not found' });
  delete m.headers_json;
  m.extracted = m.extracted_json ? JSON.parse(m.extracted_json) : {};
  m.attachments = m.attachments_json ? JSON.parse(m.attachments_json) : [];
  m.guard_flags = m.guard_flags ? JSON.parse(m.guard_flags) : [];
  m.facts_used = m.facts_used ? JSON.parse(m.facts_used) : [];
  m.replies = all('SELECT * FROM replies WHERE message_id = ? ORDER BY id', m.id).map(openReply).map((x) => ({ ...x, guard: x.guard_json ? JSON.parse(x.guard_json) : [] }));
  m.contact = m.contact_id ? one('SELECT * FROM contacts WHERE id = ?', m.contact_id) : null;
  m.notes = all(`SELECT n.id, n.body, n.created_at, u.name, u.email FROM message_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.message_id = ? ORDER BY n.id`, m.id);
  m.team = all('SELECT u.id, u.name, u.email FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = ?', wsId(req));
  touchViewer(m.id, req.user);
  m.viewers = currentViewers(m.id, req.user.id);
  res.json(m);
});

r.post('/messages/:id/viewing', (req, res) => {
  const m = one('SELECT id FROM messages WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!m) return res.status(404).json({ error: 'Not found' });
  touchViewer(m.id, req.user);
  res.json({ viewers: currentViewers(m.id, req.user.id) });
});

r.post('/messages/:id/star', (req, res) => {
  run('UPDATE messages SET starred = ? WHERE id = ? AND workspace_id = ?', req.body.starred ? 1 : 0, int(req.params.id), wsId(req));
  res.json({ ok: true });
});

// Team workflow: assign, snooze, mark done, internal notes.
r.post('/messages/:id/assign', (req, res) => {
  const uid = req.body.user_id ? int(req.body.user_id) : null;
  if (uid && !one('SELECT 1 AS x FROM workspace_members WHERE workspace_id = ? AND user_id = ?', wsId(req), uid)) return res.status(400).json({ error: 'Not a teammate' });
  const x = run('UPDATE messages SET assigned_to = ? WHERE id = ? AND workspace_id = ?', uid, int(req.params.id), wsId(req));
  if (!x.changes) return res.status(404).json({ error: 'Not found' });
  logActivity(wsId(req), 'assigned', { message: int(req.params.id), to: uid });
  res.json({ ok: true });
});
r.post('/messages/:id/snooze', (req, res) => {
  const until = req.body.until ? new Date(req.body.until) : null;
  if (until && (Number.isNaN(until.getTime()) || until < new Date())) return res.status(400).json({ error: 'Choose a time in the future' });
  run('UPDATE messages SET snoozed_until = ? WHERE id = ? AND workspace_id = ?', until ? until.toISOString() : null, int(req.params.id), wsId(req));
  res.json({ ok: true });
});
r.post('/messages/:id/done', (req, res) => {
  run('UPDATE messages SET done = ?, sla_due_at = CASE WHEN ? THEN NULL ELSE sla_due_at END WHERE id = ? AND workspace_id = ?',
    req.body.done === false ? 0 : 1, req.body.done === false ? 0 : 1, int(req.params.id), wsId(req));
  res.json({ ok: true });
});
r.post('/messages/:id/notes', (req, res) => {
  const m = one('SELECT id FROM messages WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  const body = str(req.body.body, 5000).trim();
  if (!m || !body) return res.status(400).json({ error: 'Write a note' });
  run('INSERT INTO message_notes (workspace_id, message_id, user_id, body) VALUES (?,?,?,?)', wsId(req), m.id, req.user.id, body);
  // @mentions: tag teammates by email to assign
  const mention = body.match(/@([^\s@]+@[^\s@]+\.[^\s@]+)/);
  if (mention) {
    const u = one('SELECT u.id FROM users u JOIN workspace_members wm ON wm.user_id = u.id WHERE wm.workspace_id = ? AND u.email = ?', wsId(req), mention[1].toLowerCase());
    if (u) run('UPDATE messages SET assigned_to = ? WHERE id = ?', u.id, m.id);
  }
  res.json({ ok: true });
});

// Correct the AI: change category / priority, or mark a false phishing alarm as safe.
r.post('/messages/:id/classify', (req, res) => {
  const m = one('SELECT * FROM messages WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!m) return res.status(404).json({ error: 'Not found' });
  const category = req.body.category ? String(req.body.category) : m.category;
  const priority = req.body.priority ? String(req.body.priority) : m.priority;
  if (!CATEGORIES.includes(category) || !['urgent', 'high', 'normal', 'low'].includes(priority)) return res.status(400).json({ error: 'Invalid category or priority' });
  const safe = req.body.not_phishing === true;
  run(`UPDATE messages SET category = ?, priority = ?, is_phishing = CASE WHEN ? THEN 0 ELSE is_phishing END,
    status = CASE WHEN ? AND status = 'ignored' THEN 'triaged' ELSE status END, reasoning = ? WHERE id = ?`,
  category, priority, safe ? 1 : 0, safe ? 1 : 0, `Corrected by ${req.user.name || req.user.email}`, m.id);
  logActivity(wsId(req), 'reclassified', { message: m.id, category, priority, not_phishing: safe });
  res.json({ ok: true });
});
r.post('/messages/bulk', (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(int).filter(Boolean).slice(0, 500);
  if (!ids.length) return res.status(400).json({ error: 'Select at least one email' });
  const where = `workspace_id = ? AND id IN (${ids.map(() => '?').join(',')})`;
  const a = String(req.body.action || '');
  if (a === 'done') run(`UPDATE messages SET done = 1, sla_due_at = NULL WHERE ${where}`, wsId(req), ...ids);
  else if (a === 'undone') run(`UPDATE messages SET done = 0 WHERE ${where}`, wsId(req), ...ids);
  else if (a === 'star') run(`UPDATE messages SET starred = 1 WHERE ${where}`, wsId(req), ...ids);
  else if (a === 'snooze') {
    const until = new Date(req.body.until);
    if (Number.isNaN(until.getTime()) || until < new Date()) return res.status(400).json({ error: 'Choose a time in the future' });
    run(`UPDATE messages SET snoozed_until = ? WHERE ${where}`, until.toISOString(), wsId(req), ...ids);
  } else if (a === 'assign') {
    const uid = req.body.user_id ? int(req.body.user_id) : null;
    if (uid && !one('SELECT 1 AS x FROM workspace_members WHERE workspace_id = ? AND user_id = ?', wsId(req), uid)) return res.status(400).json({ error: 'Not a teammate' });
    run(`UPDATE messages SET assigned_to = ? WHERE ${where}`, uid, wsId(req), ...ids);
  } else return res.status(400).json({ error: 'Unknown action' });
  res.json({ ok: true, count: ids.length });
});

r.post('/messages/:id/translate', async (req, res) => {
  if (!aiEnabled()) return res.status(400).json({ error: 'AI is not configured on this server' });
  const m = loadMessage(req);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const target = str(req.body.lang || req.workspace.owner_language || 'English', 40);
  const text = req.body.text ? str(req.body.text, 15000) : `${m.subject}\n\n${m.text_body}`;
  res.json({ translation: await translate(req.workspace, text, target, m.id) });
});

r.post('/messages/:id/reprocess', async (req, res) => {
  const m = one('SELECT id FROM messages WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!m) return res.status(404).json({ error: 'Not found' });
  run(`UPDATE messages SET status='new' WHERE id=?`, m.id);
  await processMessage(m.id);
  res.json({ ok: true });
});

// Ask the AI for a fresh draft with custom instructions (e.g. "offer a 10% discount").
r.post('/messages/:id/draft', async (req, res) => {
  const m = loadMessage(req);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (!aiEnabled()) return res.status(400).json({ error: 'AI is not configured on this server' });
  const result = await analyzeEmail(req.workspace, m, str(req.body.instructions, 1000));
  const mb = one('SELECT * FROM mailboxes WHERE id = ?', m.mailbox_id);
  const guard = guardReply(req.workspace, mb, m, result.reply_body || '');
  const r2 = run(`INSERT INTO replies (workspace_id, message_id, subject, body, source, ai_original, guard_json, error) VALUES (?,?,?,?, 'ai', ?, ?, ?)`,
    wsId(req), m.id, result.reply_subject, seal(wsId(req), 'replies.body', result.reply_body), seal(wsId(req), 'replies.ai_original', result.reply_body),
    guard.length ? JSON.stringify(guard) : null, guard.length ? `Check before sending: ${guard.join('; ')}` : null);
  run(`UPDATE messages SET status='drafted' WHERE id=?`, m.id);
  res.json({ id: Number(r2.lastInsertRowid), subject: result.reply_subject, body: result.reply_body, guard });
});

// Manual reply composed by a human.
r.post('/messages/:id/reply', async (req, res) => {
  const m = one('SELECT id FROM messages WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  const body = str(req.body.body, 50000);
  if (!m || !body.trim()) return res.status(400).json({ error: 'Message and body required' });
  const r2 = run(`INSERT INTO replies (workspace_id, message_id, subject, body, source) VALUES (?,?,?,?, 'manual')`,
    wsId(req), m.id, str(req.body.subject, 998), seal(wsId(req), 'replies.body', body));
  try {
    await sendStoredReply(Number(r2.lastInsertRowid), req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: `Send failed: ${e.message}` });
  }
});

// ---------- Approval queue ----------
r.get('/replies', (req, res) => {
  const status = String(req.query.status || 'pending');
  const statuses = status === 'queue' ? ['pending', 'scheduled', 'failed'] : [status];
  res.json(all(`SELECT r.*, m.from_name, m.from_email, m.subject AS original_subject, m.summary, m.category, m.priority,
      m.text_body AS original_body, m.reasoning, m.lead_score, m.guard_flags, mb.email AS mailbox_email
    FROM replies r JOIN messages m ON m.id = r.message_id JOIN mailboxes mb ON mb.id = m.mailbox_id
    WHERE r.workspace_id = ? AND r.status IN (${statuses.map(() => '?').join(',')}) ORDER BY r.status = 'scheduled' DESC, r.id DESC LIMIT 100`,
  wsId(req), ...statuses).map(openReply).map((x) => ({ ...x, guard: x.guard_json ? JSON.parse(x.guard_json) : [], ai_original: undefined })));
});

r.post('/replies/:id/approve', async (req, res) => {
  const reply = one('SELECT * FROM replies WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!reply) return res.status(404).json({ error: 'Not found' });
  if (req.body.body) {
    const body = str(req.body.body, 50000);
    run('UPDATE replies SET body=?, subject=? WHERE id=?', seal(wsId(req), 'replies.body', body), str(req.body.subject ?? reply.subject, 998), reply.id);
    if (req.workspace.learn_from_edits) recordCorrection(reply, body);
  }
  try {
    await sendStoredReply(reply.id, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: `Send failed: ${e.message}` });
  }
});

// Undo window for scheduled auto-replies: move back to the approval queue.
r.post('/replies/:id/hold', (req, res) => {
  const x = run(`UPDATE replies SET status='pending', scheduled_at=NULL, error='Held by you (undo)' WHERE id=? AND workspace_id=? AND status='scheduled'`, int(req.params.id), wsId(req));
  if (!x.changes) return res.status(409).json({ error: 'Too late — it was already sent' });
  res.json({ ok: true });
});

r.post('/replies/:id/reject', (req, res) => {
  const reply = one('SELECT * FROM replies WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!reply) return res.status(404).json({ error: 'Not found' });
  run(`UPDATE replies SET status='rejected' WHERE id=?`, reply.id);
  run(`UPDATE messages SET status='triaged' WHERE id=? AND status='drafted'`, reply.message_id);
  res.json({ ok: true });
});

// ---------- Simulator: test the AI on a sample email without sending anything ----------
r.post('/ai/simulate', async (req, res) => {
  const ws = req.workspace;
  const sample = {
    id: null, workspace_id: ws.id, from_name: str(req.body.from_name, 100) || 'Test Customer', from_email: str(req.body.from_email, 254) || 'customer@example.com',
    subject: str(req.body.subject, 300), text_body: str(req.body.body, 20000), received_at: new Date().toISOString(),
  };
  if (!sample.text_body.trim()) return res.status(400).json({ error: 'Paste an email to test' });
  const triage = aiEnabled() ? await analyzeEmail(ws, sample) : fallbackTriage(sample);
  const anyMb = one('SELECT * FROM mailboxes WHERE workspace_id = ? LIMIT 1', ws.id) || { email: 'you@example.com' };
  const guard = triage.reply_body ? guardReply(ws, anyMb, sample, triage.reply_body) : [];
  const injection = detectInjection(`${sample.subject}\n${sample.text_body}`);
  const wouldAutoSend = Boolean(triage.reply_body) && !triage.requires_human && !triage.unsupported_claims && !triage.is_phishing
    && triage.confidence >= ws.auto_send_min_confidence && !guard.length && !injection.flagged;
  res.json({ triage, guard, injection: injection.flagged, wouldAutoSend });
});

// ---------- Rules ----------
r.get('/rules/meta', (req, res) => res.json({ fields: FIELDS, ops: OPS, actions: ACTIONS, categories: CATEGORIES }));
r.get('/rules', (req, res) => {
  res.json(all('SELECT * FROM rules WHERE workspace_id = ? ORDER BY position, id', wsId(req)).map((x) => ({
    ...x, conditions: JSON.parse(x.conditions_json), actions: JSON.parse(x.actions_json),
  })));
});
r.post('/rules', manage, (req, res) => {
  const plan = effectivePlan(req.workspace);
  if (one('SELECT COUNT(*) AS n FROM rules WHERE workspace_id = ?', wsId(req)).n >= plan.rules) {
    return res.status(402).json({ error: `Your plan allows ${plan.rules} rules` });
  }
  const err = validateRule(req.body);
  if (err) return res.status(400).json({ error: err });
  const x = run(`INSERT INTO rules (workspace_id, name, enabled, position, conditions_json, actions_json, stop_processing)
    VALUES (?,?,?,?,?,?,?)`, wsId(req), req.body.name, req.body.enabled === false ? 0 : 1, int(req.body.position) || 0,
  JSON.stringify(req.body.conditions), JSON.stringify(req.body.actions), req.body.stop_processing === false ? 0 : 1);
  res.json({ id: Number(x.lastInsertRowid) });
});
r.put('/rules/:id', manage, (req, res) => {
  const err = validateRule(req.body);
  if (err) return res.status(400).json({ error: err });
  run(`UPDATE rules SET name=?, enabled=?, position=?, conditions_json=?, actions_json=?, stop_processing=?
    WHERE id=? AND workspace_id=?`, req.body.name, req.body.enabled === false ? 0 : 1, int(req.body.position) || 0,
  JSON.stringify(req.body.conditions), JSON.stringify(req.body.actions), req.body.stop_processing === false ? 0 : 1,
  int(req.params.id), wsId(req));
  res.json({ ok: true });
});
r.patch('/rules/:id', manage, (req, res) => {
  const x = run('UPDATE rules SET enabled = ? WHERE id = ? AND workspace_id = ?', req.body.enabled ? 1 : 0, int(req.params.id), wsId(req));
  if (!x.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
r.post('/rules/reorder', manage, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(int) : [];
  ids.forEach((id, i) => run('UPDATE rules SET position = ? WHERE id = ? AND workspace_id = ?', i, id, wsId(req)));
  res.json({ ok: true });
});
r.delete('/rules/:id', manage, (req, res) => {
  run('DELETE FROM rules WHERE id=? AND workspace_id=?', int(req.params.id), wsId(req));
  res.json({ ok: true });
});

// ---------- Templates & knowledge base (simple CRUD) ----------
for (const [path, table, fields] of [['templates', 'templates', ['name', 'subject', 'body']], ['knowledge', 'knowledge', ['title', 'content']]]) {
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

// ---------- Workspace / AI settings ----------
const SETTINGS = ['name', 'business_name', 'business_description', 'reply_tone', 'signature', 'default_language',
  'business_hours', 'auto_send_min_confidence', 'style_guide', 'retention_days', 'privacy_shield', 'reply_delay_min',
  'reply_delay_max', 'followup_days', 'digest_enabled', 'digest_hour', 'timezone', 'telegram_chat_id', 'slack_webhook',
  'alert_on', 'booking_link', 'learn_from_edits', 'sensitive_topics', 'never_say', 'allowed_link_domains', 'hourly_rate',
  'ooo_until', 'ooo_message', 'sla_json', 'read_attachments', 'owner_language'];
const INT_SETTINGS = ['retention_days', 'privacy_shield', 'reply_delay_min', 'reply_delay_max', 'followup_days', 'digest_enabled', 'digest_hour', 'learn_from_edits', 'read_attachments'];
r.get('/settings', (req, res) => {
  const ws = one('SELECT * FROM workspaces WHERE id = ?', wsId(req));
  res.json(Object.fromEntries(SETTINGS.map((k) => [k, ws[k]])));
});
r.put('/settings', manage, (req, res) => {
  const ws = one('SELECT * FROM workspaces WHERE id = ?', wsId(req));
  const v = Object.fromEntries(SETTINGS.map((k) => [k, req.body[k] ?? ws[k]]));
  if (v.business_hours) {
    try { JSON.parse(v.business_hours); } catch { return res.status(400).json({ error: 'business_hours must be valid JSON' }); }
  }
  for (const k of INT_SETTINGS) v[k] = Math.max(0, Number.parseInt(v[k], 10) || 0);
  v.digest_hour = Math.min(23, v.digest_hour);
  if (v.reply_delay_max < v.reply_delay_min) v.reply_delay_max = v.reply_delay_min;
  if (v.slack_webhook && !/^https:\/\/hooks\.slack\.com\//.test(v.slack_webhook)) return res.status(400).json({ error: 'Slack webhook must start with https://hooks.slack.com/' });
  try { new Intl.DateTimeFormat('en', { timeZone: v.timezone || 'UTC' }); } catch { return res.status(400).json({ error: 'Unknown timezone' }); }
  v.timezone ||= 'UTC';
  v.hourly_rate = Math.max(0, Number(v.hourly_rate) || 0);
  v.sensitive_topics ??= '';
  v.owner_language ||= 'en';
  if (v.booking_link && !/^https:\/\//.test(v.booking_link)) return res.status(400).json({ error: 'Booking link must start with https://' });
  if (v.ooo_until && Number.isNaN(new Date(v.ooo_until).getTime())) return res.status(400).json({ error: 'Invalid out-of-office date' });
  try { const sla = JSON.parse(v.sla_json || '{}'); if (typeof sla !== 'object' || Array.isArray(sla)) throw new Error(); } catch { return res.status(400).json({ error: 'SLA must be JSON like {"urgent":60,"high":240,"normal":1440}' }); }
  for (const k of ['business_description', 'style_guide', 'signature', 'never_say', 'ooo_message', 'sensitive_topics']) if (v[k] != null) v[k] = String(v[k]).slice(0, 20000);
  v.alert_on ??= '';
  v.name ||= ws.name;
  v.reply_tone ||= 'friendly and professional';
  v.default_language ||= 'auto';
  v.auto_send_min_confidence = Math.max(0, Math.min(1, Number(v.auto_send_min_confidence)));
  run(`UPDATE workspaces SET ${SETTINGS.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...SETTINGS.map((k) => (v[k] === '' && !['alert_on', 'sensitive_topics'].includes(k) ? null : v[k])), ws.id);
  res.json({ ok: true });
});

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
  run('UPDATE messages SET assigned_to = NULL WHERE workspace_id = ? AND assigned_to = ?', wsId(req), uid);
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
  run('UPDATE messages SET assigned_to = NULL WHERE workspace_id = ? AND assigned_to = ?', wsId(req), req.user.id);
  // Never leave someone without a workspace: give them a fresh personal one (on the free trial).
  if (!one('SELECT 1 AS x FROM workspace_members WHERE user_id = ?', req.user.id)) {
    const w = run('INSERT INTO workspaces (name, owner_id, business_name, trial_ends_at, webhook_secret) VALUES (?,?,?,?,?)',
      `${req.user.name || req.user.email.split('@')[0]}'s workspace`, req.user.id, '', new Date(Date.now() + getNum('trial_days') * 86400_000).toISOString(), randomToken(24));
    run('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)', Number(w.lastInsertRowid), req.user.id, 'owner');
  }
  run('UPDATE users SET current_workspace_id = NULL WHERE id = ?', req.user.id);
  res.json({ ok: true });
});
r.delete('/workspace', owner, async (req, res) => {
  if (str(req.body.confirm, 200).trim() !== req.workspace.name) return res.status(400).json({ error: 'Type the workspace name to confirm' });
  const owned = one('SELECT COUNT(*) AS n FROM workspace_members WHERE user_id = ?', req.user.id).n;
  if (owned < 2) return res.status(400).json({ error: "This is your only workspace — delete your account instead (Security & privacy)" });
  for (const mb of all('SELECT * FROM mailboxes WHERE workspace_id = ?', wsId(req))) await revokeMailboxGrant(mb).catch(() => {});
  run('UPDATE replies SET approved_by = NULL WHERE workspace_id = ?', wsId(req));
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
    AND type IN ('sync_error','send_failed','phishing_blocked','sla_breach','payment_failed','followup_drafted','draft_created','auto_reply_sent','mailbox_added','subscription_updated','assigned')
    ORDER BY id DESC LIMIT 30`, seen, wsId(req));
  res.json(items);
});
r.post('/notifications/seen', (req, res) => {
  run(`UPDATE users SET notifications_seen_at = datetime('now') WHERE id = ?`, req.user.id);
  res.json({ ok: true });
});

// ---------- Contacts (CRM-lite, built automatically from email) ----------
r.get('/contacts', (req, res) => {
  const where = ['workspace_id = ?'];
  const params = [wsId(req)];
  if (req.query.q) { where.push('(email LIKE ? OR name LIKE ? OR company LIKE ? OR tags LIKE ?)'); const q = `%${req.query.q}%`; params.push(q, q, q, q); }
  if (req.query.vip) where.push('vip = 1');
  if (req.query.blocked) where.push('blocked = 1');
  const order = req.query.sort === 'lead' ? 'COALESCE(lead_score,0) DESC' : 'last_seen DESC';
  res.json(all(`SELECT * FROM contacts WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 300`, ...params));
});
r.get('/contacts/:id', (req, res) => {
  const c = one('SELECT * FROM contacts WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.messages = all(`SELECT id, subject, summary, category, priority, sentiment, status, received_at, lead_score FROM messages
    WHERE contact_id = ? ORDER BY received_at DESC LIMIT 100`, c.id);
  res.json(c);
});
r.put('/contacts/:id', (req, res) => {
  const c = one('SELECT * FROM contacts WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!c) return res.status(404).json({ error: 'Not found' });
  const v = (k) => (req.body[k] === undefined ? c[k] : req.body[k]);
  run('UPDATE contacts SET name=?, company=?, phone=?, tags=?, notes=?, vip=?, blocked=?, do_not_contact=? WHERE id=?',
    str(v('name'), 200), str(v('company'), 200), str(v('phone'), 50), str(v('tags'), 500), str(v('notes'), 5000),
    v('vip') ? 1 : 0, v('blocked') ? 1 : 0, v('do_not_contact') ? 1 : 0, c.id);
  res.json({ ok: true });
});
r.post('/contacts', (req, res) => {
  const email = str(req.body.email, 254).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (one('SELECT id FROM contacts WHERE workspace_id = ? AND email = ?', wsId(req), email)) return res.status(409).json({ error: 'Contact already exists' });
  const x = run('INSERT INTO contacts (workspace_id, email, name, company, phone, tags, notes, vip, emails_in) VALUES (?,?,?,?,?,?,?,?,0)',
    wsId(req), email, str(req.body.name, 200), str(req.body.company, 200), str(req.body.phone, 50), str(req.body.tags, 500), str(req.body.notes, 5000), req.body.vip ? 1 : 0);
  res.json({ id: Number(x.lastInsertRowid) });
});
r.delete('/contacts/:id', manage, (req, res) => {
  const c = one('SELECT id FROM contacts WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!c) return res.status(404).json({ error: 'Not found' });
  run('UPDATE messages SET contact_id = NULL WHERE contact_id = ?', c.id);
  run('DELETE FROM contacts WHERE id = ?', c.id);
  res.json({ ok: true });
});
r.get('/contacts.csv', (req, res) => {
  const rows = all('SELECT email, name, company, phone, tags, lead_score, last_sentiment, vip, emails_in, emails_out, first_seen, last_seen FROM contacts WHERE workspace_id = ?', wsId(req));
  const cols = Object.keys(rows[0] || { email: '' });
  const csv = [cols.join(','), ...rows.map((r0) => cols.map((c) => `"${String(r0[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  res.setHeader('content-type', 'text/csv');
  res.setHeader('content-disposition', 'attachment; filename="contacts.csv"');
  res.send(csv);
});

// ---------- AI tools ----------
r.post('/ai/ask', async (req, res) => {
  if (!aiEnabled()) return res.status(400).json({ error: 'AI is not configured on this server' });
  const plan = effectivePlan(req.workspace);
  if (plan.key === 'expired') return res.status(402).json({ error: 'Your plan is inactive' });
  const question = String(req.body.question || '').slice(0, 1000);
  if (!question) return res.status(400).json({ error: 'Ask a question' });
  // Retrieve candidates: keyword matches first, then most recent mail.
  const words = question.toLowerCase().match(/[\p{L}\p{N}@.]{3,}/gu)?.filter((w) => !['what', 'when', 'who', 'did', 'the', 'and', 'from', 'about', 'with', 'have', 'which', 'this', 'that', 'last', 'week'].includes(w)).slice(0, 8) || [];
  const byWords = words.length ? all(`SELECT m.*, mb.email AS mailbox_email FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
    WHERE m.workspace_id = ? AND (${words.map(() => '(m.subject LIKE ? OR m.summary LIKE ? OR m.intent LIKE ? OR m.from_email LIKE ? OR m.from_name LIKE ?)').join(' OR ')})
    ORDER BY m.received_at DESC LIMIT 25`, wsId(req), ...words.flatMap((w) => Array(5).fill(`%${w}%`))) : [];
  const recent = all(`SELECT m.*, mb.email AS mailbox_email FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
    WHERE m.workspace_id = ? AND m.is_automated = 0 ORDER BY m.received_at DESC LIMIT 20`, wsId(req));
  const seen = new Set();
  const ctx = [...byWords, ...recent].filter((m) => !seen.has(m.id) && seen.add(m.id)).slice(0, 35).map(openMessage);
  if (!ctx.length) return res.json({ answer: 'There are no emails to search yet.', sources: [] });
  const answer = await askInbox(req.workspace, question, ctx);
  const cited = [...answer.matchAll(/#(\d+)/g)].map((x) => Number(x[1]));
  res.json({ answer, sources: ctx.filter((m) => cited.includes(m.id)).map((m) => ({ id: m.id, subject: m.subject, from: m.from_email })) });
});

r.post('/ai/learn-style', manage, async (req, res) => {
  if (!aiEnabled()) return res.status(400).json({ error: 'AI is not configured on this server' });
  const mb = one('SELECT * FROM mailboxes WHERE id = ? AND workspace_id = ?', int(req.body.mailbox_id), wsId(req));
  if (!mb) return res.status(404).json({ error: 'Choose a connected mailbox' });
  const samples = await fetchSentSamples(mb, 25);
  if (samples.length < 3) return res.status(400).json({ error: `Found only ${samples.length} sent emails in this account — need at least 3.` });
  const guide = await learnStyle(req.workspace, samples);
  run('UPDATE workspaces SET style_guide = ? WHERE id = ?', guide, wsId(req));
  res.json({ style_guide: guide, samples: samples.length });
});

r.get('/ai/corrections', (req, res) => res.json(all('SELECT * FROM corrections WHERE workspace_id = ? ORDER BY id DESC LIMIT 50', wsId(req))
  .map((c) => ({ ...c, ai_draft: open(c.workspace_id, 'corrections.ai_draft', c.ai_draft), final_text: open(c.workspace_id, 'corrections.final_text', c.final_text) }))));

// Transparency: every time the AI saw one of your emails.
r.get('/ai/log', (req, res) => res.json(all(`SELECT l.id, l.message_id, l.purpose, l.model, l.input_tokens, l.output_tokens, l.redactions, l.created_at, m.subject
  FROM ai_log l LEFT JOIN messages m ON m.id = l.message_id WHERE l.workspace_id = ? ORDER BY l.id DESC LIMIT 200`, wsId(req))));
r.delete('/ai/corrections/:id', manage, (req, res) => {
  run('DELETE FROM corrections WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  res.json({ ok: true });
});

// Import FAQ/pricing text from the customer's own website into the knowledge base.
r.post('/knowledge/import-url', manage, async (req, res) => {
  const url = String(req.body.url || '');
  let resp;
  try { resp = await safeFetch(url, { headers: { 'user-agent': 'KnowledgeImporter/1.0' } }); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!resp.ok) return res.status(400).json({ error: `Could not fetch page (${resp.status})` });
  const html = resp.text().slice(0, 2_000_000);
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || url).trim().slice(0, 150);
  const text = html.replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, 20000);
  if (text.length < 50) return res.status(400).json({ error: 'No readable text found on that page' });
  const x = run('INSERT INTO knowledge (workspace_id, title, content) VALUES (?,?,?)', wsId(req), `${title} (${url})`, text);
  res.json({ id: Number(x.lastInsertRowid), chars: text.length });
});

// ---------- Analytics ----------
r.get('/analytics', (req, res) => {
  const id = wsId(req);
  const days = Math.min(Math.max(int(req.query.days) || 30, 1), 365);
  const since = `-${days} days`;
  const totals = one(`SELECT COUNT(*) AS received, SUM(status='replied') AS replied, SUM(status='ignored') AS filtered,
      SUM(is_automated) AS automated, SUM(is_phishing) AS phishing, AVG(first_response_sec) AS avg_response_sec,
      SUM(lead_score >= 70) AS hot_leads FROM messages WHERE workspace_id = ? AND datetime(received_at) > datetime('now', ?)`, id, since);
  const bySource = all(`SELECT r.source, COUNT(*) AS n, SUM(r.approved_by IS NULL) AS autopilot FROM replies r
      WHERE r.workspace_id = ? AND r.status = 'sent' AND r.sent_at > datetime('now', ?) GROUP BY r.source`, id, since);
  const byMailbox = all(`SELECT mb.email, COUNT(m.id) AS received, SUM(m.status='replied') AS replied FROM mailboxes mb
      LEFT JOIN messages m ON m.mailbox_id = mb.id AND datetime(m.received_at) > datetime('now', ?) WHERE mb.workspace_id = ? GROUP BY mb.id`, since, id);
  const byHour = all(`SELECT CAST(strftime('%H', received_at) AS INTEGER) AS hour, COUNT(*) AS n FROM messages
      WHERE workspace_id = ? AND datetime(received_at) > datetime('now', ?) GROUP BY hour ORDER BY hour`, id, since);
  const bySentiment = all(`SELECT sentiment, COUNT(*) AS n FROM messages WHERE workspace_id = ? AND sentiment IS NOT NULL
      AND datetime(received_at) > datetime('now', ?) GROUP BY sentiment`, id, since);
  const topSenders = all(`SELECT from_email, MAX(from_name) AS name, COUNT(*) AS n FROM messages WHERE workspace_id = ? AND is_automated = 0
      AND datetime(received_at) > datetime('now', ?) GROUP BY from_email ORDER BY n DESC LIMIT 10`, id, since);
  const byCategory = all(`SELECT category, COUNT(*) AS n FROM messages WHERE workspace_id = ? AND category IS NOT NULL
      AND datetime(received_at) > datetime('now', ?) GROUP BY category ORDER BY n DESC`, id, since);
  const corrections = one('SELECT COUNT(*) AS n FROM corrections WHERE workspace_id = ?', id).n;
  const acc = one(`SELECT COUNT(*) AS n, SUM(edited = 0) AS unedited FROM replies WHERE workspace_id = ? AND status = 'sent' AND edited IS NOT NULL AND sent_at > datetime('now', ?)`, id, since);
  const guardHolds = one(`SELECT COUNT(*) AS n FROM replies WHERE workspace_id = ? AND guard_json IS NOT NULL AND created_at > datetime('now', ?)`, id, since).n;
  const sla = one(`SELECT COUNT(*) AS due, SUM(first_response_sec IS NOT NULL) AS answered FROM messages WHERE workspace_id = ? AND sla_due_at IS NOT NULL AND datetime(received_at) > datetime('now', ?)`, id, since);
  const autoSent = bySource.reduce((a, x) => a + (x.autopilot || 0), 0);
  res.json({ days, totals, bySource, byMailbox, byHour, bySentiment, topSenders, byCategory, corrections, guardHolds,
    aiAccuracy: acc.n ? Math.round((acc.unedited / acc.n) * 100) : null, overdueNow: sla.due - (sla.answered || 0),
    moneySaved: Math.round(((((totals.replied || 0) * 4) + ((totals.filtered || 0) * 0.5)) / 60) * (req.workspace.hourly_rate || 0)),
    automationRate: totals.received ? Math.round(((autoSent + (totals.filtered || 0)) / totals.received) * 100) : 0,
    hoursSaved: Math.round((((totals.replied || 0) * 4) + ((totals.filtered || 0) * 0.5)) / 6) / 10 });
});

// ---------- Integrations: API keys + alert tests ----------
r.get('/api-keys', manage, (req, res) => res.json(all('SELECT id, name, prefix, last_used_at, created_at FROM api_keys WHERE workspace_id = ?', wsId(req))));
r.post('/api-keys', manage, (req, res) => {
  if (req.viaApiKey) return res.status(403).json({ error: 'Use the dashboard to create API keys' });
  const key = `mp_live_${randomToken(24)}`;
  run('INSERT INTO api_keys (workspace_id, name, prefix, key_hash) VALUES (?,?,?,?)', wsId(req), str(req.body.name || 'API key', 80), key.slice(0, 14), sha256(key));
  securityEvent(req, 'api_key_created', { name: str(req.body.name, 80) });
  res.json({ key }); // shown once
});
r.delete('/api-keys/:id', manage, (req, res) => {
  securityEvent(req, 'api_key_revoked', { id: int(req.params.id) });
  run('DELETE FROM api_keys WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  res.json({ ok: true });
});
r.get('/integrations/webhook-secret', manage, (req, res) => res.json({ secret: one('SELECT webhook_secret FROM workspaces WHERE id = ?', wsId(req)).webhook_secret }));
r.post('/integrations/webhook-secret/rotate', manage, (req, res) => {
  const secret = randomToken(24);
  run('UPDATE workspaces SET webhook_secret = ? WHERE id = ?', secret, wsId(req));
  securityEvent(req, 'webhook_secret_rotated');
  res.json({ secret });
});
r.post('/integrations/webhook-test', manage, async (req, res) => {
  const ws = one('SELECT * FROM workspaces WHERE id = ?', wsId(req));
  try {
    await deliverWebhook(ws, String(req.body.url || ''), { event: 'test', message: { subject: 'Test from your email assistant' } });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

r.post('/integrations/test', manage, async (req, res) => {
  const ws = one('SELECT * FROM workspaces WHERE id = ?', wsId(req));
  const text = `✅ Test alert from your email assistant (${ws.name}). Alerts are working!`;
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

// ---------- Declutter: newsletters & automated senders, one-click unsubscribe ----------
r.get('/declutter', (req, res) => {
  res.json(all(`SELECT from_email, MAX(from_name) AS name, COUNT(*) AS n, MAX(received_at) AS last, MAX(list_unsubscribe) AS unsubscribe,
      MAX(list_unsubscribe_post) AS one_click, MAX(c.blocked) AS blocked
    FROM messages m LEFT JOIN contacts c ON c.workspace_id = m.workspace_id AND c.email = m.from_email
    WHERE m.workspace_id = ? AND (m.is_automated = 1 OR m.category IN ('newsletter','notification','spam'))
    GROUP BY from_email ORDER BY n DESC LIMIT 200`, wsId(req)));
});
r.post('/declutter/unsubscribe', manage, async (req, res) => {
  const from = str(req.body.from_email, 254).toLowerCase();
  const row = one(`SELECT m.*, mb.id AS mbid FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id WHERE m.workspace_id = ? AND m.from_email = ?
    AND m.list_unsubscribe IS NOT NULL ORDER BY m.id DESC LIMIT 1`, wsId(req), from);
  // Always block locally so future mail from this sender is filtered, even if the sender ignores the request.
  run(`INSERT INTO contacts (workspace_id, email, blocked) VALUES (?,?,1) ON CONFLICT(workspace_id, email) DO UPDATE SET blocked = 1`, wsId(req), from);
  if (!row) return res.json({ ok: true, method: 'blocked' });
  try {
    if (row.list_unsubscribe.startsWith('https://') && row.list_unsubscribe_post) {
      // RFC 8058 one-click unsubscribe.
      await safeFetch(row.list_unsubscribe, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }, { maxBytes: 200_000 });
      return res.json({ ok: true, method: 'one-click' });
    }
    if (row.list_unsubscribe.startsWith('mailto:')) {
      const u = new URL(row.list_unsubscribe);
      const mb = one('SELECT * FROM mailboxes WHERE id = ?', row.mbid);
      await sendNew(mb, { to: u.pathname, subject: u.searchParams.get('subject') || 'unsubscribe', body: 'unsubscribe' });
      return res.json({ ok: true, method: 'email' });
    }
    return res.json({ ok: true, method: 'blocked', link: row.list_unsubscribe });
  } catch (e) {
    return res.json({ ok: true, method: 'blocked', warning: `Sender blocked; unsubscribe request failed: ${e.message}` });
  }
});

export default r;
