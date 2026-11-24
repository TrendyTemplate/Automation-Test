// AI sales assistant: Meta webhook (public, signature-verified) and the dashboard API (authenticated, tenant-scoped).
import express, { Router } from 'express';
import { one, all, run, logActivity, audit } from '../db.js';
import { requireRole } from '../auth.js';
import { randomToken } from '../crypto.js';
import { seal, open } from '../vault.js';
import { appUrl } from '../settings.js';
import { PLATFORMS, parseWebhook, verifySignature, insideWindow, testChannel } from '../services/social.js';
import { handleEvents, deliver, storeOutbound, decide, priceOrder, orderSummary, decryptChat, STAGES } from '../services/sales.js';
import { aiEnabled } from '../services/ai.js';
import { effectivePlan } from '../plans.js';

// ---------------------------------------------------------------- webhook
export const webhookRouter = Router();

// Meta calls GET once to verify the callback URL: echo hub.challenge if the verify token belongs to a channel.
webhookRouter.get('/', (req, res) => {
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  const ok = req.query['hub.mode'] === 'subscribe' && token.length >= 20 && /^[\w.-]{1,200}$/.test(challenge)
    && one('SELECT id FROM channels WHERE verify_token = ?', token);
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
    const ch = one('SELECT * FROM channels WHERE platform = ? AND external_id = ? AND enabled = 1', platform, externalId);
    if (!ch) continue;
    if (verifySignature(raw, req.headers['x-hub-signature-256'], open(ch.workspace_id, 'channels.app_secret', ch.app_secret_enc))) verified.set(key, ch);
    else rejected++;
  }
  // Wrong signature = forged request. Unknown accounts are acknowledged so Meta doesn't retry forever.
  if (rejected && !verified.size) return res.status(403).send('Invalid signature');
  res.sendStatus(200); // answer fast; Meta expects a 200 within a few seconds
  try { handleEvents(events, verified); } catch (e) { console.error('[sales-webhook]', e.message); }
});

// ---------------------------------------------------------------- dashboard API
const r = Router();
const manage = requireRole('owner', 'admin');
const wsId = (req) => req.workspace.id;
const int = (v) => Number.parseInt(v, 10);
const s = (v, max = 1000) => String(v ?? '').trim().slice(0, max);
const bad = (res, msg) => res.status(400).json({ error: msg });

const channelOut = (c) => ({
  id: c.id, platform: c.platform, platform_label: PLATFORMS[c.platform].label, name: c.name, external_id: c.external_id, send_id: c.send_id,
  mode: c.mode, enabled: Boolean(c.enabled), followup_hours: c.followup_hours, greeting: c.greeting,
  last_event_at: c.last_event_at, last_error: c.last_error, created_at: c.created_at,
  verify_token: c.verify_token, webhook_url: `${appUrl()}/api/social/webhook`,
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
  logActivity(wsId(req), 'channel_added', { platform: v.platform, name });
  res.json(channelOut(one('SELECT * FROM channels WHERE id = ?', id)));
});

r.put('/channels/:id', manage, (req, res) => {
  const ch = one('SELECT * FROM channels WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!ch) return res.status(404).json({ error: 'Not found' });
  let v;
  try { v = channelInput(req.body || {}, ch); } catch (e) { return bad(res, e.message); }
  const sets = []; const vals = [];
  for (const k of ['name', 'send_id', 'mode', 'enabled', 'followup_hours', 'greeting']) if (k in v) { sets.push(`${k} = ?`); vals.push(v[k]); }
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
  return p;
}
r.get('/products', (req, res) => res.json(all('SELECT * FROM products WHERE workspace_id = ? ORDER BY active DESC, name', wsId(req))));
const productRoom = (req) => effectivePlan(req.workspace).products - one('SELECT COUNT(*) AS n FROM products WHERE workspace_id = ?', wsId(req)).n;
r.post('/products', manage, (req, res) => {
  if (productRoom(req) <= 0) return res.status(402).json({ error: `Your plan's product limit is reached (${effectivePlan(req.workspace).products}). Upgrade or remove old products.` });
  let p; try { p = productInput(req.body || {}); } catch (e) { return bad(res, e.message); }
  const id = run(`INSERT INTO products (workspace_id, name, sku, description, variants, price, currency, stock, image_url, active) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    wsId(req), p.name, p.sku, p.description, p.variants, p.price, p.currency, p.stock, p.image_url, p.active).lastInsertRowid;
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
  run('UPDATE products SET name=?, sku=?, description=?, variants=?, price=?, currency=?, stock=?, image_url=?, active=? WHERE id=?',
    p.name, p.sku, p.description, p.variants, p.price, p.currency, p.stock, p.image_url, p.active, ex.id);
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
  if (['open', 'needs_human', 'closed'].includes(req.query.status)) { where.push('v.status = ?'); p.push(req.query.status); }
  if (req.query.view === 'drafts') where.push(`EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = v.id AND m.status = 'draft')`);
  if (STAGES.includes(req.query.stage)) { where.push('v.stage = ?'); p.push(req.query.stage); }
  if (req.query.q) { where.push('(v.customer_name LIKE ? OR v.customer_phone LIKE ? OR v.intent LIKE ?)'); const q = `%${s(req.query.q, 100)}%`; p.push(q, q, q); }
  const rows = all(`SELECT v.*, c.platform, c.name AS channel_name,
      (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = v.id AND m.status = 'draft') AS drafts,
      (SELECT body FROM chat_messages m WHERE m.conversation_id = v.id ORDER BY id DESC LIMIT 1) AS last_body
    FROM conversations v JOIN channels c ON c.id = v.channel_id WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(v.last_inbound_at, v.created_at) DESC LIMIT ?`, ...p, Math.min(200, int(req.query.limit) || 100));
  res.json(rows.map((v) => ({ ...v, last_body: String(open(v.workspace_id, 'chat_messages.body', v.last_body) || '').slice(0, 140),
    can_reply: insideWindow(v.last_inbound_at) })));
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
  res.json({ ...v, can_reply: insideWindow(v.last_inbound_at), messages, orders,
    ai_paused: Boolean(v.ai_paused_until && new Date(`${v.ai_paused_until.replace(' ', 'T')}Z`) > new Date()) });
});

r.post('/conversations/:id/reply', async (req, res) => {
  const v = getConv(req);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const body = s(req.body?.body, 4000);
  if (!body) return bad(res, 'Write a message first');
  if (!insideWindow(v.last_inbound_at)) return res.status(409).json({ error: `${PLATFORMS[v.platform].label} only allows replies within 24 hours of the customer's last message.` });
  // A person answering pauses the AI for this chat (default 12h) so it doesn't talk over them.
  run(`UPDATE chat_messages SET status = 'rejected' WHERE conversation_id = ? AND status = 'draft'`, v.id);
  const id = storeOutbound(v, body, { source: 'human', status: 'draft', userId: req.user.id });
  if (req.body.pause_ai !== false) run(`UPDATE conversations SET ai_paused_until = datetime('now', '+12 hours') WHERE id = ?`, v.id);
  try { await deliver(id, req.user.id); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  res.json({ ok: true, id });
});

r.post('/messages/:id/approve', async (req, res) => {
  const m = one(`SELECT * FROM chat_messages WHERE id = ? AND workspace_id = ? AND status IN ('draft', 'failed')`, int(req.params.id), wsId(req));
  if (!m) return res.status(404).json({ error: 'Draft not found' });
  if (req.body?.body != null) {
    const body = s(req.body.body, 4000);
    if (!body) return bad(res, 'Message is empty');
    run('UPDATE chat_messages SET body = ? WHERE id = ?', seal(m.workspace_id, 'chat_messages.body', body), m.id);
  }
  try { await deliver(m.id, req.user.id); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  logActivity(wsId(req), 'chat_approved_sent', { conversation: m.conversation_id, by: req.user.name || req.user.email });
  res.json({ ok: true });
});
r.post('/messages/:id/reject', (req, res) => {
  run(`UPDATE chat_messages SET status = 'rejected' WHERE id = ? AND workspace_id = ? AND status IN ('draft', 'failed')`, int(req.params.id), wsId(req));
  res.json({ ok: true });
});

r.put('/conversations/:id', (req, res) => {
  const v = getConv(req);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.status && ['open', 'needs_human', 'closed'].includes(b.status)) run('UPDATE conversations SET status = ?, handoff_reason = CASE WHEN ? = \'needs_human\' THEN handoff_reason ELSE NULL END WHERE id = ?', b.status, b.status, v.id);
  if (b.stage && STAGES.includes(b.stage)) run('UPDATE conversations SET stage = ? WHERE id = ?', b.stage, v.id);
  if (b.ai_paused === true) run(`UPDATE conversations SET ai_paused_until = datetime('now', '+30 days') WHERE id = ?`, v.id);
  if (b.ai_paused === false) run('UPDATE conversations SET ai_paused_until = NULL WHERE id = ?', v.id);
  for (const k of ['customer_name', 'customer_phone', 'customer_address']) if (b[k] !== undefined) run(`UPDATE conversations SET ${k} = ? WHERE id = ?`, s(b[k], 500) || null, v.id);
  res.json({ ok: true });
});

// ----- orders
r.get('/orders', (req, res) => {
  const where = ['o.workspace_id = ?']; const p = [wsId(req)];
  if (['new', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(req.query.status)) { where.push('o.status = ?'); p.push(req.query.status); }
  res.json(all(`SELECT o.*, c.platform FROM orders o LEFT JOIN conversations v ON v.id = o.conversation_id LEFT JOIN channels c ON c.id = v.channel_id
    WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 300`, ...p).map((o) => ({ ...o, items: JSON.parse(o.items_json) })));
});
r.put('/orders/:id', (req, res) => {
  const o = one('SELECT * FROM orders WHERE id = ? AND workspace_id = ?', int(req.params.id), wsId(req));
  if (!o) return res.status(404).json({ error: 'Not found' });
  const st = req.body?.status;
  if (!['new', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(st)) return bad(res, 'Invalid status');
  run(`UPDATE orders SET status = ?, note = COALESCE(?, note), updated_at = datetime('now') WHERE id = ?`, st, req.body.note != null ? s(req.body.note, 500) : null, o.id);
  if (st === 'cancelled' && o.status !== 'cancelled') for (const l of JSON.parse(o.items_json)) run('UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL', l.qty, l.product_id);
  res.json({ ok: true });
});
r.get('/orders.csv', (req, res) => {
  const rows = all('SELECT * FROM orders WHERE workspace_id = ? ORDER BY id DESC', wsId(req));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
  res.type('text/csv').attachment('orders.csv').send(['id,date,status,customer,phone,address,items,total,currency',
    ...rows.map((o) => [o.id, o.created_at, o.status, o.customer_name, o.customer_phone, o.customer_address,
      JSON.parse(o.items_json).map((l) => `${l.qty}x ${l.name}${l.variant ? ` (${l.variant})` : ''}`).join('; '), o.total, o.currency].map(q).join(','))].join('\n'));
});

// ----- test lab: chat with the assistant without sending anything
r.post('/simulate', async (req, res) => {
  if (!aiEnabled()) return bad(res, 'AI is not configured yet (Admin → Settings → Anthropic API key).');
  const platform = PLATFORMS[req.body?.platform] ? req.body.platform : 'messenger';
  const turns = (Array.isArray(req.body?.messages) ? req.body.messages : []).slice(-20)
    .map((m) => ({ direction: m.from === 'customer' ? 'in' : 'out', source: 'ai', body: s(m.text, 2000) })).filter((m) => m.body);
  if (!turns.length || turns[turns.length - 1].direction !== 'in') return bad(res, 'End with a customer message');
  const fakeConv = { id: 0, stage: 'browsing', customer_name: null, customer_phone: null, customer_address: null };
  try {
    const d = await decide(req.workspace, { platform, greeting: s(req.body.greeting, 500) }, fakeConv, turns);
    const priced = priceOrder(wsId(req), d.order?.items);
    let reply = d.reply;
    if (d.order_status === 'awaiting_confirmation' && priced.lines.length && !priced.problems.length) reply = `${reply}\n\n${orderSummary(priced, d.order)}`;
    res.json({ reply, decision: d, order: priced });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

export default r;
