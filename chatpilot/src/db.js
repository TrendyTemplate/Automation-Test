import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  google_id TEXT, microsoft_id TEXT, facebook_id TEXT, avatar_url TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0, suspended INTEGER NOT NULL DEFAULT 0,
  totp_secret_enc TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT, last_login_ip TEXT, referral_code TEXT, referred_by INTEGER,
  current_workspace_id INTEGER, locale TEXT NOT NULL DEFAULT 'en',
  failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT, password_changed_at TEXT,
  ui_theme TEXT NOT NULL DEFAULT 'system', ui_language TEXT NOT NULL DEFAULT 'en',
  notifications_seen_at TEXT, notify_digest INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL DEFAULT 'trial',
  subscription_status TEXT, billing_interval TEXT, stripe_customer_id TEXT, stripe_subscription_id TEXT,
  current_period_end TEXT, trial_ends_at TEXT,
  -- assistant persona
  business_name TEXT, business_description TEXT,
  reply_tone TEXT NOT NULL DEFAULT 'friendly and helpful',
  default_language TEXT NOT NULL DEFAULT 'auto',
  auto_send_min_confidence REAL NOT NULL DEFAULT 0.8,
  sensitive_topics TEXT NOT NULL DEFAULT 'refund, return, damaged, broken, fake, cheat, police, lawyer, court, consumer rights',
  never_say TEXT, allowed_link_domains TEXT,
  privacy_shield INTEGER NOT NULL DEFAULT 1, retention_days INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  telegram_chat_id TEXT, slack_webhook TEXT,
  -- platform
  suspended INTEGER NOT NULL DEFAULT 0, limits_override_json TEXT, admin_notes TEXT,
  dek_enc TEXT, support_access_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',   -- owner | admin | member
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL, content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usage (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period TEXT NOT NULL,           -- YYYY-MM
  ai_calls INTEGER NOT NULL DEFAULT 0,
  ai_replies INTEGER NOT NULL DEFAULT 0,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, period)
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL, detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_ws ON activity(workspace_id, id DESC);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS plans (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  channels INTEGER NOT NULL, ai_replies INTEGER NOT NULL, products INTEGER NOT NULL, team_members INTEGER NOT NULL,
  ai_calls INTEGER, auto_send INTEGER NOT NULL DEFAULT 1, features_json TEXT,
  price_monthly REAL, price_yearly REAL, price_once REAL,
  stripe_price_monthly TEXT, stripe_price_yearly TEXT, stripe_price_once TEXT,
  public INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, highlight INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
  last_used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tokens (          -- password reset / email verification / 2FA pending login
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL, expires_at TEXT NOT NULL, data TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER, actor_email TEXT,
  action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id INTEGER, is_staff INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info',
  active INTEGER NOT NULL DEFAULT 1, starts_at TEXT, ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
  amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'usd', method TEXT NOT NULL,   -- stripe | bkash | bank | paypal | other
  plan TEXT, interval TEXT, reference TEXT, status TEXT NOT NULL DEFAULT 'paid', note TEXT,
  referral_user_id INTEGER, commission REAL NOT NULL DEFAULT 0, commission_paid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_ref ON payments(reference);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                -- random; only its hash is stored
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT, user_agent TEXT, impersonator_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, workspace_id INTEGER, type TEXT NOT NULL, detail TEXT, ip TEXT, user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_secev_user ON security_events(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_secev_ws ON security_events(workspace_id, id DESC);

CREATE TABLE IF NOT EXISTS ai_log (            -- transparency: every time customer text is shown to the AI
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id INTEGER, purpose TEXT NOT NULL, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
  redactions INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ailog_ws ON ai_log(workspace_id, id DESC);

CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', token_hash TEXT NOT NULL UNIQUE,
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL, accepted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lifecycle_sent (     -- de-duplicates automatic customer emails
  workspace_id INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (workspace_id, kind, ref)
);

-- ---------------------------------------------------------------- the sales assistant
CREATE TABLE IF NOT EXISTS channels (            -- a connected Facebook Page, Instagram account or WhatsApp number
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,                        -- messenger | instagram | whatsapp
  name TEXT,
  external_id TEXT NOT NULL,                     -- Page ID / Instagram account ID / WhatsApp phone_number_id (webhook routing)
  send_id TEXT,                                  -- ID used in the send URL when different (Instagram via Page: the Page ID)
  access_token_enc TEXT NOT NULL,                -- Page / system-user token, encrypted per workspace
  app_secret_enc TEXT NOT NULL,                  -- Meta app secret, used to verify webhook signatures
  verify_token TEXT NOT NULL,                    -- random; pasted into the Meta webhook settings
  mode TEXT NOT NULL DEFAULT 'draft',            -- off | draft (human approves) | auto
  enabled INTEGER NOT NULL DEFAULT 1,
  followup_hours INTEGER NOT NULL DEFAULT 0,     -- nudge quiet buyers once inside the 24h window (0 = off)
  greeting TEXT,
  managed INTEGER NOT NULL DEFAULT 0,            -- 1 = connected with "Connect with Facebook" (uses the platform's Meta app secret)
  connected_by TEXT,                             -- Facebook user id that granted access (for Meta data-deletion / deauthorize callbacks)
  waba_id TEXT,                                  -- WhatsApp Business Account id (WhatsApp channels)
  comment_mode TEXT NOT NULL DEFAULT 'auto',     -- off | draft | auto: answer public comments on posts (Page / Instagram)
  history_status TEXT,                           -- learning from past chats & comments: pending | running | done | failed | unavailable
  history_stats TEXT,                            -- JSON {conversations, comments, examples}
  last_event_at TEXT, last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (platform, external_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_verify ON channels(verify_token);
CREATE INDEX IF NOT EXISTS idx_channels_fbuser ON channels(connected_by);

CREATE TABLE IF NOT EXISTS meta_pending (        -- accounts found after "Connect with Facebook", waiting for the user to pick (15 min)
  id TEXT PRIMARY KEY,                           -- random
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                            -- pages | whatsapp
  fb_user_id TEXT, data_enc TEXT NOT NULL,       -- JSON with tokens, encrypted per workspace
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta_deletions (      -- Meta "data deletion request" callbacks and their status page
  code TEXT PRIMARY KEY, fb_user_id TEXT NOT NULL, channels_deleted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sku TEXT, name TEXT NOT NULL, description TEXT,
  price REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'BDT',
  stock INTEGER,                                 -- NULL = not tracked
  variants TEXT,                                 -- free text, e.g. "Sizes: S, M, L; Colors: black, white"
  image_url TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_ws ON products(workspace_id, active);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,                     -- PSID / IGSID / WhatsApp number; "c:<comment id>" for a comment thread
  kind TEXT NOT NULL DEFAULT 'message',          -- message | comment
  post_id TEXT, comment_id TEXT,                 -- comment threads: the post and the top-level comment
  customer_name TEXT, customer_phone TEXT, customer_address TEXT,
  stage TEXT NOT NULL DEFAULT 'new',             -- new | browsing | interested | negotiating | ordering | ordered | support | lost
  lead_score INTEGER, intent TEXT, language TEXT, summary TEXT,
  status TEXT NOT NULL DEFAULT 'open',           -- open | needs_human | closed
  handoff_reason TEXT,
  ai_paused_until TEXT,                          -- a human took over; AI stays quiet until then
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_inbound_at TEXT, last_outbound_at TEXT, followup_sent_at TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (channel_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_conv_ws ON conversations(workspace_id, last_inbound_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,                       -- in | out
  source TEXT NOT NULL DEFAULT 'customer',       -- customer | ai | human | human_app (replied in Meta's own inbox)
  external_id TEXT,                              -- platform message id (dedup)
  body TEXT,                                     -- encrypted per workspace
  status TEXT NOT NULL DEFAULT 'received',       -- received | draft | sent | failed | rejected
  guard_json TEXT, error TEXT, confidence REAL,
  delivery TEXT,                                 -- comment threads: public (reply under the comment) | private (to the commenter's inbox)
  ai_original TEXT,                              -- the AI draft before a person edited it (encrypted), for learning
  sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_conv ON chat_messages(conversation_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_ext ON chat_messages(conversation_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  items_json TEXT NOT NULL,                      -- [{product_id, name, sku, qty, price, variant}] — prices from the catalog, never from the AI
  total REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'BDT',
  customer_name TEXT, customer_phone TEXT, customer_address TEXT, note TEXT,
  status TEXT NOT NULL DEFAULT 'new',            -- new | confirmed | shipped | delivered | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_ws ON orders(workspace_id, id DESC);

-- ---------------------------------------------------------------- the learning engine
CREATE TABLE IF NOT EXISTS learn_examples (      -- "customer said X → the shop answered Y", collected automatically
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'message',          -- message | comment
  source TEXT NOT NULL,                          -- history | human | human_app | ai_approved | ai_edited | ai_rejected
  question_enc TEXT NOT NULL, answer_enc TEXT NOT NULL,  -- encrypted per workspace; phone numbers/addresses masked
  weight REAL NOT NULL DEFAULT 1,                -- edited > human > approved; rejected drafts are negative
  outcome TEXT,                                  -- ordered (the chat ended in an order)
  dedupe TEXT NOT NULL,                          -- hash, so imports and retries never double count
  happened_at TEXT NOT NULL DEFAULT (datetime('now')), created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (workspace_id, dedupe)
);
CREATE INDEX IF NOT EXISTS idx_learn_ws ON learn_examples(workspace_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_learn_conv ON learn_examples(conversation_id);

CREATE TABLE IF NOT EXISTS learned_profiles (    -- what the AI distilled from the examples, per channel (versioned)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  profile_enc TEXT NOT NULL,                     -- JSON {summary, style, facts[], faq[], avoid[], comment_style}
  examples_used INTEGER NOT NULL DEFAULT 0, last_example_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profiles ON learned_profiles(workspace_id, channel_id, id DESC);
CREATE TABLE IF NOT EXISTS learned_forget (      -- facts the owner removed: never learned again
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// node:sqlite rejects undefined/boolean bindings; normalise them.
const norm = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p));
export const one = (sql, ...params) => db.prepare(sql).get(...norm(params));
export const all = (sql, ...params) => db.prepare(sql).all(...norm(params));
export const run = (sql, ...params) => db.prepare(sql).run(...norm(params));

let txDepth = 0;
/** Run fn in a transaction. Nested calls join the outer transaction (savepoints keep inner failures contained). */
export function tx(fn) {
  const sp = `sp${txDepth}`;
  db.exec(txDepth ? `SAVEPOINT ${sp}` : 'BEGIN');
  txDepth++;
  try {
    const r = fn();
    txDepth--;
    db.exec(txDepth ? `RELEASE ${sp}` : 'COMMIT');
    return r;
  } catch (e) {
    txDepth--;
    db.exec(txDepth ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
    throw e;
  }
}

export const period = () => new Date().toISOString().slice(0, 7);

const USAGE_FIELDS = ['ai_calls', 'ai_replies', 'messages_sent', 'input_tokens', 'output_tokens'];
export function bumpUsage(workspaceId, fields) {
  const p = period();
  run('INSERT OR IGNORE INTO usage (workspace_id, period) VALUES (?, ?)', workspaceId, p);
  for (const [k, v] of Object.entries(fields)) {
    if (!USAGE_FIELDS.includes(k)) continue;
    run(`UPDATE usage SET ${k} = ${k} + ? WHERE workspace_id = ? AND period = ?`, v, workspaceId, p);
  }
}

export function getUsage(workspaceId) {
  return one('SELECT * FROM usage WHERE workspace_id = ? AND period = ?', workspaceId, period())
    || { ai_calls: 0, ai_replies: 0, messages_sent: 0, input_tokens: 0, output_tokens: 0 };
}

export function logActivity(workspaceId, type, detail) {
  run('INSERT INTO activity (workspace_id, type, detail) VALUES (?, ?, ?)', workspaceId, type,
    typeof detail === 'string' ? detail : JSON.stringify(detail));
}

// Seed default plans once (admins edit them from the admin panel afterwards).
if (one('SELECT COUNT(*) AS n FROM plans').n === 0) {
  const seed = [
    // key, name, description, channels, ai_replies, products, team, ai_calls, monthly, yearly, once, public, sort, highlight
    ['trial', 'Free Trial', 'Try everything free', 3, 300, 50, 2, 900, 0, 0, null, 0, 0, 0],
    ['starter', 'Starter', 'For a single Facebook / Instagram shop', 2, 2000, 200, 2, 6000, 12, 120, null, 1, 1, 0],
    ['pro', 'Pro', 'Messenger + Instagram + WhatsApp', 6, 10000, 2000, 5, 30000, 29, 290, null, 1, 2, 1],
    ['business', 'Business', 'For brands & agencies with many pages', 30, 50000, 20000, 25, 150000, 79, 790, null, 1, 3, 0],
    ['lifetime', 'Lifetime', 'Pay once, use forever', 3, 3000, 500, 2, 9000, null, null, 249, 1, 4, 0],
  ];
  for (const p of seed) {
    run(`INSERT INTO plans (key, name, description, channels, ai_replies, products, team_members, ai_calls,
      price_monthly, price_yearly, price_once, public, sort, highlight) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...p);
  }
}

export function audit(req, action, target, detail) {
  run('INSERT INTO audit_log (actor_id, actor_email, action, target, detail, ip) VALUES (?,?,?,?,?,?)',
    req?.user?.id ?? null, req?.user?.email ?? 'system', action, target == null ? null : String(target),
    detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)), req?.ip ?? null);
}

export function securityEvent(req, type, detail, { userId, workspaceId } = {}) {
  run('INSERT INTO security_events (user_id, workspace_id, type, detail, ip, user_agent) VALUES (?,?,?,?,?,?)',
    userId ?? req?.user?.id ?? null, workspaceId ?? req?.workspace?.id ?? null, type,
    detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)),
    req?.ip ?? null, String(req?.headers?.['user-agent'] || '').slice(0, 200) || null);
}

// ---------------------------------------------------------------------------
// Migrations: columns added after the first release. Idempotent — safe on every boot and on old databases.
// ---------------------------------------------------------------------------
export function addColumn(table, col, def) {
  if (!all(`PRAGMA table_info(${table})`).some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
// Orders: delivery charges by zone, payments, couriers, manual orders.
for (const [c, d] of [['subtotal', 'REAL'], ['delivery_zone', 'TEXT'], ['delivery_charge', 'REAL NOT NULL DEFAULT 0'], ['discount', 'REAL NOT NULL DEFAULT 0'],
  ['payment_status', "TEXT NOT NULL DEFAULT 'unpaid'"], ['paid_amount', 'REAL NOT NULL DEFAULT 0'], ['payment_method', 'TEXT'], ['source', "TEXT NOT NULL DEFAULT 'chat'"],
  ['courier', 'TEXT'], ['consignment_id', 'TEXT'], ['tracking_code', 'TEXT'], ['courier_status', 'TEXT'], ['courier_updated_at', 'TEXT'], ['customer_id', 'INTEGER']]) addColumn('orders', c, d);
// Workspaces: delivery zones (JSON) and order-status messages to customers.
for (const [c, d] of [['delivery_json', 'TEXT'], ['notify_customers', 'INTEGER NOT NULL DEFAULT 1'], ['courier_json', 'TEXT']]) addColumn('workspaces', c, d);
// Team inbox: saved replies, internal notes, labels, assignment.
db.exec(`
CREATE TABLE IF NOT EXISTS saved_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  shortcut TEXT NOT NULL, body TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (workspace_id, shortcut)
);
CREATE TABLE IF NOT EXISTS conversation_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
addColumn('conversations', 'labels', 'TEXT');
addColumn('conversations', 'referral_json', 'TEXT');          // Click-to-Messenger / WhatsApp ad that started the chat
addColumn('workspaces', 'auto_assign', 'INTEGER NOT NULL DEFAULT 0');
addColumn('workspaces', 'assign_cursor', 'INTEGER NOT NULL DEFAULT 0');
// Rich messages: customer photos / voice notes, product photos and tap-to-answer buttons we send.
addColumn('chat_messages', 'attachments_json', 'TEXT');
addColumn('chat_messages', 'buttons_json', 'TEXT');
