import { all, one, run, logActivity } from '../db.js';
import { config } from '../config.js';
import { effectivePlan } from '../plans.js';
import { fetchNewMessages } from './mail.js';
import { storeMessage, processMessage, sendStoredReply } from './processor.js';
import { aiEnabled, writeFollowUp, writeBriefing } from './ai.js';
import { sendSystemEmail, sendTelegram, sendSlack } from './notify.js';
import { open } from '../vault.js';
import { checkLifecycle } from './lifecycle.js';
import { appUrl, appName } from '../settings.js';

const busy = new Set();
export const workerState = { startedAt: null, lastTickAt: null, lastTickMs: 0, ticks: 0, lastError: null };

export async function syncMailbox(mailboxId) {
  if (busy.has(mailboxId)) return { skipped: true };
  busy.add(mailboxId);
  try {
    const mb = one('SELECT * FROM mailboxes WHERE id = ?', mailboxId);
    if (!mb || !mb.enabled) return { skipped: true };
    const ws = one('SELECT * FROM workspaces WHERE id = ?', mb.workspace_id);
    if (effectivePlan(ws).key === 'expired') return { skipped: true, reason: 'subscription inactive' };

    const { messages, lastUid, uidValidity } = await fetchNewMessages(mb);
    const ids = [];
    for (const m of messages) {
      const id = storeMessage(mb, m);
      if (id) ids.push(id);
    }
    run(`UPDATE mailboxes SET last_uid=?, uid_validity=?, last_sync_at=datetime('now'), last_error=NULL WHERE id=?`,
      lastUid, uidValidity ?? mb.uid_validity, mb.id);
    for (const id of ids) await processMessage(id);
    return { fetched: messages.length, stored: ids.length };
  } catch (e) {
    run(`UPDATE mailboxes SET last_error=?, last_sync_at=datetime('now') WHERE id=?`, e.message, mailboxId);
    const mb = one('SELECT workspace_id FROM mailboxes WHERE id = ?', mailboxId);
    if (mb) logActivity(mb.workspace_id, 'sync_error', { mailbox: mailboxId, error: e.message });
    return { error: e.message };
  } finally {
    busy.delete(mailboxId);
  }
}

/** Auto-replies held for the human-like delay / undo window. */
export async function sendDueReplies() {
  const due = all(`SELECT id FROM replies WHERE status = 'scheduled' AND scheduled_at <= ? LIMIT 50`, new Date().toISOString());
  for (const r of due) await sendStoredReply(r.id, null).catch(() => {});
}

/** Follow-up autopilot: nudge leads who went quiet after our reply. Drafts go to the approval queue. */
export async function createFollowUps() {
  if (!aiEnabled()) return;
  const candidates = all(`
    SELECT r.id AS reply_id, r.body, r.sent_at, m.*, w.followup_days
    FROM replies r JOIN messages m ON m.id = r.message_id JOIN workspaces w ON w.id = r.workspace_id
    WHERE r.status = 'sent' AND r.kind = 'reply' AND w.followup_days > 0
      AND m.category IN ('sales_inquiry','partnership','meeting_request')
      AND r.sent_at < datetime('now', '-' || w.followup_days || ' days')
      AND r.sent_at > datetime('now', '-30 days')
      AND NOT EXISTS (SELECT 1 FROM messages m2 WHERE m2.workspace_id = m.workspace_id AND m2.from_email = m.from_email AND m2.id != m.id AND datetime(m2.received_at) > datetime(r.sent_at))
      AND NOT EXISTS (SELECT 1 FROM replies f WHERE f.message_id = m.id AND f.kind = 'followup')
      AND NOT EXISTS (SELECT 1 FROM contacts ct WHERE ct.id = m.contact_id AND (ct.do_not_contact = 1 OR ct.blocked = 1))
    LIMIT 20`);
  for (const c of candidates) {
    const ws = one('SELECT * FROM workspaces WHERE id = ?', c.workspace_id);
    if (effectivePlan(ws).key === 'expired') continue;
    try {
      const original = { ...c, text_body: open(ws.id, 'messages.text_body', c.text_body) };
      const fu = await writeFollowUp(ws, original, { body: open(ws.id, 'replies.body', c.body) }, c.followup_days);
      const { seal } = await import('../vault.js');
      run(`INSERT INTO replies (workspace_id, message_id, subject, body, source, status, kind, error, ai_original)
        VALUES (?,?,?,?, 'ai', 'pending', 'followup', ?, ?)`, ws.id, c.id, fu.subject, seal(ws.id, 'replies.body', fu.body),
      `Follow-up: no answer for ${c.followup_days} day(s)`, seal(ws.id, 'replies.ai_original', fu.body));
      logActivity(ws.id, 'followup_drafted', { message: c.id, to: c.from_email, subject: c.subject });
    } catch (e) { console.error('[followup]', e.message); }
  }
}

/** Morning briefing email per workspace, at the workspace's local digest hour. */
export async function sendDigests(now = new Date()) {
  const list = all(`SELECT w.* FROM workspaces w WHERE w.digest_enabled = 1`);
  for (const ws of list) {
    const tz = ws.timezone || 'UTC';
    let hour; let today;
    try {
      hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(now));
      today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
    } catch { continue; }
    if (hour !== ws.digest_hour || ws.last_digest_on === today) continue;
    run('UPDATE workspaces SET last_digest_on = ? WHERE id = ?', today, ws.id);
    if (effectivePlan(ws).key === 'expired') continue;
    const counts = one(`SELECT COUNT(*) AS received, SUM(status='replied') AS replied, SUM(status='drafted') AS awaiting,
        SUM(priority='urgent') AS urgent FROM messages WHERE workspace_id = ? AND datetime(received_at) > datetime('now','-1 day')`, ws.id);
    if (!counts.received) continue;
    const important = all(`SELECT id, from_name, from_email, subject, summary, priority, category, status, lead_score FROM messages
        WHERE workspace_id = ? AND datetime(received_at) > datetime('now','-1 day') AND status != 'ignored'
        ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, lead_score DESC LIMIT 15`, ws.id);
    let text;
    try {
      text = aiEnabled() ? await writeBriefing(ws, { counts, important }) : null;
    } catch { text = null; }
    text ||= `Last 24h: ${counts.received} received, ${counts.replied || 0} replied, ${counts.awaiting || 0} waiting for approval, ${counts.urgent || 0} urgent.\n\n${important.map((m) => `• [${m.priority}] ${m.from_name || m.from_email}: ${m.subject}`).join('\n')}`;
    const recipients = all(`SELECT u.email FROM workspace_members wm JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = ? AND u.notify_digest = 1 AND u.suspended = 0`, ws.id);
    for (const r of recipients) {
      await sendSystemEmail(r.email, `Your ${appName()} briefing — ${counts.received} emails, ${counts.awaiting || 0} need you`, `${text}\n\nOpen dashboard: ${appUrl()}/app`)
        .catch((e) => console.error('[digest]', e.message));
    }
  }
}

/** SLA: alert the team (Telegram/Slack + activity) about emails past their response-time target. */
export async function checkSla() {
  const rows = all(`SELECT m.id, m.workspace_id, m.subject, m.from_email, m.priority FROM messages m
    WHERE m.sla_due_at IS NOT NULL AND m.sla_due_at < ? AND m.done = 0 AND m.status IN ('triaged','drafted','error')
      AND (m.snoozed_until IS NULL OR m.snoozed_until < ?) LIMIT 200`, new Date().toISOString(), new Date().toISOString());
  const byWs = new Map();
  for (const r of rows) byWs.set(r.workspace_id, [...(byWs.get(r.workspace_id) || []), r]);
  for (const [wsId, list] of byWs) {
    const ws = one('SELECT * FROM workspaces WHERE id = ?', wsId);
    if (ws.last_sla_alert_at && new Date(ws.last_sla_alert_at) > new Date(Date.now() - 3600_000)) continue; // max hourly
    run('UPDATE workspaces SET last_sla_alert_at = ? WHERE id = ?', new Date().toISOString(), wsId);
    logActivity(wsId, 'sla_breach', { count: list.length, subject: list[0].subject });
    const text = `⏰ ${list.length} email(s) are past your response-time target.\nOldest: ${list[0].subject} (${list[0].from_email})\n${appUrl()}/app#inbox?view=overdue`;
    await Promise.allSettled([sendTelegram(ws.telegram_chat_id, text), sendSlack(ws.slack_webhook, text)]);
  }
  return rows.length;
}

/** Data retention: wipe email bodies older than the workspace's retention window (privacy / GDPR). */
export function purgeOldData() {
  for (const ws of all('SELECT id, retention_days FROM workspaces WHERE retention_days > 0')) {
    run(`UPDATE messages SET text_body = '[deleted by retention policy]', headers_json = NULL
         WHERE workspace_id = ? AND datetime(received_at) < datetime('now', ?) AND text_body != '[deleted by retention policy]'`, ws.id, `-${ws.retention_days} days`);
  }
  run(`DELETE FROM sent_log WHERE sent_at < datetime('now','-7 days')`);
  run(`DELETE FROM tokens WHERE expires_at < datetime('now')`);
}

async function tick() {
  const t0 = Date.now();
  const boxes = all('SELECT id FROM mailboxes WHERE enabled = 1');
  const queue = [...boxes];
  await Promise.all(Array.from({ length: Math.min(5, queue.length) }, async () => {
    while (queue.length) await syncMailbox(queue.shift().id);
  }));
  await sendDueReplies();
  workerState.ticks++;
  if (workerState.ticks % 15 === 1) { // roughly every 30 minutes at the default interval
    await createFollowUps().catch((e) => console.error('[followups]', e.message));
    purgeOldData();
  }
  await sendDigests().catch((e) => console.error('[digest]', e.message));
  await checkSla().catch((e) => console.error('[sla]', e.message));
  if (workerState.ticks % 5 === 1) await checkLifecycle().catch((e) => console.error('[lifecycle]', e.message));
  workerState.lastTickAt = new Date().toISOString();
  workerState.lastTickMs = Date.now() - t0;
}

export function startWorker() {
  let running = false;
  workerState.startedAt = new Date().toISOString();
  const loop = async () => {
    if (running) return;
    running = true;
    try { await tick(); workerState.lastError = null; } catch (e) { workerState.lastError = e.message; console.error('[worker]', e); } finally { running = false; }
  };
  setTimeout(loop, 5_000);
  // Scheduled replies need a tighter loop than mailbox polling.
  const fast = setInterval(() => sendDueReplies().catch(() => {}), 30_000);
  const timer = setInterval(loop, config.syncIntervalSec * 1000);
  console.log(`[worker] syncing every ${config.syncIntervalSec}s`);
  return () => { clearInterval(timer); clearInterval(fast); };
}
