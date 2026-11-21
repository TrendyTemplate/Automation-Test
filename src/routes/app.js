import { Router } from 'express';
import { one, all, run, getUsage, logActivity } from '../db.js';
import { requireRole } from '../auth.js';
import { encrypt } from '../crypto.js';
import { effectivePlan } from '../plans.js';
import { PROVIDERS, guessProvider } from '../services/providers.js';
import { testConnection } from '../services/mail.js';
import { syncMailbox } from '../services/worker.js';
import { processMessage, sendStoredReply } from '../services/processor.js';
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
  const plan = effectivePlan(req.workspace);
  res.json({ counts, byCategory, daily, activity, usage: getUsage(id), plan, aiEnabled: aiEnabled(),
    mailboxes: one('SELECT COUNT(*) AS n FROM mailboxes WHERE workspace_id = ?', id).n,
    // Time saved estimate: ~4 minutes per handled email.
    minutesSaved: (counts.replied || 0) * 4 + (counts.ignored || 0) * 0.5 });
});

// ---------- Mailboxes ----------
r.get('/providers', (req, res) => res.json(PROVIDERS));

r.get('/mailboxes', (req, res) => {
  res.json(all(`SELECT id, label, email, provider, imap_host, imap_port, smtp_host, smtp_port, username, mode, enabled,
      last_sync_at, last_error, created_at FROM mailboxes WHERE workspace_id = ? ORDER BY id`, wsId(req)));
});

r.post('/mailboxes', manage, async (req, res) => {
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
  run('UPDATE mailboxes SET mode=?, enabled=?, label=? WHERE id=?', mode, enabled, label, mb.id);
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
      m.category, m.priority, m.sentiment, m.language, m.status, m.received_at, m.confidence
    FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
    WHERE ${where.join(' AND ')} ORDER BY m.received_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset));
});

r.get('/messages/:id', (req, res) => {
  const m = one(`SELECT m.*, mb.email AS mailbox_email FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
    WHERE m.id = ? AND m.workspace_id = ?`, int(req.params.id), wsId(req));
  if (!m) return res.status(404).json({ error: 'Not found' });
  delete m.headers_json;
  m.replies = all('SELECT * FROM replies WHERE message_id = ? ORDER BY id', m.id);
  res.json(m);
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
  const r2 = run(`INSERT INTO replies (workspace_id, message_id, subject, body, source) VALUES (?,?,?,?, 'ai')`,
    wsId(req), m.id, result.reply_subject, result.reply_body);
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
  res.json(all(`SELECT r.*, m.from_name, m.from_email, m.subject AS original_subject, m.summary, m.category, m.priority,
      m.text_body AS original_body, mb.email AS mailbox_email
    FROM replies r JOIN messages m ON m.id = r.message_id JOIN mailboxes mb ON mb.id = m.mailbox_id
    WHERE r.workspace_id = ? AND r.status = ? ORDER BY r.id DESC LIMIT 100`, wsId(req), status));
});

r.post('/replies/:id/approve', async (req, res) => {
  const reply = one('SELECT * FROM replies WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!reply) return res.status(404).json({ error: 'Not found' });
  if (req.body.body) run('UPDATE replies SET body=?, subject=? WHERE id=?', req.body.body, req.body.subject ?? reply.subject, reply.id);
  try {
    await sendStoredReply(reply.id, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: `Send failed: ${e.message}` });
  }
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
  'business_hours', 'auto_send_min_confidence'];
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
  v.name ||= ws.name;
  v.reply_tone ||= 'friendly and professional';
  v.default_language ||= 'auto';
  v.auto_send_min_confidence = Math.max(0, Math.min(1, Number(v.auto_send_min_confidence)));
  run(`UPDATE workspaces SET ${SETTINGS.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...SETTINGS.map((k) => (v[k] === '' ? null : v[k])), ws.id);
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

export default r;
