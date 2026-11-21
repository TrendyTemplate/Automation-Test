import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { decrypt } from '../crypto.js';
import { config } from '../config.js';

function imapClient(mb, password) {
  return new ImapFlow({
    host: mb.imap_host, port: mb.imap_port, secure: Boolean(mb.imap_secure),
    auth: { user: mb.username, pass: password ?? decrypt(mb.password_enc) },
    logger: false, socketTimeout: 60_000,
  });
}

function smtpTransport(mb, password) {
  return nodemailer.createTransport({
    host: mb.smtp_host, port: mb.smtp_port, secure: Boolean(mb.smtp_secure),
    auth: { user: mb.username, pass: password ?? decrypt(mb.password_enc) },
    connectionTimeout: 20_000,
  });
}

/** Verify IMAP + SMTP credentials before saving a mailbox. Throws with a readable message. */
export async function testConnection(mb, password) {
  const imap = imapClient(mb, password);
  try {
    await imap.connect();
    await imap.mailboxOpen('INBOX', { readOnly: true });
  } catch (e) {
    throw new Error(`IMAP login failed: ${e.responseText || e.message}`);
  } finally {
    await imap.logout().catch(() => {});
  }
  try {
    await smtpTransport(mb, password).verify();
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
  const imap = imapClient(mb);
  await imap.connect();
  const out = [];
  let lastUid = mb.last_uid;
  let uidValidity;
  try {
    const lock = await imap.getMailboxLock('INBOX');
    try {
      const status = imap.mailbox;
      uidValidity = String(status.uidValidity);
      if (mb.uid_validity && mb.uid_validity !== uidValidity) lastUid = 0; // mailbox was rebuilt server-side
      const isFirstSync = lastUid === 0;
      let range;
      if (isFirstSync) {
        const uids = (await imap.search({ all: true }, { uid: true })) || [];
        const recent = uids.slice(-initialCount);
        if (!recent.length) return { messages: [], lastUid: 0, uidValidity, firstSync: true };
        range = recent.join(',');
      } else {
        range = `${lastUid + 1}:*`;
      }
      for await (const m of imap.fetch(range, { uid: true, source: true, internalDate: true }, { uid: true })) {
        if (m.uid <= mb.last_uid && !isFirstSync) continue; // `N:*` returns the last message even when none are new
        if (out.length >= maxBatch) break;
        const parsed = await simpleParser(m.source);
        const headers = {};
        for (const [k, v] of parsed.headers) headers[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
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
          text_body: parsed.text || (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, ' ') : ''),
          received_at: (parsed.date || m.internalDate || new Date()).toISOString(),
          headers,
          firstSync: isFirstSync,
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
  const imap = imapClient(mb);
  await imap.connect();
  try {
    const lock = await imap.getMailboxLock('INBOX');
    try { await imap.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }); } finally { lock.release(); }
  } finally { await imap.logout().catch(() => {}); }
}

/** Send a reply in-thread. Adds RFC 3834 headers so other autoresponders don't reply back. */
export async function sendReply(mb, original, { subject, body, signature, to }) {
  const fullBody = signature ? `${body}\n\n${signature}` : body;
  const subj = subject || (/^re:/i.test(original.subject || '') ? original.subject : `Re: ${original.subject || ''}`);
  const references = [original.references_hdr, original.message_id].filter(Boolean).join(' ');
  const mail = {
    from: mb.label ? `"${mb.label}" <${mb.email}>` : mb.email,
    to: to || original.reply_to || original.from_email,
    subject: subj,
    text: fullBody,
    inReplyTo: original.message_id,
    references,
    headers: { 'Auto-Submitted': 'auto-replied', 'X-MailPilot-Generated': config.appName },
  };
  const info = await smtpTransport(mb).sendMail(mail);
  appendToSent(mb, mail).catch(() => {}); // best effort: Gmail stores sent mail itself, many IMAP hosts don't
  return info;
}

export async function forwardEmail(mb, original, to) {
  return smtpTransport(mb).sendMail({
    from: mb.email, to,
    subject: `Fwd: ${original.subject || ''}`,
    text: `---------- Forwarded message ----------\nFrom: ${original.from_name} <${original.from_email}>\nDate: ${original.received_at}\nSubject: ${original.subject}\n\n${original.text_body}`,
    headers: { 'Auto-Submitted': 'auto-generated', 'X-MailPilot-Generated': config.appName },
  });
}

async function appendToSent(mb, mail) {
  if (mb.imap_host === 'imap.gmail.com') return;
  const raw = await new Promise((resolve, reject) => {
    nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(mail, (err, info) => (err ? reject(err) : resolve(info.message)));
  });
  const imap = imapClient(mb);
  await imap.connect();
  try {
    const list = await imap.list();
    const sent = list.find((b) => b.specialUse === '\\Sent') || list.find((b) => /^sent/i.test(b.name));
    if (sent) await imap.append(sent.path, raw, ['\\Seen']);
  } finally { await imap.logout().catch(() => {}); }
}
