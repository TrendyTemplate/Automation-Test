// Shared test utilities: HTTP client with cookie jar, fake Anthropic API, real IMAP + SMTP servers.
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const PW = 'Correct-Horse-Battery-91';

export function client(base) {
  const c = { cookie: '' };
  c.call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(c.cookie ? { cookie: c.cookie } : {}), ...headers },
      body: body === undefined || body === null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    for (const sc of res.headers.getSetCookie?.() || []) {
      if (/^(__Host-)?mp_session=/.test(sc)) c.cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  c.signup = async (email, extra = {}) => {
    const r = await c.call('POST', '/api/auth/signup', { email, password: PW, name: email.split('@')[0], ...extra });
    if (r.status !== 200) throw new Error(`signup failed: ${r.status} ${r.text}`);
    return r;
  };
  return c;
}

/** Local fake of the Anthropic Messages API. `reply(body)` returns the JSON object the model "answers". */
export async function fakeAnthropic(reply) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      requests.push({ url: req.url, headers: req.headers, body: json });
      const out = reply(json);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: json.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }],
        usage: { input_tokens: 1000, output_tokens: 200 },
      }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}

export const triage = (over = {}) => ({
  category: 'sales_inquiry', priority: 'normal', sentiment: 'positive', language: 'en', summary: 'Asks about pricing',
  reasoning: 'Pricing question', intent: 'price quote', lead_score: 75, is_phishing: false,
  extracted: { name: '', company: 'Acme', phone: '', budget: '', deadline: '', order_number: '' },
  needs_reply: true, requires_human: false, requires_human_reason: '', confidence: 0.95,
  facts_used: ['Pricing'], unsupported_claims: false, wants_opt_out: false,
  reply_subject: 'Re: Pricing', reply_body: 'Hi! Our Pro plan costs $49 per month. Let me know if you have questions.', ...over,
});

/** Real IMAP server (hoodiecrow) with INBOX + Sent; supports password and XOAUTH2 logins. */
export async function imapServer({ port = 1143, user = 'shop@test.local', password = 'imap-pass', accessToken = 'oauth-token-123' } = {}) {
  const hoodiecrow = require('hoodiecrow-imap');
  const server = hoodiecrow({
    plugins: ['id', 'unselect', 'enable', 'special-use', 'uidplus', 'literalplus', 'idle', 'xoauth2', 'sasl-ir'],
    users: { [user]: { password, xoauth2: { accessToken, sessionTimeout: 3_600_000 } } },
    storage: { INBOX: { messages: [] }, '': { separator: '/', folders: { Sent: { 'special-use': '\\Sent', messages: [] } } } },
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    server, port, user, password, accessToken,
    deliver(raw) { server.appendMessage('INBOX', [], new Date(), raw); },
    folder(name) { return server.getMailbox(name); },
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Real SMTP server (smtp-server) that records every delivered message. */
export async function smtpServer({ port = 2525, user = 'shop@test.local', password = 'imap-pass', accessToken = 'oauth-token-123' } = {}) {
  const { SMTPServer } = require('smtp-server');
  const { simpleParser } = require('mailparser');
  const received = [];
  const server = new SMTPServer({
    disabledCommands: ['STARTTLS'], allowInsecureAuth: true, authMethods: ['PLAIN', 'LOGIN', 'XOAUTH2'], logger: false,
    onAuth(auth, session, cb) {
      const ok = auth.username === user && (auth.password === password || auth.accessToken === accessToken);
      return ok ? cb(null, { user }) : cb(new Error('Invalid credentials'));
    },
    onData(stream, session, cb) {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', async () => {
        const raw = Buffer.concat(chunks);
        received.push({ envelope: session.envelope, raw: raw.toString(), parsed: await simpleParser(raw) });
        cb();
      });
    },
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { received, close: () => new Promise((r) => server.close(r)) };
}

export function rawEmail({ from = 'Customer <customer@example.org>', to = 'shop@test.local', subject = 'Hello', body = 'Hi there', messageId, headers = {}, attachment } = {}) {
  const id = messageId || `<${Math.random().toString(36).slice(2)}@example.org>`;
  const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('');
  if (!attachment) {
    return `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: ${id}\r\nDate: ${new Date().toUTCString()}\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`;
  }
  const b = 'BOUNDARY123';
  return `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: ${id}\r\nDate: ${new Date().toUTCString()}\r\n${extra}MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${b}"\r\n\r\n`
    + `--${b}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`
    + `--${b}\r\nContent-Type: ${attachment.type}; name="${attachment.name}"\r\nContent-Disposition: attachment; filename="${attachment.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(attachment.content).toString('base64')}\r\n--${b}--\r\n`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, { timeout = 8000, every = 100 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('timed out waiting for condition');
    await sleep(every);
  }
}
