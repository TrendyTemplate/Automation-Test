// AI sales assistant: Meta webhook (public, signature-verified) and the dashboard API (authenticated, tenant-scoped).
import express, { Router } from 'express';
import { one, all, run, logActivity, audit } from '../db.js';
import { requireRole } from '../auth.js';
import { randomToken } from '../crypto.js';
import { seal, open } from '../vault.js';
import { appUrl, getSetting } from '../settings.js';
import { metaConnectAvailable } from '../services/meta.js';
import { PLATFORMS, parseWebhook, verifySignature, insideWindow, replyWindow, windowError, testChannel } from '../services/social.js';
import { handleEvents, deliver, storeOutbound, decide, priceOrder, orderSummary, decryptChat, STAGES, aiBlocked } from '../services/sales.js';
import { aiEnabled } from '../services/ai.js';
import { STATUSES, PAYMENT, createOrder, setStatus, editOrder, deliverySettings, validateDelivery } from '../services/orders.js';
import { notifyOrderStatus, orderTemplates, validateOrderTemplates } from '../services/notifications.js';
import { graph } from '../services/meta.js';
import { subscribe, emit } from '../services/events.js';
import * as webpush from '../services/webpush.js';
import { capiSettings, saveCapi } from '../services/capi.js';
import { preview as broadcastPreview, createBroadcast, listBroadcasts, listTemplates } from '../services/broadcasts.js';
import { paymentSettings, validatePayment, verifyClaim, METHODS } from '../services/payments.js';
import { commentRules, validateRules, validateProfile, applyProfile, saveProfile, businessHours, validateHours, isOpen } from '../services/automation.js';
import { courierStatus, connectCourier, disconnectCourier, bookParcel, refreshStatus, fraudCheck, COURIERS } from '../services/couriers.js';
import { learnFromReply, learnFromDraft, latestProfile, forgetFact, maybeDistill, queueImport } from '../services/learning.js';
import { effectivePlan } from '../plans.js';

// ---------------------------------------------------------------- webhook
export const webhookRouter = Router();

// Meta calls GET once to verify the callback URL: echo hub.challenge if the verify token belongs to a channel.
webhookRouter.get('/', (req, res) => {
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  const platformToken = getSetting('meta_verify_token');
  const ok = req.query['hub.mode'] === 'subscribe' && token.length >= 20 && /^[\w.-]{1,200}$/.test(challenge)
    && ((platformToken && token === platformToken) || one('SELECT id FROM channels WHERE verify_token = ?', token));
  if (!ok) return res.status(403).type('text').send('Forbidden');
  res.type('text').send(challenge);
});

webhookRouter.post('/', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).send('Bad JSON'); }
  const events = parseWebhook(payload);
  const ids = [...new Set(events.map((e) => `${e.platform}:${e.externalId}`))];
  const verified = new Map();
  let rejected = 0;
  for (const key of ids) {
    const [platform, externalId] = key.split(/:(.*)/s);
    // WhatsApp account notices (templates, quality) come with the WhatsApp Business Account id instead of the number id.
    const ch = one('SELECT * FROM channels WHERE platform = ? AND external_id = ? AND enabled = 1', platform, externalId)
      || (platform === 'whatsapp' ? one(`SELECT * FROM channels WHERE platform = 'whatsapp' AND waba_id = ? AND enabled = 1 ORDER BY id LIMIT 1`, externalId) : null);
    if (!ch) continue;
    // Channels connected with "Connect with Facebook" are signed with the platform's app secret.
    const secret = ch.managed ? getSetting('meta_app_secret') : open(ch.workspace_id, 'channels.app_secret', ch.app_secret_enc);
    if (verifySignature(raw, req.headers['x-hub-signature-256'], secret)) verified.set(key, ch);
    else rejected++;
  }
  // Wrong signature = forged request. Unknown accounts are acknowledged so Meta doesn't retry forever.
  if (rejected && !verified.size) return res.status(403).send('Invalid signature');
  res.sendStatus(200); // answer fast; Meta expects a 200 within a few seconds
  if (!verified.size) return;
  // Keep the delivery (encrypted) before processing, so a crash or bug can be replayed instead of losing orders.
  const first = [...verified.values()][0];
  const evId = Number(run('INSERT INTO webhook_events (workspace_id, payload, channels) VALUES (?,?,?)', first.workspace_id,
    seal(first.workspace_id, 'webhook_events.payload', raw.toString('utf8')), JSON.stringify([...verified.entries()].map(([k, c]) => [k, c.id]))).lastInsertRowid);
  processWebhookEvent(evId, events, verified);
});

export function processWebhookEvent(evId, events, verified) {
  try {
    handleEvents(events, verified);
    run(`UPDATE webhook_events SET processed_at = datetime('now'), error = NULL, attempts = attempts + 1 WHERE id = ?`, evId);
  } catch (e) {
    console.error('[sales-webhook]', e.message);
    run('UPDATE webhook_events SET error = ?, attempts = attempts + 1 WHERE id = ?', String(e.message).slice(0, 500), evId);
  }
}
/** Worker: re-run deliveries whose processing failed (duplicate messages are ignored, so this is safe). */
export function replayWebhooks() {
  let n = 0;
  for (const ev of all(`SELECT * FROM webhook_events WHERE processed_at IS NULL AND attempts < 4 AND created_at < datetime('now', '-1 minute') ORDER BY id LIMIT 50`)) {
    const map = new Map();
    for (const [k, id] of JSON.parse(ev.channels)) { const c = one('SELECT * FROM channels WHERE id = ? AND enabled = 1', id); if (c) map.set(k, c); }
    let payload; try { payload = JSON.parse(open(ev.workspace_id, 'webhook_events.payload', ev.payload)); } catch { run('UPDATE webhook_events SET attempts = 99 WHERE id = ?', ev.id); continue; }
    processWebhookEvent(ev.id, parseWebhook(payload), map); n++;
  }
  run(`DELETE FROM webhook_events WHERE created_at < datetime('now', '-3 days')`);
  return n;
}

// ---------------------------------------------------------------- dashboard API
import insights from './insights.js';
const r = Router();
r.use(insights);
const manage = requireRole('owner', 'admin');
const wsId = (req) => req.workspace.id;
const int = (v) => Number.parseInt(v, 10);
const s = (v, max = 1000) => String(v ?? '').trim().slice(0, max);
const bad = (res, msg) => res.status(400).json({ error: msg });

const channelOut = (c) => ({
  id: c.id, platform: c.platform, platform_label: PLATFORMS[c.platform].label, name: c.name, external_id: c.external_id, send_id: c.send_id,
  mode: c.mode, comment_mode: c.comment_mode, enabled: Boolean(c.enabled), managed: Boolean(c.managed),
  history_status: c.history_status, history_stats: c.history_stats ? JSON.parse(c.history_stats) : null, followup_hours: c.followup_hours, greeting: c.greeting,
  last_event_at: c.last_event_at, last_error: c.last_error, created_at: c.created_at,
  verify_token: c.verify_token, webhook_url: `${appUrl()}/api/social/webhook`,
  comment_rules: commentRules(c), profile: c.profile_json ? JSON.parse(c.profile_json) : null, health: c.health || null, health_checked_at: c.health_checked_at, paused_until: c.paused_until, waba_id: c.waba_id,
});

r.get('/overview', (req, res) => {
  const id = wsId(req);
  const c = (sql, ...p) => one(sql, ...p).n || 0;
  res.json({
    aiEnabled: aiEnabled(),
    channels: all('SELECT platform, COUNT(*) AS n FROM channels WHERE workspace_id = ? GROUP BY platform', id),
    conversations: c(`SELECT COUNT(*) AS n FROM conversations WHERE workspace_id = ? AND last_inbound_at > datetime('now','-30 days')`, id),
    needsHuman: c(`SELECT COUNT(*) AS n FROM conversations WHERE workspace_id = ? AND status = 'needs_human'`, id),
    drafts: c(`SELECT COUNT(*) AS n FROM chat_messages WHERE workspace_id = ? AND status = 'draft'`, id),
    aiSent: c(`SELECT COUNT(*) AS n FROM chat_messages WHERE workspace_id = ? AND source = 'ai' AND status = 'sent' AND created_at > datetime('now','-30 days')`, id),
    orders: one(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS revenue FROM orders WHERE workspace_id = ? AND status != 'cancelled' AND created_at > datetime('now','-30 days')`, id),
    byStage: all(`SELECT stage, COUNT(*) AS n FROM conversations WHERE workspace_id = ? AND last_inbound_at > datetime('now','-30 days') GROUP BY stage`, id),
    products: c('SELECT COUNT(*) AS n FROM products WHERE workspace_id = ? AND active = 1', id),
  });
});

// ----- channels
r.get('/channels', manage, (req, res) => res.json(all('SELECT * FROM channels WHERE workspace_id = ? ORDER BY id', wsId(req)).map(channelOut)));

function channelInput(b, existing = null) {
  const out = {};
  if (!existing) {
    if (!PLATFORMS[b.platform]) throw new Error('Choose Messenger, Instagram or WhatsApp');
    out.platform = b.platform;
    out.external_id = s(b.external_id, 64);
    if (!/^\d{5,32}$/.test(out.external_id)) throw new Error(b.platform === 'whatsapp' ? 'Phone number ID must be the numeric ID from WhatsApp Manager (not the phone number)' : 'Page / account ID must be numeric');
  }
  if (b.send_id !== undefined) { out.send_id = s(b.send_id, 64) || null; if (out.send_id && !/^\d{5,32}$/.test(out.send_id)) throw new Error('Send ID must be numeric'); }
  if (b.name !== undefined) out.name = s(b.name, 100);
  if (b.access_token) out.access_token = s(b.access_token, 2000);
  if (b.app_secret) { out.app_secret = s(b.app_secret, 200); if (!/^[0-9a-f]{16,64}$/i.test(out.app_secret)) throw new Error('App secret should be the hex string from Meta app → Settings → Basic'); }
  if (b.mode !== undefined) { if (!['off', 'draft', 'auto'].includes(b.mode)) throw new Error('Invalid mode'); out.mode = b.mode; }
  if (b.comment_mode !== undefined) { if (!['off', 'draft', 'auto'].includes(b.comment_mode)) throw new Error('Invalid comment mode'); out.comment_mode = b.comment_mode; }
  if (b.enabled !== undefined) out.enabled = b.enabled ? 1 : 0;
  if (b.followup_hours !== undefined) out.followup_hours = Math.max(0, Math.min(20, int(b.followup_hours) || 0));
  if (b.greeting !== undefined) out.greeting = s(b.greeting, 500) || null;
  if (!existing && (!out.access_token || !out.app_secret)) throw new Error('Access token and app secret are required');
  return out;
}

r.post('/channels', manage, async (req, res) => {
  let v;
  try { v = channelInput(req.body || {}); } catch (e) { return bad(res, e.message); }
  const plan = effectivePlan(req.workspace);
  if (one('SELECT COUNT(*) AS n FROM channels WHERE workspace_id = ?', wsId(req)).n >= plan.channels) {
    return res.status(402).json({ error: `Your ${plan.name} plan includes ${plan.channels} channel(s). Upgrade to connect more.` });
  }
  if (one('SELECT id FROM channels WHERE platform = ? AND external_id = ?', v.platform, v.external_id)) return res.status(409).json({ error: 'This account is already connected (in this or another workspace).' });
  let name = v.name;
  if (req.body.test !== false) {
    try { name ||= (await testChannel({ platform: v.platform, external_id: v.external_id, send_id: v.send_id }, v.access_token)).name; } catch (e) {
      return bad(res, `Meta rejected the token: ${e.message}`);
    }
  }
  const id = Number(run(`INSERT INTO channels (workspace_id, platform, name, external_id, send_id, access_token_enc, app_secret_enc, verify_token, mode, followup_hours, greeting)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, wsId(req), v.platform, name || PLATFORMS[v.platform].label, v.external_id, v.send_id || null,
  seal(wsId(req), 'channels.access_token', v.access_token), seal(wsId(req), 'channels.app_secret', v.app_secret),
  `mp_${randomToken(24)}`, v.mode || 'draft', v.followup_hours || 0, v.greeting || null).lastInsertRowid);
  audit(req, 'channel.connect', id, { platform: v.platform });
  queueImport(id);
  logActivity(wsId(req), 'channel_added', { platform: v.platform, name });
  res.json(channelOut(one('SELECT * FROM channels WHERE id = ?', id)));
});

r.put('/channels/:id', manage, (req, res) => {
  const ch = one('SELECT * FROM channels WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!ch) return res.status(404).json({ error: 'Not found' });
  let v;
  try { v = channelInput(req.body || {}, ch); } catch (e) { return bad(res, e.message); }
  const sets = []; const vals = [];
  for (const k of ['name', 'send_id', 'mode', 'comment_mode', 'enabled', 'followup_hours', 'greeting']) if (k in v) { sets.push(`${k} = ?`); vals.push(v[k]); }
  if (v.access_token) { sets.push('access_token_enc = ?'); vals.push(seal(ch.workspace_id, 'channels.access_token', v.access_token)); }
  if (v.app_secret) { sets.push('app_secret_enc = ?'); vals.push(seal(ch.workspace_id, 'channels.app_secret', v.app_secret)); }
  if (sets.length) run(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`, ...vals, ch.id);
  res.json(channelOut(one('SELECT * FROM channels WHERE id = ?', ch.id)));
});

r.delete('/channels/:id', manage, (req, res) => {
  const ch = one('SELECT id, platform FROM channels WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!ch) return res.status(404).json({ error: 'Not found' });
  run('DELETE FROM channels WHERE id = ?', ch.id);
  audit(req, 'channel.delete', ch.id, { platform: ch.platform });
  res.json({ ok: true });
});

// ----- "Connect with Facebook": pick which Pages / Instagram accounts / WhatsApp numbers to connect
r.get('/pages', (req, res) => res.json(all('SELECT id, name, platform, mode, comment_mode, enabled, history_status FROM channels WHERE workspace_id = ? ORDER BY id', wsId(req))));
r.get('/meta/status', (req, res) => res.json({ available: metaConnectAvailable() }));


// ----- learning: what the assistant has learned from each page (fully automatic; this is for transparency)
r.get('/learning', (req, res) => {
  const id = wsId(req);
  const channels = all('SELECT id, platform, name, history_status, history_stats, created_at FROM channels WHERE workspace_id = ? ORDER BY id', id).map((c) => {
    const p = one('SELECT * FROM learned_profiles WHERE workspace_id = ? AND channel_id = ? ORDER BY id DESC LIMIT 1', id, c.id);
    const lp = p ? latestProfile(id, c.id) : null;
    return { ...c, history_stats: c.history_stats ? JSON.parse(c.history_stats) : null,
      examples: one('SELECT COUNT(*) AS n FROM learn_examples WHERE channel_id = ? AND weight > 0', c.id).n,
      from_history: one(`SELECT COUNT(*) AS n FROM learn_examples WHERE channel_id = ? AND source = 'history'`, c.id).n,
      from_live: one(`SELECT COUNT(*) AS n FROM learn_examples WHERE channel_id = ? AND source != 'history' AND weight > 0`, c.id).n,
      corrections: one(`SELECT COUNT(*) AS n FROM learn_examples WHERE channel_id = ? AND source IN ('ai_edited', 'ai_rejected')`, c.id).n,
      learned_at: p?.created_at || null, profile: lp?.profile || null };
  });
  const recent = all(`SELECT id, channel_id, kind, source, weight, outcome, happened_at, question_enc, answer_enc FROM learn_examples WHERE workspace_id = ? AND source != 'history' ORDER BY id DESC LIMIT 15`, id)
    .map((x) => ({ id: x.id, channel_id: x.channel_id, kind: x.kind, source: x.source, weight: x.weight, outcome: x.outcome, happened_at: x.happened_at,
      question: open(id, 'learn.question', x.question_enc).slice(0, 200), answer: open(id, 'learn.answer', x.answer_enc).slice(0, 300) }));
  res.json({ channels, recent, total: one('SELECT COUNT(*) AS n FROM learn_examples WHERE workspace_id = ? AND weight > 0', id).n });
});
r.post('/learning/forget', manage, (req, res) => {
  if (!s(req.body?.fact)) return bad(res, 'Which fact?');
  forgetFact(wsId(req), s(req.body.fact, 300));
  res.json({ ok: true });
});
r.post('/learning/refresh', manage, async (req, res) => {
  const blocked = aiBlocked(one('SELECT * FROM workspaces WHERE id = ?', wsId(req)));
  if (blocked) return res.status(402).json({ error: blocked });
  for (const c of all('SELECT id, history_status FROM channels WHERE workspace_id = ?', wsId(req))) if (['failed', null].includes(c.history_status)) queueImport(c.id);
  await maybeDistill(wsId(req), { force: true });
  res.json({ ok: true });
});

// ----- live updates (Server-Sent Events)
r.get('/stream', (req, res) => {
  res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.flushHeaders?.();
  res.write('retry: 5000\nevent: hello\ndata: {}\n\n');
  const off = subscribe(wsId(req), res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25_000);
  req.on('close', () => { clearInterval(ping); off(); });
});

// ----- saved replies (type "/" in the reply box)
r.get('/saved-replies', (req, res) => res.json(all('SELECT * FROM saved_replies WHERE workspace_id = ? ORDER BY uses DESC, shortcut', wsId(req))));
r.post('/saved-replies', (req, res) => {
  const shortcut = s(req.body?.shortcut, 40).replace(/^\//, '').toLowerCase().replace(/\s+/g, '-');
  const body = s(req.body?.body, 2000);
  if (!/^[\p{L}\p{N}_-]{1,40}$/u.test(shortcut) || !body) return bad(res, 'Give it a short name (letters, numbers, -) and the reply text');
  try { const id = run('INSERT INTO saved_replies (workspace_id, shortcut, body) VALUES (?,?,?)', wsId(req), shortcut, body).lastInsertRowid; res.json(one('SELECT * FROM saved_replies WHERE id = ?', id)); }
  catch { res.status(409).json({ error: `/${shortcut} already exists` }); }
});
r.put('/saved-replies/:id', (req, res) => {
  const body = s(req.body?.body, 2000);
  if (!body) return bad(res, 'Reply text is required');
  run('UPDATE saved_replies SET body = ? WHERE id = ? AND workspace_id = ?', body, int(req.params.id), wsId(req));
  res.json({ ok: true });
});
r.post('/saved-replies/:id/used', (req, res) => { run('UPDATE saved_replies SET uses = uses + 1 WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req)); res.json({ ok: true }); });
r.delete('/saved-replies/:id', (req, res) => { run('DELETE FROM saved_replies WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req)); res.json({ ok: true }); });

// ----- internal notes on a conversation (never sent to the customer)
r.post('/conversations/:id/notes', (req, res) => {
  const v = one('SELECT id FROM conversations WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!v) return res.status(404).json({ error: 'Not found' });
  const body = s(req.body?.body, 2000);
  if (!body) return bad(res, 'Write a note');
  run('INSERT INTO conversation_notes (workspace_id, conversation_id, user_id, body) VALUES (?,?,?,?)', wsId(req), v.id, req.user.id, seal(wsId(req), 'notes.body', body));
  emit(wsId(req), 'note', { conversation: v.id });
  res.json({ ok: true });
});
r.get('/team-members', (req, res) => res.json(all(`SELECT u.id, u.name, u.email FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name`, wsId(req))));

// ----- products (catalog)
function productInput(b) {
  const p = {
    name: s(b.name, 200), sku: s(b.sku, 64) || null, description: s(b.description, 2000) || null, variants: s(b.variants, 500) || null,
    price: Number(b.price), currency: (s(b.currency, 3) || 'BDT').toUpperCase(),
    stock: b.stock === '' || b.stock == null ? null : int(b.stock), image_url: s(b.image_url, 500) || null, active: b.active === false ? 0 : 1,
  };
  if (!p.name) throw new Error('Product name is required');
  if (!(p.price >= 0 && p.price < 1e9)) throw new Error('Enter a valid price');
  if (!/^[A-Z]{3}$/.test(p.currency)) throw new Error('Currency must be a 3-letter code like BDT or USD');
  if (p.stock != null && !(p.stock >= 0)) throw new Error('Stock must be 0 or more (leave empty if not tracked)');
  if (p.image_url && !/^https:\/\//.test(p.image_url)) throw new Error('Image URL must start with https://');
  // "M:5, L:0, XL:3" or {"M":5} → per-option stock; the total stock follows it.
  const vs = typeof b.variant_stock === 'object' && b.variant_stock ? Object.entries(b.variant_stock)
    : String(b.variant_stock || '').split(/[,\n]/).map((x) => x.split(':')).filter((x) => x.length === 2);
  const clean = vs.slice(0, 60).map(([k, v]) => [s(k, 60), int(v)]).filter(([k]) => k);
  for (const [k, v] of clean) if (!(v >= 0)) throw new Error(`Stock for "${k}" must be 0 or more`);
  p.variant_stock = clean.length ? JSON.stringify(Object.fromEntries(clean)) : null;
  if (p.variant_stock) p.stock = clean.reduce((a, [, v]) => a + v, 0);
  return p;
}
r.get('/products', (req, res) => res.json(all('SELECT * FROM products WHERE workspace_id = ? ORDER BY active DESC, name', wsId(req))));
const productRoom = (req) => effectivePlan(req.workspace).products - one('SELECT COUNT(*) AS n FROM products WHERE workspace_id = ?', wsId(req)).n;
r.post('/products', manage, (req, res) => {
  if (productRoom(req) <= 0) return res.status(402).json({ error: `Your plan's product limit is reached (${effectivePlan(req.workspace).products}). Upgrade or remove old products.` });
  let p; try { p = productInput(req.body || {}); } catch (e) { return bad(res, e.message); }
  const id = run(`INSERT INTO products (workspace_id, name, sku, description, variants, price, currency, stock, image_url, active, variant_stock) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    wsId(req), p.name, p.sku, p.description, p.variants, p.price, p.currency, p.stock, p.image_url, p.active, p.variant_stock).lastInsertRowid;
  res.json(one('SELECT * FROM products WHERE id = ?', id));
});
r.post('/products/import', manage, (req, res) => {
  // CSV: name,price,stock,sku,variants,description (header row optional)
  const lines = String(req.body?.csv || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 1000);
  const parse = (line) => { const out = []; let cur = ''; let q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
  let added = 0; const errors = [];
  let room = productRoom(req);
  lines.forEach((line, i) => {
    const [name, price, stock, sku, variants, description] = parse(line);
    if (i === 0 && /^name$/i.test(name)) return;
    if (room <= 0) { errors.push(`line ${i + 1}: plan product limit reached`); return; }
    try {
      const p = productInput({ name, price, stock, sku, variants, description, currency: req.body.currency });
      run(`INSERT INTO products (workspace_id, name, sku, description, variants, price, currency, stock) VALUES (?,?,?,?,?,?,?,?)`,
        wsId(req), p.name, p.sku, p.description, p.variants, p.price, p.currency, p.stock);
      added++; room--;
    } catch (e) { errors.push(`line ${i + 1}: ${e.message}`); }
  });
  res.json({ added, errors: errors.slice(0, 20) });
});
r.put('/products/:id', manage, (req, res) => {
  const ex = one('SELECT id FROM products WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!ex) return res.status(404).json({ error: 'Not found' });
  let p; try { p = productInput(req.body || {}); } catch (e) { return bad(res, e.message); }
  run('UPDATE products SET name=?, sku=?, description=?, variants=?, price=?, currency=?, stock=?, image_url=?, active=?, variant_stock=? WHERE id=?',
    p.name, p.sku, p.description, p.variants, p.price, p.currency, p.stock, p.image_url, p.active, p.variant_stock, ex.id);
  res.json(one('SELECT * FROM products WHERE id = ?', ex.id));
});
r.delete('/products/:id', manage, (req, res) => {
  run('DELETE FROM products WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  res.json({ ok: true });
});

// ----- conversations
r.get('/conversations', (req, res) => {
  const where = ['v.workspace_id = ?']; const p = [wsId(req)];
  if (PLATFORMS[req.query.platform]) { where.push('c.platform = ?'); p.push(req.query.platform); }
  if (int(req.query.channel)) { where.push('c.id = ?'); p.push(int(req.query.channel)); }
  if (['message', 'comment'].includes(req.query.kind)) { where.push('v.kind = ?'); p.push(req.query.kind); }
  if (req.query.label) { where.push("(',' || v.labels || ',') LIKE ?"); p.push(`%,${s(req.query.label, 30).toLowerCase()},%`); }
  if (req.query.view === 'mine') { where.push('v.assigned_to = ?'); p.push(req.user.id); }
  if (req.query.view === 'unassigned') where.push("v.assigned_to IS NULL AND v.status = 'needs_human'");
  if (['open', 'needs_human', 'closed'].includes(req.query.status)) { where.push('v.status = ?'); p.push(req.query.status); }
  if (req.query.view === 'drafts') where.push(`EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = v.id AND m.status = 'draft')`);
  // Waiting for an answer longer than the shop's target (no reply since their last message).
  if (req.query.view === 'overdue') {
    where.push(`v.status <> 'closed' AND v.last_inbound_at IS NOT NULL AND (v.last_outbound_at IS NULL OR v.last_outbound_at < v.last_inbound_at)
      AND v.last_inbound_at < datetime('now', '-' || (SELECT sla_minutes FROM workspaces WHERE id = v.workspace_id) || ' minutes')`);
  }
  if (req.query.view === 'snoozed') where.push(`v.snoozed_until > datetime('now')`);
  else if (!req.query.q) where.push(`(v.snoozed_until IS NULL OR v.snoozed_until <= datetime('now'))`);
  if (req.query.view === 'closed') where.push(`v.status = 'closed'`);
  if (STAGES.includes(req.query.stage)) { where.push('v.stage = ?'); p.push(req.query.stage); }
  if (req.query.q) { where.push('(v.customer_name LIKE ? OR v.customer_phone LIKE ? OR v.intent LIKE ?)'); const q = `%${s(req.query.q, 100)}%`; p.push(q, q, q); }
  const rows = all(`SELECT v.*, c.platform, c.name AS channel_name,
      (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = v.id AND m.status = 'draft') AS drafts,
      (SELECT body FROM chat_messages m WHERE m.conversation_id = v.id ORDER BY id DESC LIMIT 1) AS last_body,
      (SELECT COALESCE(u.name, u.email) FROM users u WHERE u.id = v.assigned_to) AS assignee
    FROM conversations v JOIN channels c ON c.id = v.channel_id WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(v.last_inbound_at, v.created_at) DESC LIMIT ?`, ...p, Math.min(200, int(req.query.limit) || 100));
  res.json(rows.map((v) => ({ ...v, last_body: String(open(v.workspace_id, 'chat_messages.body', v.last_body) || '').slice(0, 140),
    can_reply: v.kind === 'comment' || replyWindow(v.platform, v, { human: true }).open, labels: v.labels ? v.labels.split(',') : [] })));
});

const getConv = (req) => one(`SELECT v.*, c.platform, c.name AS channel_name, c.mode AS channel_mode FROM conversations v JOIN channels c ON c.id = v.channel_id
  WHERE v.id = ? AND v.workspace_id = ?`, int(req.params.id), wsId(req));

r.get('/conversations/:id', (req, res) => {
  const v = getConv(req);
  if (!v) return res.status(404).json({ error: 'Not found' });
  run('UPDATE conversations SET unread = 0 WHERE id = ?', v.id);
  const messages = all('SELECT * FROM chat_messages WHERE conversation_id = ? AND status != \'rejected\' ORDER BY id DESC LIMIT 200', v.id).reverse().map(decryptChat)
    .map((m) => ({ ...m, guard: m.guard_json ? JSON.parse(m.guard_json) : [] }));
  const orders = all('SELECT * FROM orders WHERE conversation_id = ? ORDER BY id DESC', v.id).map((o) => ({ ...o, items: JSON.parse(o.items_json) }));
  const notes = all(`SELECT n.id, n.body, n.created_at, u.name AS author, u.email AS author_email FROM conversation_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.conversation_id = ? ORDER BY n.id`, v.id)
    .map((n) => ({ ...n, body: open(v.workspace_id, 'notes.body', n.body) }));
  const rw = replyWindow(v.platform, v, { human: true });
  res.json({ ...v, can_reply: v.kind === 'comment' || rw.open, reply_tag: rw.tag || null, ai_window: v.kind === 'comment' || replyWindow(v.platform, v).open, messages, orders, notes, labels: v.labels ? v.labels.split(',') : [], referral: v.referral_json ? JSON.parse(v.referral_json) : null,
    ai_paused: Boolean(v.ai_paused_until && new Date(`${v.ai_paused_until.replace(' ', 'T')}Z`) > new Date()) });
});

r.post('/conversations/:id/reply', async (req, res) => {
  const v = getConv(req);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const body = s(req.body?.body, 4000);
  if (!body) return bad(res, 'Write a message first');
  if (v.kind !== 'comment' && !replyWindow(v.platform, v, { human: true }).open) return res.status(409).json({ error: windowError(v.platform) });
  // A person answering pauses the AI for this chat (default 12h) so it doesn't talk over them.
  run(`UPDATE chat_messages SET status = 'rejected' WHERE conversation_id = ? AND status = 'draft'`, v.id);
  const id = storeOutbound(v, body, { source: 'human', status: 'draft', userId: req.user.id });
  if (req.body.pause_ai !== false) run(`UPDATE conversations SET ai_paused_until = datetime('now', '+12 hours') WHERE id = ?`, v.id);
  try { await deliver(id, req.user.id); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  learnFromReply(v.id, id, 'human', 1); // every answer a person writes teaches the assistant
  res.json({ ok: true, id });
});

r.post('/messages/:id/approve', async (req, res) => {
  const m = one(`SELECT * FROM chat_messages WHERE id = ? AND workspace_id = ? AND status IN ('draft', 'failed')`, int(req.params.id), wsId(req));
  if (!m) return res.status(404).json({ error: 'Draft not found' });
  const original = m.ai_original ? open(m.workspace_id, 'chat_messages.ai_original', m.ai_original) : open(m.workspace_id, 'chat_messages.body', m.body);
  let final = open(m.workspace_id, 'chat_messages.body', m.body);
  if (req.body?.body != null) {
    final = s(req.body.body, 4000);
    if (!final) return bad(res, 'Message is empty');
    run('UPDATE chat_messages SET body = ? WHERE id = ?', seal(m.workspace_id, 'chat_messages.body', final), m.id);
  }
  try { await deliver(m.id, req.user.id); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  if (m.source === 'ai') learnFromDraft(m.conversation_id, m.id, { original, final, action: 'sent' });
  logActivity(wsId(req), 'chat_approved_sent', { conversation: m.conversation_id, by: req.user.name || req.user.email });
  res.json({ ok: true });
});
r.post('/messages/:id/reject', (req, res) => {
  const m = one(`SELECT * FROM chat_messages WHERE id = ? AND workspace_id = ? AND status IN ('draft', 'failed')`, int(req.params.id), wsId(req));
  if (!m) return res.json({ ok: true });
  run(`UPDATE chat_messages SET status = 'rejected' WHERE id = ?`, m.id);
  if (m.source === 'ai') learnFromDraft(m.conversation_id, m.id, { original: open(m.workspace_id, 'chat_messages.body', m.body), action: 'rejected' });
  res.json({ ok: true });
});

r.put('/conversations/:id', (req, res) => {
  const v = getConv(req);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.status && ['open', 'needs_human', 'closed'].includes(b.status)) run('UPDATE conversations SET status = ?, handoff_reason = CASE WHEN ? = \'needs_human\' THEN handoff_reason ELSE NULL END WHERE id = ?', b.status, b.status, v.id);
  if (b.stage && STAGES.includes(b.stage)) run('UPDATE conversations SET stage = ? WHERE id = ?', b.stage, v.id);
  if (b.snooze !== undefined) {
    const hours = Number(b.snooze) || 0;
    if (hours < 0 || hours > 24 * 30) return bad(res, 'Snooze for up to 30 days');
    run(`UPDATE conversations SET snoozed_until = ${hours ? "datetime('now', '+' || ? || ' minutes')" : 'NULL'}, unread = 0 WHERE id = ?`, ...(hours ? [Math.round(hours * 60), v.id] : [v.id]));
  }
  if (b.status === 'closed') run('UPDATE conversations SET unread = 0 WHERE id = ?', v.id);
  if (b.ai_paused === true) run(`UPDATE conversations SET ai_paused_until = datetime('now', '+30 days') WHERE id = ?`, v.id);
  if (b.ai_paused === false) run('UPDATE conversations SET ai_paused_until = NULL WHERE id = ?', v.id);
  for (const k of ['customer_name', 'customer_phone', 'customer_address']) if (b[k] !== undefined) run(`UPDATE conversations SET ${k} = ? WHERE id = ?`, s(b[k], 500) || null, v.id);
  if (b.labels !== undefined) {
    const labels = [...new Set((Array.isArray(b.labels) ? b.labels : String(b.labels).split(',')).map((x) => s(x, 30).trim().toLowerCase()).filter(Boolean))].slice(0, 10);
    run('UPDATE conversations SET labels = ? WHERE id = ?', labels.join(',') || null, v.id);
  }
  if (b.assigned_to !== undefined) {
    const uid = b.assigned_to ? int(b.assigned_to) : null;
    if (uid && !one('SELECT 1 AS x FROM workspace_members WHERE workspace_id = ? AND user_id = ?', wsId(req), uid)) return bad(res, 'Not a member of this workspace');
    run('UPDATE conversations SET assigned_to = ? WHERE id = ?', uid, v.id);
  }
  emit(wsId(req), 'conversation', { conversation: v.id });
  res.json({ ok: true });
});

// ----- orders
const orderOut = (o) => ({ ...o, items: JSON.parse(o.items_json) });
r.get('/orders', (req, res) => {
  const where = ['o.workspace_id = ?']; const p = [wsId(req)];
  if (STATUSES.includes(req.query.status)) { where.push('o.status = ?'); p.push(req.query.status); }
  if (req.query.q) { where.push('(o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.tracking_code LIKE ? OR CAST(o.id AS TEXT) = ?)'); const q = `%${s(req.query.q, 60)}%`; p.push(q, q, q, s(req.query.q, 20)); }
  if (int(req.query.channel)) { where.push('v.channel_id = ?'); p.push(int(req.query.channel)); }
  res.json(all(`SELECT o.*, c.platform, c.name AS channel_name FROM orders o LEFT JOIN conversations v ON v.id = o.conversation_id LEFT JOIN channels c ON c.id = v.channel_id
    WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 500`, ...p).map(orderOut));
});
r.get('/orders/:id', (req, res) => {
  const o = one(`SELECT o.*, c.platform, c.name AS channel_name FROM orders o LEFT JOIN conversations v ON v.id = o.conversation_id LEFT JOIN channels c ON c.id = v.channel_id
    WHERE o.id = ? AND o.workspace_id = ?`, int(req.params.id), wsId(req));
  if (!o) return res.status(404).json({ error: 'Not found' });
  res.json({ ...orderOut(o), shop: { name: req.workspace.business_name || req.workspace.name, description: req.workspace.business_description || '' } });
});
// Manual order (phone call, walk-in, or a chat the AI didn't handle).
r.post('/orders', (req, res) => {
  const b = req.body || {};
  const name = s(b.customer_name, 120); const phone = s(b.customer_phone, 40); const address = s(b.customer_address, 500);
  if (!name || !phone || !address) return bad(res, 'Name, phone and address are required');
  const priced = priceOrder(wsId(req), b.items, { address, zone: b.delivery_zone, discount: b.discount, coupon: b.coupon });
  if (!priced.lines.length || priced.problems.length) return bad(res, priced.problems.join('; ') || 'Add at least one product');
  const convId = int(b.conversation_id) && one('SELECT id FROM conversations WHERE id = ? AND workspace_id = ?', int(b.conversation_id), wsId(req)) ? int(b.conversation_id) : null;
  const id = createOrder(wsId(req), { conversationId: convId, priced, name, phone, address, note: b.note, source: 'manual',
    paymentStatus: b.payment_status, paidAmount: b.paid_amount, paymentMethod: s(b.payment_method, 40) || null });
  logActivity(wsId(req), 'order_created', { order: id, total: priced.total, currency: priced.currency, from: name, by: req.user.name || req.user.email });
  res.json(orderOut(one('SELECT * FROM orders WHERE id = ?', id)));
});
r.put('/orders/:id', async (req, res) => {
  const o = one('SELECT * FROM orders WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!o) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  try {
    // Only re-calculate when the products, zone, discount or address really changed (a status change must not re-price).
    const sameItems = b.items === undefined || JSON.stringify((b.items || []).map((l) => [Number(l.product_id), Number(l.qty), String(l.variant || '').toLowerCase()]))
      === JSON.stringify(JSON.parse(o.items_json).map((l) => [Number(l.product_id), Number(l.qty), String(l.variant || '').toLowerCase()]));
    const ch = {
      items: sameItems ? undefined : b.items,
      address: b.customer_address !== undefined && s(b.customer_address, 500) !== (o.customer_address || '') ? s(b.customer_address, 500) : undefined,
      zone: b.delivery_zone !== undefined && (b.delivery_zone || null) !== (o.delivery_zone || null) ? b.delivery_zone : undefined,
      discount: b.discount !== undefined && Number(b.discount) !== Number(o.discount || 0) ? b.discount : undefined,
    };
    if (Object.values(ch).some((v) => v !== undefined)) editOrder(o, ch);
    for (const k of ['customer_name', 'customer_phone', 'customer_address', 'note', 'payment_method']) if (b[k] !== undefined) run(`UPDATE orders SET ${k} = ? WHERE id = ?`, s(b[k], 500) || null, o.id);
    if (b.payment_status !== undefined) { if (!PAYMENT.includes(b.payment_status)) return bad(res, 'Invalid payment status'); run('UPDATE orders SET payment_status = ? WHERE id = ?', b.payment_status, o.id); }
    if (b.paid_amount !== undefined) run('UPDATE orders SET paid_amount = ? WHERE id = ?', Math.max(0, Number(b.paid_amount) || 0), o.id);
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) return bad(res, 'Invalid status');
      if (setStatus(one('SELECT * FROM orders WHERE id = ?', o.id), b.status)) await notifyOrderStatus(o.id).catch(() => {});
    }
  } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  res.json(orderOut(one('SELECT * FROM orders WHERE id = ?', o.id)));
});
r.get('/orders.csv', (req, res) => {
  const rows = all('SELECT * FROM orders WHERE workspace_id = ? ORDER BY id DESC', wsId(req));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
  res.type('text/csv').attachment('orders.csv').send(['id,date,status,customer,phone,address,items,subtotal,delivery_zone,delivery_charge,discount,total,currency,payment_status,paid,courier,tracking',
    ...rows.map((o) => [o.id, o.created_at, o.status, o.customer_name, o.customer_phone, o.customer_address,
      JSON.parse(o.items_json).map((l) => `${l.qty}x ${l.name}${l.variant ? ` (${l.variant})` : ''}`).join('; '), o.subtotal ?? o.total, o.delivery_zone, o.delivery_charge, o.discount, o.total, o.currency,
      o.payment_status, o.paid_amount, o.courier, o.tracking_code].map(q).join(','))].join('\n'));
});
// ----- couriers (Steadfast, Pathao, RedX) + fraud check
r.get('/couriers', (req, res) => {
  const st = courierStatus(one('SELECT * FROM workspaces WHERE id = ?', wsId(req)));
  if (!['owner', 'admin'].includes(req.role)) delete st.webhookToken; // the URL secret lets anyone move orders
  res.json({ ...st, webhook_base: `${appUrl()}/api/couriers/hook/` });
});
r.put('/couriers/:name', manage, async (req, res) => {
  try { res.json(await connectCourier(one('SELECT * FROM workspaces WHERE id = ?', wsId(req)), req.params.name, req.body)); audit(req, 'courier.connect', req.params.name); }
  catch (e) { res.status(400).json({ error: `${COURIERS[req.params.name]?.label || 'Courier'} rejected the keys: ${e.message}` }); }
});
r.delete('/couriers/:name', manage, (req, res) => { disconnectCourier(one('SELECT * FROM workspaces WHERE id = ?', wsId(req)), req.params.name); res.json({ ok: true }); });
r.post('/orders/:id/courier', async (req, res) => {
  const o = one('SELECT * FROM orders WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!o) return res.status(404).json({ error: 'Not found' });
  try {
    const out = await bookParcel(one('SELECT * FROM workspaces WHERE id = ?', wsId(req)), o, s(req.body?.courier, 20));
    await notifyOrderStatus(o.id).catch(() => {});
    emit(wsId(req), 'order', { order: o.id });
    res.json(out);
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});
r.post('/orders/:id/courier/status', async (req, res) => {
  const o = one('SELECT * FROM orders WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!o) return res.status(404).json({ error: 'Not found' });
  try { res.json(await refreshStatus(one('SELECT * FROM workspaces WHERE id = ?', wsId(req)), o)); } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});
r.get('/fraud-check', async (req, res) => {
  try { res.json(await fraudCheck(one('SELECT * FROM workspaces WHERE id = ?', wsId(req)), s(req.query.phone, 30))); } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

// ----- Web Push (phone / desktop notifications for this person)
r.get('/push', (req, res) => res.json({ key: webpush.pushPublicKey(), devices: webpush.pushCount(req.user.id) }));
r.post('/push', (req, res) => {
  try { webpush.subscribe(req.user.id, wsId(req), req.body?.subscription, req.get('user-agent')); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  res.json({ ok: true, devices: webpush.pushCount(req.user.id) });
});
r.delete('/push', (req, res) => { webpush.unsubscribe(req.user.id, req.body?.endpoint); res.json({ ok: true }); });
r.post('/push/test', async (req, res) => res.json({ delivered: await webpush.pushToWorkspace(wsId(req), { title: 'ChatPilot AI', body: 'Notifications are on ✅', url: '#dashboard', tag: 'test' }, { userId: req.user.id }) }));

// ----- broadcasts (24-hour window / WhatsApp templates)
r.get('/broadcasts', manage, (req, res) => res.json(listBroadcasts(wsId(req))));
r.post('/broadcasts/preview', manage, (req, res) => { try { res.json(broadcastPreview(wsId(req), req.body || {})); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } });
r.post('/broadcasts', manage, (req, res) => {
  if (effectivePlan(one('SELECT * FROM workspaces WHERE id = ?', wsId(req))).key === 'expired') return res.status(402).json({ error: 'Subscription inactive — renew to send broadcasts.' });
  try {
    const b = createBroadcast(wsId(req), req.user.id, req.body || {});
    audit(req, 'broadcast.create', b.id, { total: b.total });
    res.json({ id: b.id, total: b.total });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
r.post('/broadcasts/:id/cancel', manage, (req, res) => { run(`UPDATE broadcasts SET status = 'cancelled' WHERE id = ? AND workspace_id = ? AND status = 'sending'`, int(req.params.id), wsId(req)); res.json({ ok: true }); });
r.get('/channels/:id/templates', manage, async (req, res) => {
  const ch = one('SELECT * FROM channels WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!ch) return res.status(404).json({ error: 'Not found' });
  try { res.json(await listTemplates(ch)); } catch (e) { res.status(502).json({ error: e.message }); }
});

// ----- Meta Conversions API
r.get('/capi', manage, (req, res) => res.json(capiSettings(one('SELECT * FROM workspaces WHERE id = ?', wsId(req)))));
r.put('/capi', manage, (req, res) => {
  try { res.json(saveCapi(one('SELECT * FROM workspaces WHERE id = ?', wsId(req)), req.body || {})); audit(req, 'capi.update', wsId(req)); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// ----- WhatsApp: order-update templates (after 24 h) and creating templates without leaving ChatPilot
r.get('/order-templates', manage, (req, res) => res.json(orderTemplates(one('SELECT * FROM workspaces WHERE id = ?', wsId(req)))));
r.put('/order-templates', manage, (req, res) => {
  let t; try { t = validateOrderTemplates(req.body || {}); } catch (e) { return bad(res, e.message); }
  run('UPDATE workspaces SET order_templates = ? WHERE id = ?', JSON.stringify(t), wsId(req));
  res.json(t);
});
r.post('/channels/:id/templates', manage, async (req, res) => {
  const ch = one('SELECT * FROM channels WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!ch) return res.status(404).json({ error: 'Not found' });
  if (ch.platform !== 'whatsapp' || !ch.waba_id) return bad(res, 'Templates need a WhatsApp number connected with Facebook');
  const b = req.body || {};
  const name = s(b.name, 512).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const body = s(b.body, 1024);
  if (!name || !body) return bad(res, 'Name and text are required');
  if (!['UTILITY', 'MARKETING'].includes(b.category)) return bad(res, 'Choose Utility (order updates) or Marketing (offers)');
  const params = body.match(/\{\{\d+\}\}/g) || [];
  const examples = (Array.isArray(b.examples) ? b.examples : String(b.examples || '').split(',')).map((x) => s(x, 100)).filter(Boolean);
  if (params.length && examples.length < params.length) return bad(res, `Give an example for each of the ${params.length} {{n}} values`);
  try {
    const out = await graph(`${encodeURIComponent(ch.waba_id)}/message_templates`, { method: 'POST', token: open(ch.workspace_id, 'channels.access_token', ch.access_token_enc),
      body: { name, category: b.category, language: s(b.language, 15) || 'en', components: [{ type: 'BODY', text: body, ...(params.length ? { example: { body_text: [examples.slice(0, params.length)] } } : {}) }] } });
    audit(req, 'whatsapp.template.create', name);
    res.json({ id: out.id, status: out.status || 'PENDING', name });
  } catch (e) { res.status(502).json({ error: `Meta did not accept the template: ${e.message}` }); }
});

// ----- coupon codes
const couponIn = (b) => {
  const code = s(b.code, 40).toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new Error('Code: 3-40 letters or numbers');
  if (!['percent', 'fixed', 'free_delivery'].includes(b.kind)) throw new Error('Choose percent, fixed amount or free delivery');
  const value = Number(b.value) || 0;
  if (b.kind === 'percent' && !(value > 0 && value <= 100)) throw new Error('Percent must be 1-100');
  if (b.kind === 'fixed' && !(value > 0)) throw new Error('Enter the discount amount');
  if (b.expires_at && !/^\d{4}-\d{2}-\d{2}$/.test(b.expires_at)) throw new Error('Expiry date: YYYY-MM-DD');
  return { code, kind: b.kind, value, min_order: Math.max(0, Number(b.min_order) || 0), max_uses: b.max_uses ? Math.max(1, int(b.max_uses)) : null, expires_at: b.expires_at || null, active: b.active === false ? 0 : 1 };
};
r.get('/coupons', (req, res) => res.json(all('SELECT * FROM coupons WHERE workspace_id = ? ORDER BY id DESC', wsId(req))));
r.post('/coupons', manage, (req, res) => {
  let c; try { c = couponIn(req.body || {}); } catch (e) { return bad(res, e.message); }
  if (one('SELECT 1 FROM coupons WHERE workspace_id = ? AND code = ?', wsId(req), c.code)) return bad(res, 'That code already exists');
  const id = Number(run('INSERT INTO coupons (workspace_id, code, kind, value, min_order, max_uses, expires_at, active) VALUES (?,?,?,?,?,?,?,?)',
    wsId(req), c.code, c.kind, c.value, c.min_order, c.max_uses, c.expires_at, c.active).lastInsertRowid);
  res.json(one('SELECT * FROM coupons WHERE id = ?', id));
});
r.put('/coupons/:id', manage, (req, res) => {
  const row = one('SELECT * FROM coupons WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!row) return res.status(404).json({ error: 'Not found' });
  run('UPDATE coupons SET active = ? WHERE id = ?', req.body?.active ? 1 : 0, row.id);
  res.json(one('SELECT * FROM coupons WHERE id = ?', row.id));
});
r.delete('/coupons/:id', manage, (req, res) => { run('DELETE FROM coupons WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req)); res.json({ ok: true }); });

// ----- rules that run without the AI
r.put('/channels/:id/rules', manage, (req, res) => {
  const ch = one('SELECT id FROM channels WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!ch) return res.status(404).json({ error: 'Not found' });
  try { run('UPDATE channels SET comment_rules = ? WHERE id = ?', JSON.stringify(validateRules(req.body || {})), ch.id); } catch (e) { return bad(res, e.message); }
  res.json(channelOut(one('SELECT * FROM channels WHERE id = ?', ch.id)));
});
r.put('/channels/:id/profile', manage, async (req, res) => {
  const ch = one('SELECT * FROM channels WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!ch) return res.status(404).json({ error: 'Not found' });
  let p;
  try { p = validateProfile(req.body || {}); } catch (e) { return bad(res, e.message); }
  try { await applyProfile(ch, open(ch.workspace_id, 'channels.access_token', ch.access_token_enc), p); } catch (e) { return res.status(502).json({ error: `Meta did not accept it: ${e.message}` }); }
  saveProfile(ch.id, p);
  audit(req, 'channel.profile', ch.id);
  res.json(channelOut(one('SELECT * FROM channels WHERE id = ?', ch.id)));
});
r.get('/hours', (req, res) => { const w = one('SELECT * FROM workspaces WHERE id = ?', wsId(req)); res.json({ ...businessHours(w), open_now: isOpen(w) }); });
r.put('/hours', manage, (req, res) => {
  let h;
  try { h = validateHours(req.body || {}); } catch (e) { return bad(res, e.message); }
  run('UPDATE workspaces SET hours_json = ? WHERE id = ?', JSON.stringify(h), wsId(req));
  const w = one('SELECT * FROM workspaces WHERE id = ?', wsId(req));
  res.json({ ...businessHours(w), open_now: isOpen(w) });
});

r.get('/payments', (req, res) => res.json({ ...paymentSettings(one('SELECT * FROM workspaces WHERE id = ?', wsId(req))), available: METHODS }));
r.put('/payments', manage, (req, res) => {
  let p;
  try { p = validatePayment(req.body || {}); } catch (e) { return bad(res, e.message); }
  run('UPDATE workspaces SET payment_json = ? WHERE id = ?', JSON.stringify(p), wsId(req));
  res.json({ ...p, available: METHODS });
});
r.post('/orders/:id/payment', (req, res) => {
  const o = one('SELECT * FROM orders WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!o) return res.status(404).json({ error: 'Not found' });
  try { verifyClaim(o, Boolean(req.body?.ok), req.body?.amount); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  audit(req, req.body?.ok ? 'payment.verify' : 'payment.reject', o.id);
  emit(wsId(req), 'order', { order: o.id });
  res.json(orderOut(one('SELECT * FROM orders WHERE id = ?', o.id)));
});

r.get('/delivery', (req, res) => res.json(deliverySettings(req.workspace)));
r.put('/delivery', manage, (req, res) => {
  let d; try { d = validateDelivery(req.body); } catch (e) { return bad(res, e.message); }
  run('UPDATE workspaces SET delivery_json = ? WHERE id = ?', JSON.stringify(d), wsId(req));
  res.json(d);
});

// ----- test lab: chat with the assistant without sending anything
r.post('/simulate', async (req, res) => {
  if (!aiEnabled()) return bad(res, 'AI is not configured yet (Admin → Settings → Anthropic API key).');
  const blocked = aiBlocked(one('SELECT * FROM workspaces WHERE id = ?', wsId(req)));
  if (blocked) return res.status(402).json({ error: `${blocked} — upgrade or wait for next month to use the test chat.` });
  const platform = PLATFORMS[req.body?.platform] ? req.body.platform : 'messenger';
  const turns = (Array.isArray(req.body?.messages) ? req.body.messages : []).slice(-20)
    .map((m) => ({ direction: m.from === 'customer' ? 'in' : 'out', source: 'ai', body: s(m.text, 2000) })).filter((m) => m.body);
  if (!turns.length || turns[turns.length - 1].direction !== 'in') return bad(res, 'End with a customer message');
  const fakeConv = { id: 0, stage: 'browsing', customer_name: null, customer_phone: null, customer_address: null };
  try {
    const d = await decide(req.workspace, { platform, greeting: s(req.body.greeting, 500) }, fakeConv, turns);
    const priced = priceOrder(wsId(req), d.order?.items, { address: d.order?.address, zone: d.order?.delivery_zone, coupon: d.order?.coupon });
    let reply = d.reply;
    if (d.order_status === 'awaiting_confirmation' && priced.lines.length && !priced.problems.length) reply = `${reply}\n\n${orderSummary(priced, d.order)}`;
    res.json({ reply, decision: d, order: priced });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

export default r;
