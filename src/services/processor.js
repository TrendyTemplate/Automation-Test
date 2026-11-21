import dns from 'node:dns/promises';
import net from 'node:net';
import { one, all, run, bumpUsage, getUsage, logActivity } from '../db.js';
import { effectivePlan } from '../plans.js';
import { analyzeEmail, fallbackTriage, aiEnabled } from './ai.js';
import { isAutomatedEmail, recentlyRepliedTo, withinBusinessHours } from './safety.js';
import { ruleMatches } from './rules.js';
import { sendReply, forwardEmail, markSeen } from './mail.js';
import { sendTelegram, sendSlack } from './notify.js';
import { appUrl } from '../settings.js';

// Block webhooks to internal networks (SSRF protection).
export async function assertPublicUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('URL must use https');
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true });
  for (const { address } of addrs) {
    if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(address) ||
      /^(::1?$|f[cd]|fe80|::ffff:(10|127|192\.168|169\.254)\.)/i.test(address)) {
      throw new Error('Host resolves to a private address');
    }
  }
}

function upsertContact(wsId, email, name) {
  run(`INSERT INTO contacts (workspace_id, email, name, emails_in, last_seen) VALUES (?,?,?,1,datetime('now'))
       ON CONFLICT(workspace_id, email) DO UPDATE SET emails_in = emails_in + 1, last_seen = datetime('now'),
       name = COALESCE(NULLIF(contacts.name,''), excluded.name)`, wsId, email, name || '');
  return one('SELECT * FROM contacts WHERE workspace_id = ? AND email = ?', wsId, email);
}

/** Store a fetched message; returns the DB row id or null when it's a duplicate. */
export function storeMessage(mb, m) {
  const from = (m.reply_to || m.from_email || '').toLowerCase();
  const automated = isAutomatedEmail({ fromEmail: m.from_email, headers: m.headers }) || m.from_email === mb.email.toLowerCase();
  const res = run(
    `INSERT OR IGNORE INTO messages (workspace_id, mailbox_id, uid, message_id, in_reply_to, references_hdr,
       from_name, from_email, to_email, subject, text_body, received_at, headers_json, is_automated, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    mb.workspace_id, mb.id, m.uid, m.message_id, m.in_reply_to, m.references_hdr, m.from_name,
    from, m.to_email, m.subject, m.text_body, m.received_at,
    JSON.stringify(m.headers || {}), automated ? 1 : 0, m.firstSync ? 'ignored' : 'new',
  );
  if (!res.changes) return null;
  const id = Number(res.lastInsertRowid);
  if (!automated && from) {
    const c = upsertContact(mb.workspace_id, from, m.from_name);
    run('UPDATE messages SET contact_id = ? WHERE id = ?', c.id, id);
  }
  return id;
}

function threadContext(msg) {
  const base = (msg.subject || '').replace(/^(re|fwd?|aw|sv):\s*/gi, '').trim();
  if (!base) return [];
  const prev = all(
    `SELECT m.text_body AS body, 'customer' AS direction, m.received_at AS at FROM messages m
      WHERE m.workspace_id = ? AND m.from_email = ? AND m.id != ? AND m.subject LIKE ?
     UNION ALL
     SELECT r.body, 'us', r.sent_at FROM replies r JOIN messages m ON m.id = r.message_id
      WHERE r.workspace_id = ? AND r.status = 'sent' AND m.from_email = ? AND m.subject LIKE ?
     ORDER BY at DESC LIMIT 6`,
    msg.workspace_id, msg.from_email, msg.id, `%${base}%`, msg.workspace_id, msg.from_email, `%${base}%`,
  );
  return prev.reverse().map((p) => ({ direction: p.direction, body: String(p.body || '').slice(0, 2000) }));
}

async function alert(ws, msg, reasons) {
  const wanted = String(ws.alert_on || '').split(',');
  const hit = reasons.filter((r) => wanted.includes(r));
  if (!hit.length) return;
  const text = `🔔 ${hit.join(', ').toUpperCase()} email\nFrom: ${msg.from_name || ''} <${msg.from_email}>\nSubject: ${msg.subject}\n${msg.summary || ''}\n${appUrl()}/app#message?id=${msg.id}`;
  await Promise.allSettled([sendTelegram(ws.telegram_chat_id, text), sendSlack(ws.slack_webhook, text)]);
}

/** Full pipeline for one message: triage -> rules -> reply (draft, scheduled or immediate) -> side actions. */
export async function processMessage(messageId) {
  const msg = one('SELECT * FROM messages WHERE id = ?', messageId);
  if (!msg || msg.status !== 'new') return;
  const mb = one('SELECT * FROM mailboxes WHERE id = ?', msg.mailbox_id);
  const ws = one('SELECT * FROM workspaces WHERE id = ?', msg.workspace_id);
  const plan = effectivePlan(ws);
  const contact = msg.contact_id ? one('SELECT * FROM contacts WHERE id = ?', msg.contact_id) : null;

  try {
    if (msg.is_automated || contact?.blocked) {
      const t = fallbackTriage(msg);
      run(`UPDATE messages SET category=?, priority='low', sentiment='neutral', summary=?, needs_reply=0, status='ignored', reasoning=? WHERE id=?`,
        contact?.blocked ? 'spam' : ['newsletter', 'spam'].includes(t.category) ? t.category : 'notification', t.summary,
        contact?.blocked ? 'Sender is on your block list' : 'Automated sender (no-reply, newsletter, mailing list or auto-reply)', msg.id);
      return;
    }

    const usage = getUsage(ws.id);
    const canUseAi = aiEnabled() && plan.key !== 'expired' && usage.ai_replies < plan.aiRepliesPerMonth;
    const rules = all('SELECT * FROM rules WHERE workspace_id = ? AND enabled = 1 ORDER BY position, id', ws.id);
    let matchedRuleName = null;
    const evaluate = (m) => {
      const acts = [];
      for (const r of rules) {
        if (ruleMatches(m, JSON.parse(r.conditions_json))) {
          acts.push(...JSON.parse(r.actions_json));
          matchedRuleName ??= r.name;
          if (r.stop_processing) break;
        }
      }
      return acts.length ? acts : null;
    };

    // First pass on raw fields lets an "ignore" rule skip AI cost entirely.
    const needsTriageFields = rules.some((r) => /"field":"(category|priority|sentiment|language)"/.test(r.conditions_json));
    let matchedActions = needsTriageFields ? null : evaluate(msg);
    if (matchedActions?.some((a) => a.type === 'ignore')) {
      run(`UPDATE messages SET status='ignored', reasoning=? WHERE id=?`, `Rule: ${matchedRuleName}`, msg.id);
      await runSideActions(matchedActions, mb, msg, ws);
      return;
    }
    const aiInstr = (matchedActions || []).filter((a) => a.type === 'ai_reply' && a.instructions).map((a) => a.instructions);

    const triage = canUseAi ? await analyzeEmail(ws, msg, aiInstr.join('\n'), threadContext(msg), contact) : fallbackTriage(msg);
    if (contact?.vip && ['normal', 'low'].includes(triage.priority)) triage.priority = 'high';

    run(`UPDATE messages SET category=?, priority=?, sentiment=?, language=?, summary=?, needs_reply=?, confidence=?,
        reasoning=?, intent=?, lead_score=?, is_phishing=?, extracted_json=?, status='triaged' WHERE id=?`,
    triage.category, triage.priority, triage.sentiment, triage.language, triage.summary, triage.needs_reply ? 1 : 0,
    triage.confidence, triage.reasoning, triage.intent, triage.lead_score, triage.is_phishing ? 1 : 0,
    JSON.stringify(triage.extracted || {}), msg.id);

    if (contact) {
      const ex = triage.extracted || {};
      run(`UPDATE contacts SET lead_score=?, last_sentiment=?, company=COALESCE(NULLIF(company,''), ?), phone=COALESCE(NULLIF(phone,''), ?)
        WHERE id=?`, triage.lead_score, triage.sentiment, ex.company || null, ex.phone || null, contact.id);
    }

    const triaged = { ...msg, ...triage };
    const alerts = [];
    if (triage.priority === 'urgent') alerts.push('urgent');
    if (triage.sentiment === 'negative') alerts.push('negative');
    if (contact?.vip) alerts.push('vip');
    if (triage.is_phishing) alerts.push('phishing');
    if (triage.lead_score >= 80) alerts.push('hot_lead');
    alert(ws, triaged, alerts).catch(() => {});

    if (triage.is_phishing) {
      run(`UPDATE messages SET status='ignored' WHERE id=?`, msg.id);
      logActivity(ws.id, 'phishing_blocked', { message: msg.id, from: msg.from_email, subject: msg.subject });
      return;
    }

    if (needsTriageFields) {
      matchedActions = evaluate(triaged);
      if (matchedActions?.some((a) => a.type === 'ignore')) {
        run(`UPDATE messages SET status='ignored' WHERE id=?`, msg.id);
        await runSideActions(matchedActions, mb, msg, ws);
        return;
      }
    }

    let reply = null;
    let mode = mb.mode;
    const tpl = matchedActions?.find((a) => a.type === 'template_reply');
    const aiAct = matchedActions?.find((a) => a.type === 'ai_reply');
    if (tpl) {
      const t = one('SELECT * FROM templates WHERE id = ? AND workspace_id = ?', tpl.template_id, ws.id);
      if (t) {
        reply = { subject: t.subject || '', body: fillTemplate(t.body, msg), source: 'template' };
        mode = tpl.mode || (mode === 'off' ? 'draft' : mode);
      }
    } else if ((aiAct || (triage.needs_reply && mode !== 'off')) && triage.reply_body) {
      reply = { subject: triage.reply_subject, body: triage.reply_body, source: 'ai' };
      if (aiAct?.mode) mode = aiAct.mode;
      if (mode === 'off') mode = 'draft';
    }

    if (reply) {
      const reasons = [];
      if (reply.source === 'ai' && triage.requires_human) reasons.push(triage.requires_human_reason || 'needs human');
      if (reply.source === 'ai' && triage.confidence < ws.auto_send_min_confidence) reasons.push(`low confidence (${Math.round(triage.confidence * 100)}%)`);
      if (contact?.vip) reasons.push('VIP sender — always reviewed by a human');
      if (!plan.autoSend) reasons.push('plan does not allow auto-send');
      if (recentlyRepliedTo(ws.id, msg.from_email)) reasons.push('already auto-replied to this sender in last 24h');
      if (!withinBusinessHours(ws.business_hours)) reasons.push('outside business hours');
      if (mode === 'auto' && reasons.length) mode = 'draft';

      // Human-like delay: auto replies go out after a random few minutes (also gives an "undo" window).
      let scheduledAt = null;
      if (mode === 'auto') {
        const min = Math.max(0, ws.reply_delay_min || 0);
        const max = Math.max(min, ws.reply_delay_max || 0);
        const delayMin = min + Math.random() * (max - min);
        if (delayMin > 0) scheduledAt = new Date(Date.now() + delayMin * 60_000).toISOString();
      }

      const r = run(`INSERT INTO replies (workspace_id, message_id, subject, body, source, status, error, scheduled_at, ai_original)
        VALUES (?,?,?,?,?, ?, ?, ?, ?)`, ws.id, msg.id, reply.subject, reply.body, reply.source,
      scheduledAt ? 'scheduled' : 'pending', reasons.length ? `Held for review: ${reasons.join('; ')}` : null,
      scheduledAt, reply.source === 'ai' ? reply.body : null);
      if (reply.source === 'ai') bumpUsage(ws.id, { ai_replies: 1 });
      const replyId = Number(r.lastInsertRowid);
      run(`UPDATE messages SET status='drafted' WHERE id=?`, msg.id);

      if (mode === 'auto' && !scheduledAt) await sendStoredReply(replyId, null);
      else if (!scheduledAt) logActivity(ws.id, 'draft_created', { message: msg.id, from: msg.from_email, subject: msg.subject });
    }

    await runSideActions(matchedActions || [], mb, msg, ws);
  } catch (e) {
    run(`UPDATE messages SET status='error', reasoning=? WHERE id=?`, `Error: ${e.message}`.slice(0, 300), msg.id);
    logActivity(ws.id, 'error', { message: msg.id, error: e.message });
    console.error(`[processor] message ${msg.id}:`, e.message);
  }
}

function fillTemplate(body, msg) {
  const first = (msg.from_name || '').split(' ')[0] || 'there';
  return body.replaceAll('{{first_name}}', first).replaceAll('{{name}}', msg.from_name || first)
    .replaceAll('{{email}}', msg.from_email).replaceAll('{{subject}}', msg.subject || '');
}

/** Send a reply. userId = the human who approved it (null for autopilot). */
export async function sendStoredReply(replyId, userId) {
  const reply = one('SELECT * FROM replies WHERE id = ?', replyId);
  if (!reply || !['pending', 'failed', 'scheduled'].includes(reply.status)) throw new Error('Reply is not pending');
  const msg = one('SELECT * FROM messages WHERE id = ?', reply.message_id);
  const mb = one('SELECT * FROM mailboxes WHERE id = ?', msg.mailbox_id);
  const ws = one('SELECT * FROM workspaces WHERE id = ?', reply.workspace_id);
  // Claim it first so a concurrent worker tick can't double-send.
  const claimed = run(`UPDATE replies SET status='sending' WHERE id=? AND status IN ('pending','failed','scheduled')`, replyId);
  if (!claimed.changes) throw new Error('Reply is already being sent');
  try {
    if (reply.kind === 'followup') {
      const { sendNew } = await import('./mail.js');
      const refs = [msg.references_hdr, msg.message_id].filter(Boolean).join(' ');
      await sendNew(mb, { to: msg.from_email, subject: reply.subject || `Re: ${msg.subject}`, body: reply.body, inReplyTo: msg.message_id, references: refs });
    } else {
      await sendReply(mb, msg, { subject: reply.subject, body: reply.body, signature: ws.signature });
    }
    run(`UPDATE replies SET status='sent', sent_at=datetime('now'), approved_by=?, error=NULL WHERE id=?`, userId, replyId);
    run(`UPDATE messages SET status='replied', first_response_sec = COALESCE(first_response_sec, CAST((julianday('now') - julianday(received_at)) * 86400 AS INTEGER)) WHERE id=?`, msg.id);
    run('INSERT INTO sent_log (workspace_id, to_email) VALUES (?, ?)', ws.id, msg.from_email);
    if (msg.contact_id) run('UPDATE contacts SET emails_out = emails_out + 1 WHERE id = ?', msg.contact_id);
    bumpUsage(ws.id, { emails_sent: 1 });
    logActivity(ws.id, reply.kind === 'followup' ? 'followup_sent' : userId ? 'reply_approved_sent' : 'auto_reply_sent', { message: msg.id, to: msg.from_email, subject: msg.subject });
    if (msg.uid) markSeen(mb, msg.uid).catch(() => {});
  } catch (e) {
    run(`UPDATE replies SET status='failed', error=? WHERE id=?`, e.message, replyId);
    logActivity(ws.id, 'send_failed', { message: msg.id, error: e.message });
    throw e;
  }
}

/** Store the owner's edit of an AI draft so future drafts improve ("learns from your edits"). */
export function recordCorrection(reply, finalBody) {
  if (!reply.ai_original || !finalBody) return;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  if (norm(reply.ai_original) === norm(finalBody)) return;
  const msg = one('SELECT summary FROM messages WHERE id = ?', reply.message_id);
  run('INSERT INTO corrections (workspace_id, email_summary, ai_draft, final_text) VALUES (?,?,?,?)',
    reply.workspace_id, msg?.summary || '', reply.ai_original, finalBody);
  // Keep only the most recent 50 per workspace.
  run(`DELETE FROM corrections WHERE workspace_id = ? AND id NOT IN (SELECT id FROM corrections WHERE workspace_id = ? ORDER BY id DESC LIMIT 50)`,
    reply.workspace_id, reply.workspace_id);
}

async function runSideActions(actions, mb, msg, ws) {
  for (const a of actions) {
    try {
      if (a.type === 'forward') {
        await forwardEmail(mb, msg, a.to);
        logActivity(ws.id, 'forwarded', { message: msg.id, to: a.to });
      } else if (a.type === 'mark_read') {
        await markSeen(mb, msg.uid);
      } else if (a.type === 'webhook') {
        const m = one('SELECT id, from_name, from_email, subject, summary, category, priority, sentiment, intent, lead_score, extracted_json, received_at FROM messages WHERE id = ?', msg.id);
        await assertPublicUrl(a.url);
        await fetch(a.url, { redirect: 'error', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'email.received', mailbox: mb.email, message: m }), signal: AbortSignal.timeout(10_000) });
      }
    } catch (e) {
      logActivity(ws.id, 'action_failed', { action: a.type, message: msg.id, error: e.message });
    }
  }
}
