import { one, all, run, bumpUsage, getUsage, logActivity } from '../db.js';
import { effectivePlan } from '../plans.js';
import { analyzeEmail, fallbackTriage, aiEnabled } from './ai.js';
import { isAutomatedEmail, recentlyRepliedTo, withinBusinessHours } from './safety.js';
import { ruleMatches } from './rules.js';
import { sendReply, forwardEmail, markSeen } from './mail.js';
import dns from 'node:dns/promises';
import net from 'node:net';

// Block webhooks to internal networks (SSRF protection).
async function assertPublicUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Webhook must use https');
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true });
  for (const { address } of addrs) {
    if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(address) ||
      /^(::1?$|f[cd]|fe80|::ffff:(10|127|192\.168|169\.254)\.)/i.test(address)) {
      throw new Error('Webhook host resolves to a private address');
    }
  }
}

/** Store a fetched message; returns the DB row id or null when it's a duplicate. */
export function storeMessage(mb, m) {
  const automated = isAutomatedEmail({ fromEmail: m.from_email, headers: m.headers }) ||
    m.from_email === mb.email.toLowerCase();
  const res = run(
    `INSERT OR IGNORE INTO messages (workspace_id, mailbox_id, uid, message_id, in_reply_to, references_hdr,
       from_name, from_email, to_email, subject, text_body, received_at, headers_json, is_automated, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    mb.workspace_id, mb.id, m.uid, m.message_id, m.in_reply_to, m.references_hdr, m.from_name,
    m.reply_to || m.from_email, m.to_email, m.subject, m.text_body, m.received_at,
    JSON.stringify(m.headers || {}), automated ? 1 : 0, m.firstSync ? 'ignored' : 'new',
  );
  return res.changes ? Number(res.lastInsertRowid) : null;
}

function threadContext(msg) {
  // Earlier emails + our replies in the same conversation (matched by subject & sender) to give the AI context.
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

/**
 * Full pipeline for one message: triage -> rules -> reply (draft or auto) -> side actions.
 */
export async function processMessage(messageId) {
  const msg = one('SELECT * FROM messages WHERE id = ?', messageId);
  if (!msg || msg.status !== 'new') return;
  const mb = one('SELECT * FROM mailboxes WHERE id = ?', msg.mailbox_id);
  const ws = one('SELECT * FROM workspaces WHERE id = ?', msg.workspace_id);
  const plan = effectivePlan(ws);

  try {
    if (msg.is_automated) {
      const t = fallbackTriage(msg);
      run(`UPDATE messages SET category=?, priority='low', sentiment='neutral', summary=?, needs_reply=0, status='ignored' WHERE id=?`,
        ['newsletter', 'spam'].includes(t.category) ? t.category : 'notification', t.summary, msg.id);
      return;
    }

    const usage = getUsage(ws.id);
    const canUseAi = aiEnabled() && plan.key !== 'expired' && usage.ai_replies < plan.aiRepliesPerMonth;

    // Rules are evaluated against the triaged message, so rules can use category/priority/etc.
    const rules = all('SELECT * FROM rules WHERE workspace_id = ? AND enabled = 1 ORDER BY position, id', ws.id);
    let matchedActions = null;
    let matchedRuleName = null;
    const aiInstr = [];

    // First pass on raw fields lets an "ignore" rule skip AI cost entirely.
    let triage = null;
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

    const needsTriageFields = rules.some((r) => /"field":"(category|priority|sentiment|language)"/.test(r.conditions_json));
    matchedActions = needsTriageFields ? null : evaluate(msg);
    if (matchedActions?.some((a) => a.type === 'ignore')) {
      run(`UPDATE messages SET status='ignored' WHERE id=?`, msg.id);
      logActivity(ws.id, 'ignored', { message: msg.id, rule: matchedRuleName });
      await runSideActions(matchedActions, mb, msg, ws);
      return;
    }
    for (const a of matchedActions || []) if (a.type === 'ai_reply' && a.instructions) aiInstr.push(a.instructions);

    triage = canUseAi ? await analyzeEmail(ws, msg, aiInstr.join('\n'), threadContext(msg)) : fallbackTriage(msg);

    run(`UPDATE messages SET category=?, priority=?, sentiment=?, language=?, summary=?, needs_reply=?, confidence=?, status='triaged' WHERE id=?`,
      triage.category, triage.priority, triage.sentiment, triage.language, triage.summary,
      triage.needs_reply ? 1 : 0, triage.confidence, msg.id);

    const triaged = { ...msg, ...triage };
    if (needsTriageFields) {
      matchedActions = evaluate(triaged);
      if (matchedActions?.some((a) => a.type === 'ignore')) {
        run(`UPDATE messages SET status='ignored' WHERE id=?`, msg.id);
        await runSideActions(matchedActions, mb, msg, ws);
        return;
      }
    }

    // Decide the reply.
    let reply = null;
    let mode = mb.mode; // off | draft | auto
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
      // Guardrails that downgrade "auto" to "draft" (human approval).
      const reasons = [];
      if (reply.source === 'ai' && triage.requires_human) reasons.push(triage.requires_human_reason || 'needs human');
      if (reply.source === 'ai' && triage.confidence < ws.auto_send_min_confidence) reasons.push('low confidence');
      if (!plan.autoSend) reasons.push('plan does not allow auto-send');
      if (recentlyRepliedTo(ws.id, msg.from_email)) reasons.push('already auto-replied to this sender in last 24h');
      if (!withinBusinessHours(ws.business_hours)) reasons.push('outside business hours');
      if (mode === 'auto' && reasons.length) mode = 'draft';

      const r = run(`INSERT INTO replies (workspace_id, message_id, subject, body, source, status, error) VALUES (?,?,?,?,?, 'pending', ?)`,
        ws.id, msg.id, reply.subject, reply.body, reply.source, reasons.length ? `Held for review: ${reasons.join('; ')}` : null);
      if (reply.source === 'ai') bumpUsage(ws.id, { ai_replies: 1 });
      const replyId = Number(r.lastInsertRowid);
      run(`UPDATE messages SET status='drafted' WHERE id=?`, msg.id);

      if (mode === 'auto') await sendStoredReply(replyId, null);
      else logActivity(ws.id, 'draft_created', { message: msg.id, from: msg.from_email, subject: msg.subject });
    }

    await runSideActions(matchedActions || [], mb, msg, ws);
  } catch (e) {
    run(`UPDATE messages SET status='error' WHERE id=?`, msg.id);
    logActivity(ws.id, 'error', { message: msg.id, error: e.message });
    console.error(`[processor] message ${msg.id}:`, e.message);
  }
}

function fillTemplate(body, msg) {
  const first = (msg.from_name || '').split(' ')[0] || 'there';
  return body.replaceAll('{{first_name}}', first).replaceAll('{{name}}', msg.from_name || first)
    .replaceAll('{{email}}', msg.from_email).replaceAll('{{subject}}', msg.subject || '');
}

export async function sendStoredReply(replyId, userId) {
  const reply = one('SELECT * FROM replies WHERE id = ?', replyId);
  if (!reply || !['pending', 'failed'].includes(reply.status)) throw new Error('Reply is not pending');
  const msg = one('SELECT * FROM messages WHERE id = ?', reply.message_id);
  const mb = one('SELECT * FROM mailboxes WHERE id = ?', msg.mailbox_id);
  const ws = one('SELECT * FROM workspaces WHERE id = ?', reply.workspace_id);
  try {
    await sendReply(mb, msg, { subject: reply.subject, body: reply.body, signature: ws.signature });
    run(`UPDATE replies SET status='sent', sent_at=datetime('now'), approved_by=?, error=NULL WHERE id=?`, userId, replyId);
    run(`UPDATE messages SET status='replied' WHERE id=?`, msg.id);
    run('INSERT INTO sent_log (workspace_id, to_email) VALUES (?, ?)', ws.id, msg.from_email);
    bumpUsage(ws.id, { emails_sent: 1 });
    logActivity(ws.id, userId ? 'reply_approved_sent' : 'auto_reply_sent', { message: msg.id, to: msg.from_email, subject: msg.subject });
    markSeen(mb, msg.uid).catch(() => {});
  } catch (e) {
    run(`UPDATE replies SET status='failed', error=? WHERE id=?`, e.message, replyId);
    logActivity(ws.id, 'send_failed', { message: msg.id, error: e.message });
    throw e;
  }
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
        const m = one('SELECT id, from_name, from_email, subject, summary, category, priority, sentiment, received_at FROM messages WHERE id = ?', msg.id);
        await assertPublicUrl(a.url);
        await fetch(a.url, { redirect: 'error', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'email.received', mailbox: mb.email, message: m }), signal: AbortSignal.timeout(10_000) });
      }
    } catch (e) {
      logActivity(ws.id, 'action_failed', { action: a.type, message: msg.id, error: e.message });
    }
  }
}
