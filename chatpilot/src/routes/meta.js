// Meta platform callbacks required for App Review: data deletion request and deauthorization.
// Both receive a `signed_request` (HMAC-SHA256 with the app secret) identifying the Facebook user.
import express, { Router } from 'express';
import { all, run, one, audit, tx } from '../db.js';
import { randomToken } from '../crypto.js';
import { appUrl, appName } from '../settings.js';
import { parseSignedRequest } from '../services/meta.js';

const r = Router();
r.use(express.urlencoded({ extended: false, limit: '20kb' }));

// The user removed our app in Facebook settings: stop using their grants immediately.
r.post('/deauthorize', (req, res) => {
  const data = parseSignedRequest(req.body?.signed_request);
  if (!data) return res.status(400).json({ error: 'Invalid signed_request' });
  const n = run(`UPDATE channels SET enabled = 0, mode = 'off', access_token_enc = '', last_error = 'Access was removed in Facebook settings — click Connect with Facebook to reconnect'
    WHERE managed = 1 AND connected_by = ?`, String(data.user_id)).changes;
  audit(null, 'meta_deauthorize', `fb:${data.user_id}`, { channels: n });
  res.json({ ok: true });
});

// The user asked Facebook to delete the data our app received about them: delete the channels they connected
// (with their conversations, which cascade) and return a status URL + confirmation code, as Meta requires.
r.post('/data-deletion', (req, res) => {
  const data = parseSignedRequest(req.body?.signed_request);
  if (!data) return res.status(400).json({ error: 'Invalid signed_request' });
  const fbUser = String(data.user_id);
  const code = randomToken(10);
  const deleted = tx(() => {
    const ids = all('SELECT id FROM channels WHERE connected_by = ?', fbUser).map((c) => c.id);
    for (const id of ids) run('DELETE FROM channels WHERE id = ?', id);
    run('DELETE FROM meta_pending WHERE fb_user_id = ?', fbUser);
    run('INSERT INTO meta_deletions (code, fb_user_id, channels_deleted) VALUES (?,?,?)', code, fbUser, ids.length);
    return ids.length;
  });
  audit(null, 'meta_data_deletion', `fb:${fbUser}`, { channels: deleted, code });
  res.json({ url: `${appUrl()}/deletion?code=${code}`, confirmation_code: code });
});

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Public status page for a deletion request (linked from Facebook). */
export function deletionStatusPage(req, res) {
  const code = String(req.query.code || '').slice(0, 40);
  const row = /^[a-f0-9]{20}$/.test(code) ? one('SELECT * FROM meta_deletions WHERE code = ?', code) : null;
  res.type('html').set('Cache-Control', 'no-store').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Data deletion status · ${esc(appName())}</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/css/style.css"></head>
<body class="plain"><main class="container" style="max-width:640px;padding:56px 20px"><h1>Data deletion request</h1>
${row ? `<div class="callout ok"><div><b>Completed</b> on ${esc(row.created_at)} UTC.<br>Confirmation code: <code>${esc(row.code)}</code><br>
${row.channels_deleted} connected account(s) and all of their conversations were permanently deleted from ${esc(appName())}.</div></div>`
    : '<div class="callout bad"><div>We could not find a deletion request with this code.</div></div>'}
<p class="muted mt">Questions? See our <a href="/privacy">privacy policy</a>.</p></main></body></html>`);
}

export default r;
