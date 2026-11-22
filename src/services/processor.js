import { one, all, run, bumpUsage, getUsage, logActivity } from '../db.js';
import { effectivePlan } from '../plans.js';
import { analyzeEmail, fallbackTriage, aiEnabled } from './ai.js';
import { isAutomatedEmail, recentlyRepliedTo, withinBusinessHours } from './safety.js';
import { ruleMatches } from './rules.js';
import { sendReply, forwardEmail, markSeen, sendNew } from './mail.js';
import { sendTelegram, sendSlack } from './notify.js';
import { detectInjection, replyToMismatch, lookalikeDomain, wantsOptOut, sensitiveTopicHit, checkOutbound } from './guard.js';
import { safeFetch } from './net.js';
import { seal, open, openMessage } from '../vault.js';
import { appUrl } from '../settings.js';
import { hmac } from '../crypto.js';

export { safeFetch };
/** Kept for compatibility with older callers: validates a public https URL. */
export async function assertPublicUrl(url) {
  const { resolvePublic } = await import('./net.js');
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('URL must use https');
  await resolvePublic(u.hostname);
}

// Attachment bytes live only in memory between fetch and AI processing — never written to disk/DB.
const pendingAttachments = new Map();

function upsertContact(wsId, email, name) {
  run(`INSERT INTO contacts (workspace_id, email, name, emails_in, last_seen) VALUES (?,?,?,1,datetime('now'))
       ON CONFLICT(workspace_id, email) DO UPDATE SET emails_in = emails_in + 1, last_seen = datetime('now'),
       name = COALESCE(NULLIF(contacts.name,''), excluded.name)`, wsId, email, String(name || '').slice(0, 200));
  return one('SELECT * FROM contacts WHERE workspace_id = ? AND email = ?', wsId, email);
}

function slaDue(ws, priority, receivedAt) {
  let sla = {};
  try { sla = JSON.parse(ws.sla_json || '{}'); } catch { /* default */ }
  const min = Number(sla[priority] ?? sla.normal);
  if (!(min > 0)) return null;
  return new Date(new Date(receivedAt || Date.now()).getTime() + min * 60_000).toISOString();
}

/** Store a fetched message (body encrypted); returns the DB row id or null when it's a duplicate. */
export function storeMessage(mb, m) {
  const from = String(m.from_email || '').toLowerCase();
  const replyTo = m.reply_to && m.reply_to !== from ? String(m.reply_to).toLowerCase() : null;
  const automated = isAutomatedEmail({ fromEmail: from, headers: m.headers }) || from === mb.email.toLowerCase();
  const body = String(m.text_body || '');
  const injection = detectInjection(`${m.subject || ''}\n${body}`);
  const attachmentsMeta = (m.attachments || []).map(({ filename, contentType, size }) => ({ filename, contentType, size }));
  const res = run(
    `INSERT OR IGNORE INTO messages (workspace_id, mailbox_id, uid, message_id, in_reply_to, references_hdr,
       from_name, from_email, reply_to_email, to_email, subject, text_body, received_at, headers_json, is_automated, status,
       injection_flag, attachments_json, list_unsubscribe, list_unsubscribe_post)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    mb.workspace_id, mb.id, m.uid, String(m.message_id || '').slice(0, 500), m.in_reply_to || null, m.references_hdr || null,
    String(m.from_name || '').slice(0, 200), from, replyTo, String(m.to_email || '').slice(0, 1000), String(m.subject || '').slice(0, 998),
    seal(mb.workspace_id, 'messages.text_body', body), m.received_at, null,
    automated ? 1 : 0, m.firstSync ? 'ignored' : 'new', injection.flagged ? 1 : 0,
    attachmentsMeta.length ? JSON.stringify(attachmentsMeta) : null, m.list_unsubscribe || null, m.list_unsubscribe_post ? 1 : 0,
  );
  if (!res.changes) return null;
  const id = Number(res.lastInsertRowid);
  if (!automated && from) {
    const c = upsertContact(mb.workspace_id, from, m.from_name);
    run('UPDATE messages SET contact_id = ? WHERE id = ?', c.id, id);
  }
  if (m.attachments?.some((a) => a.content)) pendingAttachments.set(id, m.attachments);
  return id;
}

function threadContext(msg) {
  const base = (msg.subject || '').replace(/^(re|fwd?|aw|sv):\s*/gi, '').trim();
  if (!base) return [];
  const prev = all(
    `SELECT m.workspace_id, m.text_body AS body, 'customer' AS direction, m.received_at AS at, 'messages.text_body' AS field FROM messages m
      WHERE m.workspace_id = ? AND m.from_email = ? AND m.id != ? AND m.subject LIKE ?
     UNION ALL
     SELECT r.workspace_id, r.body, 'us', r.sent_at, 'replies.body' FROM replies r JOIN messages m ON m.id = r.message_id
      WHERE r.workspace_id = ? AND r.status = 'sent' AND m.from_email = ? AND m.subject LIKE ?
     ORDER BY at DESC LIMIT 6`,
    msg.workspace_id, msg.from_email, msg.id, `%${base}%`, msg.workspace_id, msg.from_email, `%${base}%`,
  );
  return prev.reverse().map((p) => ({ direction: p.direction, body: String(open(p.workspace_id, p.field, p.body) || '').slice(0, 2000) }));
}

async function alert(ws, msg, reasons) {
  const wanted = String(ws.alert_on || '').split(',');
  const hit = reasons.filter((r) => wanted.includes(r));
  if (!hit.length) return;
  // Alerts never include the email body (they travel through third-party chat apps).
  const text = `🔔 ${hit.join(', ').toUpperCase()} email\nFrom: ${msg.from_name || ''} <${msg.from_email}>\nSubject: ${msg.subject}\n${msg.summary || ''}\n${appUrl()}/app#message?id=${msg.id}`;
  await Promise.allSettled([sendTelegram(ws.telegram_chat_id, text), sendSlack(ws.slack_webhook, text)]);
}

function knowledgeText(wsId) {
  return all('SELECT title, content FROM knowledge WHERE workspace_id = ?', wsId).map((k) => `${k.title}\n${k.content}`).join('\n');
}

/** Run the deterministic guards for a drafted reply; returns problems (empty = safe). */
export function guardReply(ws, mb, msg, replyBody) {
  const mailboxDomains = all('SELECT email FROM mailboxes WHERE workspace_id = ?', ws.id).map((x) => x.email.split('@')[1]).filter(Boolean);
  return checkOutbound(replyBody, {
    knowledge: knowledgeText(ws.id), original: `${msg.subject}\n${msg.text_body}`, bookingLink: ws.booking_link || '',
    allowedDomains: String(ws.allowed_link_domains || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
    mailboxDomains, neverSay: ws.never_say || '', senderEmail: msg.reply_to_email || msg.from_email,
  });
}

/** Full pipeline for one message: triage -> rules -> reply (draft, scheduled or immediate) -> side actions. */
export async function processMessage(messageId) {
  const raw = one('SELECT * FROM messages WHERE id = ?', messageId);
  if (!raw || raw.status !== 'new') return;
  const msg = openMessage(raw);
  const mb = one('SELECT * FROM mailboxes WHERE id = ?', msg.mailbox_id);
  const ws = one('SELECT * FROM workspaces WHERE id = ?', msg.workspace_id);
  const plan = effectivePlan(ws);
  const contact = msg.contact_id ? one('SELECT * FROM contacts WHERE id = ?', msg.contact_id) : null;
  const attachments = pendingAttachments.get(msg.id) || [];
  pendingAttachments.delete(msg.id);

  let matchedRuleName = null;
  const hits = new Set(); // rules that fired for this email (counted once, shown in the Automation Center)
  try {
    if (msg.is_automated || contact?.blocked) {
      const t = fallbackTriage(msg);
      run(`UPDATE messages SET category=?, priority='low', sentiment='neutral', summary=?, needs_reply=0, status='ignored', reasoning=? WHERE id=?`,
        contact?.blocked ? 'spam' : ['newsletter', 'spam'].includes(t.category) ? t.category : 'notification', t.summary,
        contact?.blocked ? 'Sender is on your block list' : 'Automated sender (no-reply, newsletter, mailing list or auto-reply)', msg.id);
      return;
    }

    const usage = getUsage(ws.id);
    const callCap = plan.aiCalls || plan.aiRepliesPerMonth * 3;
    const canUseAi = aiEnabled() && plan.key !== 'expired' && usage.ai_replies < plan.aiRepliesPerMonth && usage.ai_calls < callCap;
    const rules = all('SELECT * FROM rules WHERE workspace_id = ? AND enabled = 1 ORDER BY position, id', ws.id);
    const evaluate = (m) => {
      const acts = [];
      for (const r of rules) {
        if (ruleMatches(m, JSON.parse(r.conditions_json))) {
          acts.push(...JSON.parse(r.actions_json));
          matchedRuleName ??= r.name;
          hits.add(r.id);
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
    const aiInstr = (matchedActions || []).filter((a) => a.type === 'ai_reply' && a.instructions).map((a) => String(a.instructions).slice(0, 1000));

    const triage = canUseAi
      ? await analyzeEmail(ws, msg, aiInstr.join('\n'), threadContext(msg), contact, attachments)
      : { ...fallbackTriage(msg), ...(aiEnabled() && plan.key !== 'expired' ? { requires_human_reason: 'Monthly AI limit reached — upgrade your plan' } : {}) };
    if (contact?.vip && ['normal', 'low'].includes(triage.priority)) triage.priority = 'high';

    // ---- Deterministic risk signals (independent of the AI) ----
    const flags = [];
    if (msg.injection_flag) flags.push('hidden instructions aimed at AI detected');
    if (replyToMismatch(msg.from_email, msg.reply_to_email)) flags.push(`Reply-To (${msg.reply_to_email}) differs from sender — possible impersonation`);
    const trusted = [...new Set([...all('SELECT email FROM mailboxes WHERE workspace_id = ?', ws.id).map((x) => x.email.split('@')[1]),
      ...all('SELECT email FROM contacts WHERE workspace_id = ? AND (vip = 1 OR emails_out > 0) LIMIT 500', ws.id).map((x) => x.email.split('@')[1])])].filter(Boolean);
    const look = lookalikeDomain(msg.from_email, trusted);
    if (look) { flags.push(`sender domain imitates ${look}`); triage.is_phishing = true; }
    const optOut = triage.wants_opt_out || wantsOptOut(msg.text_body);
    if (optOut && contact) {
      run('UPDATE contacts SET do_not_contact = 1 WHERE id = ?', contact.id);
      flags.push('sender asked not to be contacted');
    }
    const topic = sensitiveTopicHit(`${msg.subject}\n${msg.text_body}`, ws.sensitive_topics);
    if (topic) flags.push(`sensitive topic: ${topic}`);

    run(`UPDATE messages SET category=?, priority=?, sentiment=?, language=?, summary=?, needs_reply=?, confidence=?,
        reasoning=?, intent=?, lead_score=?, is_phishing=?, extracted_json=?, facts_used=?, opt_out=?, guard_flags=?, sla_due_at=?, status='triaged' WHERE id=?`,
    triage.category, triage.priority, triage.sentiment, String(triage.language || '').slice(0, 10), String(triage.summary || '').slice(0, 500),
    triage.needs_reply ? 1 : 0, triage.confidence, String(triage.reasoning || '').slice(0, 500), String(triage.intent || '').slice(0, 200),
    triage.lead_score, triage.is_phishing ? 1 : 0, JSON.stringify(triage.extracted || {}), JSON.stringify(triage.facts_used || []),
    optOut ? 1 : 0, flags.length ? JSON.stringify(flags) : null,
    triage.needs_reply && !triage.is_phishing ? slaDue(ws, triage.priority, msg.received_at) : null, msg.id);

    if (contact) {
      const ex = triage.extracted || {};
      run(`UPDATE contacts SET lead_score=?, last_sentiment=?, company=COALESCE(NULLIF(company,''), ?), phone=COALESCE(NULLIF(phone,''), ?)
        WHERE id=?`, triage.lead_score, triage.sentiment, String(ex.company || '').slice(0, 200) || null, String(ex.phone || '').slice(0, 50) || null, contact.id);
    }

    const triaged = { ...msg, ...triage };
    const alerts = [];
    if (triage.priority === 'urgent') alerts.push('urgent');
    if (triage.sentiment === 'negative') alerts.push('negative');
    if (contact?.vip) alerts.push('vip');
    if (triage.is_phishing) alerts.push('phishing');
    if (triage.lead_score >= 80) alerts.push('hot_lead');
    alert(ws, triaged, alerts).catch(() => {});

    if (!triage.is_phishing && Array.isArray(triage.action_items) && triage.action_items.length) {
      for (const a of triage.action_items.slice(0, 5)) {
        run('INSERT INTO tasks (workspace_id, message_id, title, due_text, source) VALUES (?,?,?,?,?)', ws.id, msg.id,
          String(a.title).slice(0, 200), String(a.due || '').slice(0, 80) || null, 'ai');
      }
      logActivity(ws.id, 'tasks_extracted', { message: msg.id, count: Math.min(5, triage.action_items.length), subject: msg.subject });
    }

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
      const reasons = [...flags];
      if (reply.source === 'ai') {
        if (triage.requires_human) reasons.push(triage.requires_human_reason || 'needs human');
        if (triage.confidence < ws.auto_send_min_confidence) reasons.push(`low confidence (${Math.round(triage.confidence * 100)}%)`);
        if (triage.unsupported_claims) reasons.push('AI flagged a claim not backed by your knowledge base');
        reasons.push(...guardReply(ws, mb, msg, reply.body).map((p) => `guard: ${p}`));
      }
      // "Earned autopilot": a mailbox can limit auto-sending to categories the AI has proven itself on.
      let autoCats = null;
      try { autoCats = mb.auto_categories ? JSON.parse(mb.auto_categories) : null; } catch { /* all */ }
      if (mode === 'auto' && Array.isArray(autoCats) && !autoCats.includes(triage.category)) reasons.push(`autopilot is not enabled for "${triage.category}" emails`);
      if (contact?.vip) reasons.push('VIP sender — always reviewed by a human');
      if (contact?.do_not_contact && !optOut) reasons.push('contact is on your do-not-contact list');
      if (!plan.autoSend) reasons.push('plan does not allow auto-send');
      if (recentlyRepliedTo(ws.id, msg.reply_to_email || msg.from_email)) reasons.push('already auto-replied to this sender in last 24h');
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

      const r = run(`INSERT INTO replies (workspace_id, message_id, subject, body, source, status, error, scheduled_at, ai_original, guard_json)
        VALUES (?,?,?,?,?, ?, ?, ?, ?, ?)`, ws.id, msg.id, String(reply.subject || '').slice(0, 998), seal(ws.id, 'replies.body', reply.body), reply.source,
      scheduledAt ? 'scheduled' : 'pending', reasons.length ? `Held for review: ${reasons.join('; ')}` : null,
      scheduledAt, reply.source === 'ai' ? seal(ws.id, 'replies.ai_original', reply.body) : null, reasons.length ? JSON.stringify(reasons) : null);
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
  } finally {
    for (const id of hits) run(`UPDATE rules SET hits = hits + 1, last_hit_at = datetime('now') WHERE id = ?`, id);
    if (hits.size) logActivity(ws.id, 'rule_fired', { message: msg.id, rules: [...hits].length, rule: matchedRuleName });
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
  const msg = openMessage(one('SELECT * FROM messages WHERE id = ?', reply.message_id));
  const mb = one('SELECT * FROM mailboxes WHERE id = ?', msg.mailbox_id);
  const ws = one('SELECT * FROM workspaces WHERE id = ?', reply.workspace_id);
  if (!mb.enabled || mb.revoked_at) throw new Error('This email account is disconnected — reconnect it first');
  const contact = msg.contact_id ? one('SELECT do_not_contact FROM contacts WHERE id = ?', msg.contact_id) : null;
  if (reply.kind === 'followup' && contact?.do_not_contact) throw new Error('This contact asked not to be contacted');
  // Recipient is always fixed by code (the original sender) — the AI can never choose where mail goes.
  const to = msg.reply_to_email || msg.from_email;
  const claimed = run(`UPDATE replies SET status='sending' WHERE id=? AND status IN ('pending','failed','scheduled')`, replyId);
  if (!claimed.changes) throw new Error('Reply is already being sent');
  const body = open(ws.id, 'replies.body', reply.body);
  const aiOriginal = reply.ai_original ? open(ws.id, 'replies.ai_original', reply.ai_original) : null;
  try {
    if (reply.kind === 'followup') {
      const refs = [msg.references_hdr, msg.message_id].filter(Boolean).join(' ');
      await sendNew(mb, { to, subject: reply.subject || `Re: ${msg.subject}`, body, inReplyTo: msg.message_id, references: refs });
    } else {
      await sendReply(mb, msg, { subject: reply.subject, body, signature: ws.signature, to });
    }
    const edited = aiOriginal == null ? null : (aiOriginal.replace(/\s+/g, ' ').trim() === body.replace(/\s+/g, ' ').trim() ? 0 : 1);
    run(`UPDATE replies SET status='sent', sent_at=datetime('now'), approved_by=?, error=NULL, edited=? WHERE id=?`, userId, edited, replyId);
    run(`UPDATE messages SET status='replied', done=1, sla_due_at=NULL, first_response_sec = COALESCE(first_response_sec, CAST((julianday('now') - julianday(received_at)) * 86400 AS INTEGER)) WHERE id=?`, msg.id);
    run('INSERT INTO sent_log (workspace_id, to_email) VALUES (?, ?)', ws.id, to);
    if (msg.contact_id) run('UPDATE contacts SET emails_out = emails_out + 1 WHERE id = ?', msg.contact_id);
    bumpUsage(ws.id, { emails_sent: 1 });
    logActivity(ws.id, reply.kind === 'followup' ? 'followup_sent' : userId ? 'reply_approved_sent' : 'auto_reply_sent', { message: msg.id, to, subject: msg.subject });
    if (msg.uid) markSeen(mb, msg.uid).catch(() => {});
  } catch (e) {
    run(`UPDATE replies SET status='failed', error=? WHERE id=?`, String(e.message).slice(0, 500), replyId);
    logActivity(ws.id, 'send_failed', { message: msg.id, error: e.message });
    throw e;
  }
}

/** Store the owner's edit of an AI draft so future drafts improve ("learns from your edits"). */
export function recordCorrection(reply, finalBody) {
  const original = reply.ai_original ? open(reply.workspace_id, 'replies.ai_original', reply.ai_original) : null;
  if (!original || !finalBody) return;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  if (norm(original) === norm(finalBody)) return;
  const msg = one('SELECT summary FROM messages WHERE id = ?', reply.message_id);
  run('INSERT INTO corrections (workspace_id, email_summary, ai_draft, final_text) VALUES (?,?,?,?)',
    reply.workspace_id, msg?.summary || '', seal(reply.workspace_id, 'corrections.ai_draft', original), seal(reply.workspace_id, 'corrections.final_text', finalBody));
  run(`DELETE FROM corrections WHERE workspace_id = ? AND id NOT IN (SELECT id FROM corrections WHERE workspace_id = ? ORDER BY id DESC LIMIT 50)`,
    reply.workspace_id, reply.workspace_id);
}

/** Signed webhook delivery: receivers verify X-MailPilot-Signature = HMAC-SHA256(secret, `${timestamp}.${body}`). */
export async function deliverWebhook(ws, url, payload) {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const res = await safeFetch(url, {
    method: 'POST', body,
    headers: { 'content-type': 'application/json', 'x-mailpilot-timestamp': String(ts), 'x-mailpilot-signature': `v1=${hmac(ws.webhook_secret || '', `${ts}.${body}`)}` },
  }, { maxBytes: 100_000 });
  if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
}

async function runSideActions(actions, mb, msg, ws) {
  for (const a of actions) {
    try {
      if (a.type === 'forward') {
        await forwardEmail(mb, msg, a.to);
        logActivity(ws.id, 'forwarded', { message: msg.id, to: a.to });
      } else if (a.type === 'mark_read') {
        await markSeen(mb, msg.uid);
      } else if (a.type === 'assign') {
        const member = one('SELECT user_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?', ws.id, Number(a.user_id));
        if (member) run('UPDATE messages SET assigned_to = ? WHERE id = ?', member.user_id, msg.id);
      } else if (a.type === 'snooze') {
        run('UPDATE messages SET snoozed_until = ? WHERE id = ?', new Date(Date.now() + Number(a.hours) * 3600_000).toISOString(), msg.id);
      } else if (a.type === 'webhook') {
        const m = one('SELECT id, from_name, from_email, subject, summary, category, priority, sentiment, intent, lead_score, extracted_json, received_at FROM messages WHERE id = ?', msg.id);
        await deliverWebhook(ws, a.url, { event: 'email.received', mailbox: mb.email, message: { ...m, extracted: JSON.parse(m.extracted_json || '{}'), extracted_json: undefined } });
      }
    } catch (e) {
      logActivity(ws.id, 'action_failed', { action: a.type, message: msg.id, error: e.message });
    }
  }
}
