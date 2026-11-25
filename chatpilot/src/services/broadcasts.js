// Broadcasts that follow Meta's rules:
//  • Messenger / Instagram: only people who messaged in the last 24 hours (Meta forbids promotions outside it).
//  • WhatsApp: free text inside 24 hours; everyone else only with a template Meta approved (Meta charges per template).
//  • Anyone who wrote "stop" is never messaged again; each send is stored in the chat so the assistant sees it.
import { one, all, run, logActivity } from '../db.js';
import { seal, open } from '../vault.js';
import { replyWindow, sendText, sendTemplate } from './social.js';
import { graph } from './meta.js';
import { emit } from './events.js';

const MAX_RECIPIENTS = 2000;
const PER_DAY = 5;

/** Which customers a broadcast would reach, and why the others are left out. */
export function audience(wsId, b) {
  const ch = one('SELECT * FROM channels WHERE id = ? AND workspace_id = ?', Number(b.channel_id), wsId);
  if (!ch) throw Object.assign(new Error('Choose a connected page or number'), { status: 400 });
  const where = ['v.channel_id = ?', "v.kind = 'message'"]; const p = [ch.id];
  if (b.segment === 'buyers') where.push('EXISTS (SELECT 1 FROM orders o WHERE o.conversation_id = v.id AND o.status NOT IN (\'cancelled\', \'returned\'))');
  if (b.segment === 'not_bought') where.push('NOT EXISTS (SELECT 1 FROM orders o WHERE o.conversation_id = v.id)');
  if (b.label) { where.push("(',' || COALESCE(v.labels, '') || ',') LIKE ?"); p.push(`%,${String(b.label).toLowerCase().slice(0, 40)},%`); }
  const rows = all(`SELECT v.* FROM conversations v WHERE ${where.join(' AND ')} ORDER BY v.last_inbound_at DESC LIMIT ${MAX_RECIPIENTS}`, ...p);
  const out = { channel: ch, send: [], template: [], outside: 0, opted_out: 0 };
  for (const v of rows) {
    if (v.opted_out) { out.opted_out++; continue; }
    if (replyWindow(ch.platform, v).open) out.send.push(v); // 24 h, or 7 days for chats from ads
    else if (ch.platform === 'whatsapp' && b.template?.name) out.template.push(v);
    else out.outside++;
  }
  return out;
}

export function preview(wsId, b) {
  const a = audience(wsId, b);
  return { platform: a.channel.platform, free: a.send.length, template: a.template.length, outside_window: a.outside, opted_out: a.opted_out, total: a.send.length + a.template.length };
}

export async function listTemplates(channel) {
  if (channel.platform !== 'whatsapp' || !channel.waba_id) return [];
  const token = open(channel.workspace_id, 'channels.access_token', channel.access_token_enc);
  const r = await graph(`${encodeURIComponent(channel.waba_id)}/message_templates`, { token, params: { status: 'APPROVED', fields: 'name,language,category,components', limit: '100' } });
  return (r.data || []).map((t) => ({ name: t.name, language: t.language, category: t.category,
    body: (t.components || []).find((x) => x.type === 'BODY')?.text || '', params: ((t.components || []).find((x) => x.type === 'BODY')?.text?.match(/\{\{\d+\}\}/g) || []).length }));
}

/** Create and start a broadcast. Returns its row; sending continues in the background. */
export function createBroadcast(wsId, userId, b) {
  const text = String(b.text || '').trim().slice(0, 2000);
  const template = b.template?.name ? { name: String(b.template.name).slice(0, 512), language: String(b.template.language || 'en').slice(0, 15), params: (b.template.params || []).map((x) => String(x).slice(0, 200)).slice(0, 10) } : null;
  if (!text && !template) throw Object.assign(new Error('Write a message'), { status: 400 });
  if (!b.confirm_optin) throw Object.assign(new Error('Confirm that these customers agreed to hear from you'), { status: 400 });
  const today = one(`SELECT COUNT(*) AS n FROM broadcasts WHERE workspace_id = ? AND created_at > datetime('now', '-1 day')`, wsId).n;
  if (today >= PER_DAY) throw Object.assign(new Error(`At most ${PER_DAY} broadcasts a day — too many messages get pages restricted by Meta`), { status: 429 });
  const a = audience(wsId, { ...b, template });
  if (!text && a.send.length) a.template.push(...a.send.splice(0)); // template-only broadcast
  const total = a.send.length + a.template.length;
  if (!total) throw Object.assign(new Error('Nobody can receive this right now (Meta only allows messages within 24 hours of the customer\'s last message)'), { status: 400 });
  const id = Number(run(`INSERT INTO broadcasts (workspace_id, channel_id, segment, label, body, template_json, total, skipped, status, created_by) VALUES (?,?,?,?,?,?,?,?, 'sending', ?)`,
    wsId, a.channel.id, String(b.segment || 'all').slice(0, 20), b.label ? String(b.label).slice(0, 40) : null, text ? seal(wsId, 'broadcasts.body', text) : null,
    template ? JSON.stringify(template) : null, total, a.outside + a.opted_out, userId).lastInsertRowid);
  logActivity(wsId, 'broadcast', { detail: `${total} recipients` });
  const done = run_(id, a, text, template).catch((e) => {
    console.error('[broadcast]', e.message);
    run(`UPDATE broadcasts SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?`, String(e.message).slice(0, 300), id);
  });
  return { id, total, done };
}

const fill = (s, v) => String(s).replace(/\{\{name\}\}/gi, v.customer_name?.split(' ')[0] || '').replace(/\s{2,}/g, ' ').trim();
async function run_(id, a, text, template) {
  const ch = a.channel;
  const token = open(ch.workspace_id, 'channels.access_token', ch.access_token_enc);
  const delay = Number(process.env.BROADCAST_DELAY_MS ?? 250);
  let sent = 0; let failed = 0;
  const jobs = [...a.send.map((v) => ['text', v]), ...a.template.map((v) => ['template', v])];
  for (const [kind, v] of jobs) {
    const st = one('SELECT status FROM broadcasts WHERE id = ?', id)?.status;
    if (!st || st === 'cancelled') break; // stopped, or the channel / shop was deleted meanwhile
    if (!one('SELECT 1 FROM conversations WHERE id = ?', v.id)) continue;
    const body = kind === 'text' ? fill(text, v) : `[template ${template.name}]`;
    try {
      const ids = kind === 'text'
        ? await sendText(ch, token, v.customer_id, body)
        : [await sendTemplate(ch, token, v.customer_id, template.name, template.language, template.params.map((p) => fill(p, v) || '-'))];
      run(`INSERT INTO chat_messages (workspace_id, conversation_id, direction, source, external_id, body, status, broadcast_id, part_ids) VALUES (?,?, 'out', 'broadcast', ?, ?, 'sent', ?, ?)`,
        ch.workspace_id, v.id, ids[0] || null, seal(ch.workspace_id, 'chat_messages.body', body), id, ids.length > 1 ? JSON.stringify(ids.filter(Boolean)) : null);
      run(`UPDATE conversations SET last_outbound_at = datetime('now') WHERE id = ?`, v.id);
      sent++;
    } catch (e) { failed++; if (failed >= 10 && !sent) { run('UPDATE broadcasts SET error = ? WHERE id = ?', e.message.slice(0, 300), id); break; } }
    run('UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?', sent, failed, id);
    if (delay) await new Promise((r) => setTimeout(r, delay));
  }
  run(`UPDATE broadcasts SET status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE 'done' END, sent = ?, failed = ?, finished_at = datetime('now') WHERE id = ?`, sent, failed, id);
  emit(ch.workspace_id, 'broadcast', { broadcast: id });
}

/** After a restart, broadcasts that were mid-way are marked interrupted (the sent ones are in the chats). */
export function markInterrupted() {
  return run(`UPDATE broadcasts SET status = 'interrupted', finished_at = datetime('now') WHERE status = 'sending'`).changes;
}

export function listBroadcasts(wsId) {
  return all(`SELECT b.*, c.name AS channel_name, c.platform FROM broadcasts b JOIN channels c ON c.id = b.channel_id WHERE b.workspace_id = ? ORDER BY b.id DESC LIMIT 50`, wsId)
    .map((b) => ({ ...b, body: b.body ? open(wsId, 'broadcasts.body', b.body) : '', template: b.template_json ? JSON.parse(b.template_json) : null }));
}
