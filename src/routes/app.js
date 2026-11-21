import { Router } from 'express';
import { one, all, run, getUsage, logActivity, audit } from '../db.js';
import { requireRole } from '../auth.js';
import { encrypt } from '../crypto.js';
import { effectivePlan } from '../plans.js';
import { PROVIDERS, guessProvider } from '../services/providers.js';
import { testConnection } from '../services/mail.js';
import { syncMailbox } from '../services/worker.js';
import { processMessage, sendStoredReply, recordCorrection, assertPublicUrl } from '../services/processor.js';
import { fetchSentSamples } from '../services/mail.js';
import { askInbox, learnStyle } from '../services/ai.js';
import { sendTelegram, sendSlack, notifyAdmins } from '../services/notify.js';
import { oauthAvailability } from '../services/oauth.js';
import { sha256 } from '../auth.js';
import { randomToken } from '../crypto.js';
import { getBool, getNum, appUrl } from '../settings.js';
import { validateRule, FIELDS, OPS, ACTIONS } from '../services/rules.js';
import { aiEnabled, analyzeEmail, CATEGORIES } from '../services/ai.js';

const r = Router();
const manage = requireRole('owner', 'admin');
const wsId = (req) => req.workspace.id;
const int = (v) => Number.parseInt(v, 10);

// ---------- Dashboard ----------
r.get('/dashboard', (req, res) => {
  const id = wsId(req);
  const counts = one(`SELECT
      COUNT(*) AS total,
      SUM(status='drafted') AS awaiting_approval,
      SUM(status='replied') AS replied,
      SUM(status='ignored') AS ignored,
      SUM(priority='urgent') AS urgent,
      SUM(received_at > datetime('now','-1 day')) AS last24h
    FROM messages WHERE workspace_id = ?`, id);
  const byCategory = all(`SELECT category, COUNT(*) AS n FROM messages WHERE workspace_id = ? AND category IS NOT NULL
      AND received_at > datetime('now','-30 days') GROUP BY category ORDER BY n DESC`, id);
  const daily = all(`SELECT substr(received_at,1,10) AS day, COUNT(*) AS received,
      SUM(status='replied') AS replied FROM messages WHERE workspace_id = ? AND received_at > datetime('now','-14 days')
      GROUP BY day ORDER BY day`, id);
  const activity = all('SELECT * FROM activity WHERE workspace_id = ? ORDER BY id DESC LIMIT 15', id);
  const hotLeads = all(`SELECT id, from_name, from_email, subject, intent, lead_score, status FROM messages
    WHERE workspace_id = ? AND lead_score >= 70 AND received_at > datetime('now','-14 days') ORDER BY lead_score DESC, id DESC LIMIT 6`, id);
  const scheduled = one(`SELECT COUNT(*) AS n FROM replies WHERE workspace_id = ? AND status = 'scheduled'`, id).n;
  const plan = effectivePlan(req.workspace);
  res.json({ counts, byCategory, daily, activity, hotLeads, scheduled, usage: getUsage(id), plan, aiEnabled: aiEnabled(),
    emailVerified: Boolean(req.user.email_verified),
    mailboxes: one('SELECT COUNT(*) AS n FROM mailboxes WHERE workspace_id = ?', id).n,
    // Time saved estimate: ~4 minutes per handled email.
    minutesSaved: (counts.replied || 0) * 4 + (counts.ignored || 0) * 0.5 });
});

// ---------- Mailboxes ----------
r.get('/providers', (req, res) => res.json({ presets: PROVIDERS, oauth: oauthAvailability() }));

r.get('/mailboxes', (req, res) => {
  res.json(all(`SELECT id, label, email, provider, imap_host, imap_port, smtp_host, smtp_port, username, mode, enabled,
      last_sync_at, last_error, created_at, auth_type, signature,
      (SELECT COUNT(*) FROM messages m WHERE m.mailbox_id = mailboxes.id) AS message_count FROM mailboxes WHERE workspace_id = ? ORDER BY id`, wsId(req)));
});

r.post('/mailboxes', manage, async (req, res) => {
  if (getBool('require_email_verification') && !req.user.email_verified) return res.status(403).json({ error: 'Please verify your email address first (check your inbox).' });
  const plan = effectivePlan(req.workspace);
  const count = one('SELECT COUNT(*) AS n FROM mailboxes WHERE workspace_id = ?', wsId(req)).n;
  if (count >= plan.mailboxes) return res.status(402).json({ error: `Your ${plan.name} plan allows ${plan.mailboxes} mailbox(es). Upgrade to add more.` });

  const email = String(req.body.email || '').trim().toLowerCase();
  const provider = req.body.provider || guessProvider(email);
  const preset = PROVIDERS[provider] || PROVIDERS.custom;
  const mb = {
    email, provider, label: req.body.label || '',
    imap_host: req.body.imap_host || preset.imap_host, imap_port: int(req.body.imap_port) || preset.imap_port,
    imap_secure: req.body.imap_secure ?? preset.imap_secure,
    smtp_host: req.body.smtp_host || preset.smtp_host, smtp_port: int(req.body.smtp_port) || preset.smtp_port,
    smtp_secure: req.body.smtp_secure ?? preset.smtp_secure,
    username: req.body.username || email,
    mode: ['off', 'draft', 'auto'].includes(req.body.mode) ? req.body.mode : 'draft',
  };
  if (!email || !req.body.password || !mb.imap_host || !mb.smtp_host) return res.status(400).json({ error: 'Email, password, IMAP host and SMTP host are required' });

  if (!req.body.skipTest) {
    try { await testConnection(mb, req.body.password); } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  try {
    const result = run(`INSERT INTO mailboxes (workspace_id, label, email, provider, imap_host, imap_port, imap_secure,
        smtp_host, smtp_port, smtp_secure, username, password_enc, mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      wsId(req), mb.label, mb.email, mb.provider, mb.imap_host, mb.imap_port, mb.imap_secure ? 1 : 0,
      mb.smtp_host, mb.smtp_port, mb.smtp_secure ? 1 : 0, mb.username, encrypt(req.body.password), mb.mode);
    logActivity(wsId(req), 'mailbox_added', { email });
    const id = Number(result.lastInsertRowid);
    syncMailbox(id).catch(() => {});
    res.json({ id });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return res.status(409).json({ error: 'This mailbox is already connected' });
    throw e;
  }
});

r.patch('/mailboxes/:id', manage, (req, res) => {
  const mb = one('SELECT * FROM mailboxes WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!mb) return res.status(404).json({ error: 'Not found' });
  const mode = ['off', 'draft', 'auto'].includes(req.body.mode) ? req.body.mode : mb.mode;
  const enabled = req.body.enabled === undefined ? mb.enabled : (req.body.enabled ? 1 : 0);
  const label = req.body.label ?? mb.label;
  const signature = req.body.signature ?? mb.signature;
  run('UPDATE mailboxes SET mode=?, enabled=?, label=?, signature=? WHERE id=?', mode, enabled, label, signature, mb.id);
  if (req.body.password) run('UPDATE mailboxes SET password_enc=?, last_error=NULL WHERE id=?', encrypt(req.body.password), mb.id);
  res.json({ ok: true });
});

r.delete('/mailboxes/:id', manage, (req, res) => {
  run('DELETE FROM mailboxes WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  res.json({ ok: true });
});

r.post('/mailboxes/:id/sync', async (req, res) => {
  const mb = one('SELECT id FROM mailboxes WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!mb) return res.status(404).json({ error: 'Not found' });
  res.json(await syncMailbox(mb.id));
});

// ---------- Messages (unified inbox) ----------
r.get('/messages', (req, res) => {
  const where = ['m.workspace_id = ?'];
  const params = [wsId(req)];
  if (req.query.starred) where.push('m.starred = 1');
  if (req.query.contact_id) { where.push('m.contact_id = ?'); params.push(req.query.contact_id); }
  if (req.query.min_lead) { where.push('m.lead_score >= ?'); params.push(Number(req.query.min_lead)); }
  for (const f of ['status', 'category', 'priority', 'mailbox_id']) {
    if (req.query[f]) { where.push(`m.${f} = ?`); params.push(req.query[f]); }
  }
  if (req.query.q) {
    where.push('(m.subject LIKE ? OR m.from_email LIKE ? OR m.from_name LIKE ? OR m.summary LIKE ?)');
    const q = `%${req.query.q}%`; params.push(q, q, q, q);
  }
  const limit = Math.min(int(req.query.limit) || 50, 200);
  const offset = int(req.query.offset) || 0;
  res.json(all(`SELECT m.id, m.mailbox_id, mb.email AS mailbox_email, m.from_name, m.from_email, m.subject, m.summary,
      m.category, m.priority, m.sentiment, m.language, m.status, m.received_at, m.confidence, m.lead_score, m.intent, m.starred, m.is_phishing
    FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
    WHERE ${where.join(' AND ')} ORDER BY m.received_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset));
});

r.get('/messages/:id', (req, res) => {
  const m = one(`SELECT m.*, mb.email AS mailbox_email FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
    WHERE m.id = ? AND m.workspace_id = ?`, int(req.params.id), wsId(req));
  if (!m) return res.status(404).json({ error: 'Not found' });
  delete m.headers_json;
  m.extracted = m.extracted_json ? JSON.parse(m.extracted_json) : {};
  m.replies = all('SELECT * FROM replies WHERE message_id = ? ORDER BY id', m.id);
  m.contact = m.contact_id ? one('SELECT * FROM contacts WHERE id = ?', m.contact_id) : null;
  res.json(m);
});

r.post('/messages/:id/star', (req, res) => {
  run('UPDATE messages SET starred = ? WHERE id = ? AND workspace_id = ?', req.body.starred ? 1 : 0, int(req.params.id), wsId(req));
  res.json({ ok: true });
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
  const m = one('SELECT * FROM messages WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (!aiEnabled()) return res.status(400).json({ error: 'AI is not configured on this server' });
  const result = await analyzeEmail(req.workspace, m, String(req.body.instructions || ''));
  const r2 = run(`INSERT INTO replies (workspace_id, message_id, subject, body, source, ai_original) VALUES (?,?,?,?, 'ai', ?)`,
    wsId(req), m.id, result.reply_subject, result.reply_body, result.reply_body);
  run(`UPDATE messages SET status='drafted' WHERE id=?`, m.id);
  res.json({ id: Number(r2.lastInsertRowid), subject: result.reply_subject, body: result.reply_body });
});

// Manual reply composed by a human.
r.post('/messages/:id/reply', async (req, res) => {
  const m = one('SELECT id FROM messages WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!m || !req.body.body) return res.status(400).json({ error: 'Message and body required' });
  const r2 = run(`INSERT INTO replies (workspace_id, message_id, subject, body, source) VALUES (?,?,?,?, 'manual')`,
    wsId(req), m.id, req.body.subject || '', req.body.body);
  await sendStoredReply(Number(r2.lastInsertRowid), req.user.id);
  res.json({ ok: true });
});

// ---------- Approval queue ----------
r.get('/replies', (req, res) => {
  const status = req.query.status || 'pending';
  if (status === 'queue') {
    return res.json(all(`SELECT r.*, m.from_name, m.from_email, m.subject AS original_subject, m.summary, m.category, m.priority,
      m.text_body AS original_body, m.reasoning, m.lead_score, mb.email AS mailbox_email
      FROM replies r JOIN messages m ON m.id = r.message_id JOIN mailboxes mb ON mb.id = m.mailbox_id
      WHERE r.workspace_id = ? AND r.status IN ('pending','scheduled','failed') ORDER BY r.status = 'scheduled' DESC, r.id DESC LIMIT 100`, wsId(req)));
  }
  res.json(all(`SELECT r.*, m.from_name, m.from_email, m.subject AS original_subject, m.summary, m.category, m.priority,
      m.text_body AS original_body, mb.email AS mailbox_email
    FROM replies r JOIN messages m ON m.id = r.message_id JOIN mailboxes mb ON mb.id = m.mailbox_id
    WHERE r.workspace_id = ? AND r.status = ? ORDER BY r.id DESC LIMIT 100`, wsId(req), status));
});

r.post('/replies/:id/approve', async (req, res) => {
  const reply = one('SELECT * FROM replies WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!reply) return res.status(404).json({ error: 'Not found' });
  if (req.body.body) {
    run('UPDATE replies SET body=?, subject=? WHERE id=?', req.body.body, req.body.subject ?? reply.subject, reply.id);
    const ws = one('SELECT learn_from_edits FROM workspaces WHERE id = ?', wsId(req));
    if (ws.learn_from_edits) recordCorrection(reply, req.body.body);
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
  'alert_on', 'booking_link', 'learn_from_edits'];
const INT_SETTINGS = ['retention_days', 'privacy_shield', 'reply_delay_min', 'reply_delay_max', 'followup_days', 'digest_enabled', 'digest_hour', 'learn_from_edits'];
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
  v.alert_on ??= '';
  v.name ||= ws.name;
  v.reply_tone ||= 'friendly and professional';
  v.default_language ||= 'auto';
  v.auto_send_min_confidence = Math.max(0, Math.min(1, Number(v.auto_send_min_confidence)));
  run(`UPDATE workspaces SET ${SETTINGS.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...SETTINGS.map((k) => (v[k] === '' && !['alert_on'].includes(k) ? null : v[k])), ws.id);
  res.json({ ok: true });
});

// ---------- Team ----------
r.get('/team', (req, res) => {
  res.json(all(`SELECT u.id, u.email, u.name, wm.role FROM workspace_members wm JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ?`, wsId(req)));
});
r.post('/team', manage, (req, res) => {
  const plan = effectivePlan(req.workspace);
  if (one('SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?', wsId(req)).n >= plan.teamMembers) {
    return res.status(402).json({ error: `Your plan allows ${plan.teamMembers} team member(s)` });
  }
  const u = one('SELECT id FROM users WHERE email = ?', String(req.body.email || '').toLowerCase());
  if (!u) return res.status(404).json({ error: 'Ask your teammate to sign up first, then add them by email' });
  // New sign-ups get a personal workspace. If it's still empty, fold the user into this team instead.
  const own = one(`SELECT w.id FROM workspaces w WHERE w.owner_id = ?
      AND NOT EXISTS (SELECT 1 FROM mailboxes WHERE workspace_id = w.id)
      AND (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) = 1
      AND w.plan = 'trial'`, u.id);
  const memberships = one('SELECT COUNT(*) AS n FROM workspace_members WHERE user_id = ?', u.id).n;
  if (memberships > (own ? 1 : 0)) return res.status(409).json({ error: 'User already belongs to another active workspace' });
  if (own) run('DELETE FROM workspaces WHERE id = ?', own.id);
  run('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)', wsId(req), u.id, req.body.role === 'admin' ? 'admin' : 'member');
  res.json({ ok: true });
});
r.delete('/team/:userId', manage, (req, res) => {
  if (int(req.params.userId) === req.workspace.owner_id) return res.status(400).json({ error: 'Cannot remove the owner' });
  run('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?', wsId(req), int(req.params.userId));
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
  run('UPDATE contacts SET name=?, company=?, phone=?, tags=?, notes=?, vip=?, blocked=? WHERE id=?',
    v('name'), v('company'), v('phone'), v('tags'), v('notes'), v('vip') ? 1 : 0, v('blocked') ? 1 : 0, c.id);
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
    WHERE m.workspace_id = ? AND (${words.map(() => '(m.subject LIKE ? OR m.text_body LIKE ? OR m.from_email LIKE ? OR m.from_name LIKE ?)').join(' OR ')})
    ORDER BY m.received_at DESC LIMIT 25`, wsId(req), ...words.flatMap((w) => Array(4).fill(`%${w}%`))) : [];
  const recent = all(`SELECT m.*, mb.email AS mailbox_email FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
    WHERE m.workspace_id = ? AND m.is_automated = 0 ORDER BY m.received_at DESC LIMIT 20`, wsId(req));
  const seen = new Set();
  const ctx = [...byWords, ...recent].filter((m) => !seen.has(m.id) && seen.add(m.id)).slice(0, 35);
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

r.get('/ai/corrections', (req, res) => res.json(all('SELECT * FROM corrections WHERE workspace_id = ? ORDER BY id DESC LIMIT 50', wsId(req))));
r.delete('/ai/corrections/:id', manage, (req, res) => {
  run('DELETE FROM corrections WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  res.json({ ok: true });
});

// Import FAQ/pricing text from the customer's own website into the knowledge base.
r.post('/knowledge/import-url', manage, async (req, res) => {
  const url = String(req.body.url || '');
  try { await assertPublicUrl(url); } catch (e) { return res.status(400).json({ error: e.message }); }
  const resp = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'KnowledgeImporter/1.0' } });
  if (!resp.ok) return res.status(400).json({ error: `Could not fetch page (${resp.status})` });
  const html = (await resp.text()).slice(0, 2_000_000);
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
      SUM(lead_score >= 70) AS hot_leads FROM messages WHERE workspace_id = ? AND received_at > datetime('now', ?)`, id, since);
  const bySource = all(`SELECT r.source, COUNT(*) AS n, SUM(r.approved_by IS NULL) AS autopilot FROM replies r
      WHERE r.workspace_id = ? AND r.status = 'sent' AND r.sent_at > datetime('now', ?) GROUP BY r.source`, id, since);
  const byMailbox = all(`SELECT mb.email, COUNT(m.id) AS received, SUM(m.status='replied') AS replied FROM mailboxes mb
      LEFT JOIN messages m ON m.mailbox_id = mb.id AND m.received_at > datetime('now', ?) WHERE mb.workspace_id = ? GROUP BY mb.id`, since, id);
  const byHour = all(`SELECT CAST(strftime('%H', received_at) AS INTEGER) AS hour, COUNT(*) AS n FROM messages
      WHERE workspace_id = ? AND received_at > datetime('now', ?) GROUP BY hour ORDER BY hour`, id, since);
  const bySentiment = all(`SELECT sentiment, COUNT(*) AS n FROM messages WHERE workspace_id = ? AND sentiment IS NOT NULL
      AND received_at > datetime('now', ?) GROUP BY sentiment`, id, since);
  const topSenders = all(`SELECT from_email, MAX(from_name) AS name, COUNT(*) AS n FROM messages WHERE workspace_id = ? AND is_automated = 0
      AND received_at > datetime('now', ?) GROUP BY from_email ORDER BY n DESC LIMIT 10`, id, since);
  const byCategory = all(`SELECT category, COUNT(*) AS n FROM messages WHERE workspace_id = ? AND category IS NOT NULL
      AND received_at > datetime('now', ?) GROUP BY category ORDER BY n DESC`, id, since);
  const corrections = one('SELECT COUNT(*) AS n FROM corrections WHERE workspace_id = ?', id).n;
  const autoSent = bySource.reduce((a, x) => a + (x.autopilot || 0), 0);
  res.json({ days, totals, bySource, byMailbox, byHour, bySentiment, topSenders, byCategory, corrections,
    automationRate: totals.received ? Math.round(((autoSent + (totals.filtered || 0)) / totals.received) * 100) : 0,
    hoursSaved: Math.round((((totals.replied || 0) * 4) + ((totals.filtered || 0) * 0.5)) / 6) / 10 });
});

// ---------- Integrations: API keys + alert tests ----------
r.get('/api-keys', manage, (req, res) => res.json(all('SELECT id, name, prefix, last_used_at, created_at FROM api_keys WHERE workspace_id = ?', wsId(req))));
r.post('/api-keys', manage, (req, res) => {
  if (req.viaApiKey) return res.status(403).json({ error: 'Use the dashboard to create API keys' });
  const key = `mp_live_${randomToken(24)}`;
  run('INSERT INTO api_keys (workspace_id, name, prefix, key_hash) VALUES (?,?,?,?)', wsId(req), String(req.body.name || 'API key'), key.slice(0, 14), sha256(key));
  res.json({ key }); // shown once
});
r.delete('/api-keys/:id', manage, (req, res) => {
  run('DELETE FROM api_keys WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  res.json({ ok: true });
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

export default r;
