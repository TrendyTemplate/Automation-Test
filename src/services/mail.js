import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { appName } from '../settings.js';
import { mailboxAccessToken } from './oauth.js';
import { open } from '../vault.js';
import { resolveMailHost } from './net.js';

const isOAuth = (mb) => String(mb.auth_type || '').startsWith('oauth_');

function mailboxPassword(mb, password) {
  if (password != null) return password;
  const p = mb.password_enc ? open(mb.workspace_id, 'mailboxes.password', mb.password_enc) : '';
  if (!p || p.startsWith('[unreadable')) throw new Error('Mailbox password missing — update it in Email accounts');
  return p;
}

// Connections are pinned to the validated public IP (SSRF / DNS-rebinding safe) while TLS still verifies
// the real hostname. Certificates are always verified (never rejectUnauthorized:false).
async function imapClient(mb, password) {
  const auth = isOAuth(mb)
    ? { user: mb.username, accessToken: await mailboxAccessToken(mb) }
    : { user: mb.username, pass: mailboxPassword(mb, password) };
  const { ip, servername } = await resolveMailHost(mb.imap_host, mb.imap_port);
  return new ImapFlow({
    host: ip, port: mb.imap_port, secure: Boolean(mb.imap_secure), servername,
    tls: { servername, minVersion: 'TLSv1.2' }, auth, logger: false, socketTimeout: 60_000,
    disableAutoIdle: true,
  });
}

async function smtpTransport(mb, password) {
  const auth = isOAuth(mb)
    ? { type: 'OAuth2', user: mb.username, accessToken: await mailboxAccessToken(mb) }
    : { user: mb.username, pass: mailboxPassword(mb, password) };
  const { ip, servername } = await resolveMailHost(mb.smtp_host, mb.smtp_port);
  return nodemailer.createTransport({
    host: ip, port: mb.smtp_port, secure: Boolean(mb.smtp_secure), name: 'mailpilot',
    tls: { servername, minVersion: 'TLSv1.2' }, requireTLS: !mb.smtp_secure && Number(mb.smtp_port) === 587,
    auth, connectionTimeout: 20_000,
  });
}

const htmlToText = (html) => String(html || '').replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

const AI_READABLE = /^(application\/pdf|text\/(plain|csv)|image\/(png|jpeg|gif|webp))$/;

/** Verify IMAP + SMTP credentials before saving a mailbox. Throws with a readable message. */
export async function testConnection(mb, password) {
  const imap = await imapClient(mb, password);
  try {
    await imap.connect();
    await imap.mailboxOpen('INBOX', { readOnly: true });
  } catch (e) {
    throw new Error(`IMAP login failed: ${e.responseText || e.message}`);
  } finally {
    await imap.logout().catch(() => {});
  }
  try {
    await (await smtpTransport(mb, password)).verify();
  } catch (e) {
    throw new Error(`SMTP login failed: ${e.message}`);
  }
}

/**
 * Fetch new messages from INBOX since mailbox.last_uid.
 * On first sync we only take the latest `initialCount` messages so we don't auto-reply to years of history.
 * Returns {messages, lastUid, uidValidity}.
 */
export async function fetchNewMessages(mb, { initialCount = 20, maxBatch = 50 } = {}) {
  const imap = await imapClient(mb);
  await imap.connect();
  const out = [];
  let lastUid = mb.last_uid;
  let uidValidity;
  const connectedAt = mb.created_at ? new Date(`${String(mb.created_at).replace(' ', 'T')}Z`) : new Date();
  try {
    const lock = await imap.getMailboxLock('INBOX');
    try {
      const status = imap.mailbox;
      uidValidity = String(status.uidValidity);
      // First sync = never synced before (no UIDVALIDITY stored) or the server rebuilt the mailbox.
      const isFirstSync = !mb.uid_validity || mb.uid_validity !== uidValidity;
      if (isFirstSync) lastUid = 0;
      let range;
      if (isFirstSync) {
        const uids = (await imap.search({ all: true }, { uid: true })) || [];
        const recent = uids.slice(-initialCount);
        // Remember where "now" is even for an empty mailbox, so the next email is treated as new.
        const nowUid = Math.max(0, ...uids, Number(status.uidNext || 1) - 1);
        if (!recent.length) return { messages: [], lastUid: nowUid, uidValidity, firstSync: true };
        range = recent.join(',');
        lastUid = nowUid;
      } else {
        range = `${lastUid + 1}:*`;
      }
      for await (const m of imap.fetch(range, { uid: true, source: true, internalDate: true }, { uid: true })) {
        if (!isFirstSync && m.uid <= mb.last_uid) continue; // `N:*` returns the last message even when none are new
        if (out.length >= maxBatch) break;
        const parsed = await simpleParser(m.source);
        const headers = {};
        for (const [k, v] of parsed.headers) headers[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
        // mailparser exposes List-Unsubscribe as headers.get('list').unsubscribe = { url?, mail? }
        const unsub = parsed.headers.get('list')?.unsubscribe;
        const unsubUrl = unsub ? ((unsub.url && /^https:/i.test(unsub.url) ? unsub.url : null) || (unsub.mail ? `mailto:${unsub.mail}` : null)) : null;
        const unsubPost = (parsed.headerLines || []).some((h) => h.key === 'list-unsubscribe-post' && /one-click/i.test(h.line));
        const attachments = (parsed.attachments || []).filter((a) => a.contentDisposition !== 'inline' || a.contentType === 'application/pdf').slice(0, 10).map((a) => ({
          filename: String(a.filename || 'attachment').slice(0, 150), contentType: a.contentType, size: a.size,
          // Content is kept in memory only for this processing run (never stored), and only for small, AI-readable files.
          content: AI_READABLE.test(a.contentType) && a.size <= 5_000_000 ? a.content : null,
        }));
        out.push({
          uid: m.uid,
          message_id: parsed.messageId || `uid-${m.uid}@${mb.email}`,
          in_reply_to: parsed.inReplyTo || null,
          references_hdr: Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references || null,
          from_name: parsed.from?.value?.[0]?.name || '',
          from_email: (parsed.from?.value?.[0]?.address || '').toLowerCase(),
          reply_to: (parsed.replyTo?.value?.[0]?.address || '').toLowerCase() || null,
          to_email: parsed.to?.value?.map((a) => a.address).join(', ') || '',
          subject: parsed.subject || '',
          text_body: (parsed.text || htmlToText(parsed.html)).slice(0, 200_000),
          attachments,
          list_unsubscribe: unsubUrl ? String(unsubUrl).slice(0, 500) : null,
          list_unsubscribe_post: unsubPost,
          received_at: (parsed.date || m.internalDate || new Date()).toISOString(),
          headers,
          // History = mail that was already there before the account was connected (never auto-answered).
          firstSync: isFirstSync && (m.internalDate || parsed.date || new Date()) < connectedAt,
        });
        lastUid = Math.max(lastUid, m.uid);
      }
    } finally {
      lock.release();
    }
  } finally {
    await imap.logout().catch(() => {});
  }
  return { messages: out, lastUid, uidValidity };
}

export async function markSeen(mb, uid) {
  const imap = await imapClient(mb);
  await imap.connect();
  try {
    const lock = await imap.getMailboxLock('INBOX');
    try { await imap.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }); } finally { lock.release(); }
  } finally { await imap.logout().catch(() => {}); }
}

/** Send a reply in-thread. Adds RFC 3834 headers so other autoresponders don't reply back. */
export async function sendReply(mb, original, { subject, body, signature, to }) {
  const sig = mb.signature || signature;
  const fullBody = sig ? `${body}\n\n${sig}` : body;
  const subj = subject || (/^re:/i.test(original.subject || '') ? original.subject : `Re: ${original.subject || ''}`);
  const references = [original.references_hdr, original.message_id].filter(Boolean).join(' ');
  const mail = {
    from: mb.label ? `"${mb.label}" <${mb.email}>` : mb.email,
    to: to || original.reply_to || original.from_email,
    subject: subj,
    text: fullBody,
    inReplyTo: original.message_id,
    references,
    headers: { 'Auto-Submitted': 'auto-replied', 'X-MailPilot-Generated': appName() },
  };
  const info = await (await smtpTransport(mb)).sendMail(mail);
  appendToSent(mb, mail).catch(() => {}); // best effort: Gmail stores sent mail itself, many IMAP hosts don't
  return info;
}

export async function forwardEmail(mb, original, to) {
  return (await smtpTransport(mb)).sendMail({
    from: mb.email, to,
    subject: `Fwd: ${original.subject || ''}`,
    text: `---------- Forwarded message ----------\nFrom: ${original.from_name} <${original.from_email}>\nDate: ${original.received_at}\nSubject: ${original.subject}\n\n${original.text_body}`,
    headers: { 'Auto-Submitted': 'auto-generated', 'X-MailPilot-Generated': appName() },
  });
}

async function appendToSent(mb, mail) {
  if (mb.imap_host === 'imap.gmail.com') return;
  const raw = await new Promise((resolve, reject) => {
    nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(mail, (err, info) => (err ? reject(err) : resolve(info.message)));
  });
  const imap = await imapClient(mb);
  await imap.connect();
  try {
    const list = await imap.list();
    const sent = list.find((b) => b.specialUse === '\\Sent') || list.find((b) => /^sent/i.test(b.name));
    if (sent) await imap.append(sent.path, raw, ['\\Seen']);
  } finally { await imap.logout().catch(() => {}); }
}

/** Read recent emails the user wrote themselves (Sent folder) — used to learn their writing style. */
export async function fetchSentSamples(mb, limit = 25) {
  const imap = await imapClient(mb);
  await imap.connect();
  const out = [];
  try {
    const list = await imap.list();
    const sent = list.find((b) => b.specialUse === '\\Sent') || list.find((b) => /sent/i.test(b.name));
    if (!sent) return out;
    const lock = await imap.getMailboxLock(sent.path);
    try {
      const uids = ((await imap.search({ all: true }, { uid: true })) || []).slice(-limit * 2);
      if (!uids.length) return out;
      for await (const m of imap.fetch(uids.join(','), { uid: true, source: true }, { uid: true })) {
        const parsed = await simpleParser(m.source);
        // Strip quoted history so we only learn from what the user actually wrote.
        const own = String(parsed.text || '').split(/\n(On .+wrote:|-{2,} ?Original Message|From: )/)[0].trim();
        if (own.length > 40) out.push({ subject: parsed.subject || '', body: own.slice(0, 1500) });
      }
    } finally { lock.release(); }
  } finally { await imap.logout().catch(() => {}); }
  return out.slice(-limit);
}

/** Send a brand-new email (used for follow-ups to people who didn't answer). */
export async function sendNew(mb, { to, subject, body, inReplyTo, references }) {
  const sig = mb.signature;
  return (await smtpTransport(mb)).sendMail({
    from: mb.label ? `"${mb.label}" <${mb.email}>` : mb.email, to, subject,
    text: sig ? `${body}\n\n${sig}` : body, inReplyTo, references,
    headers: { 'X-MailPilot-Generated': appName() },
  });
}
