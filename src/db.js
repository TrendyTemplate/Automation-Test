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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL DEFAULT 'trial',
  subscription_status TEXT,
  billing_interval TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end TEXT,
  trial_ends_at TEXT,
  -- AI persona / brand settings
  business_name TEXT,
  business_description TEXT,
  reply_tone TEXT NOT NULL DEFAULT 'friendly and professional',
  signature TEXT,
  default_language TEXT NOT NULL DEFAULT 'auto',
  business_hours TEXT,          -- JSON {tz, days:[1..7], start:"09:00", end:"18:00"} or NULL = always
  auto_send_min_confidence REAL NOT NULL DEFAULT 0.8,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',   -- owner | admin | member
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label TEXT,
  email TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'custom',
  imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL DEFAULT 993, imap_secure INTEGER NOT NULL DEFAULT 1,
  smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL DEFAULT 465, smtp_secure INTEGER NOT NULL DEFAULT 1,
  username TEXT NOT NULL,
  password_enc TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'draft',   -- off | draft (human approves) | auto (send automatically)
  enabled INTEGER NOT NULL DEFAULT 1,
  last_uid INTEGER NOT NULL DEFAULT 0,
  uid_validity TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  uid INTEGER,
  message_id TEXT,
  in_reply_to TEXT,
  references_hdr TEXT,
  from_name TEXT, from_email TEXT,
  to_email TEXT,
  subject TEXT,
  text_body TEXT,
  received_at TEXT,
  headers_json TEXT,
  -- AI triage
  category TEXT, priority TEXT, sentiment TEXT, language TEXT,
  summary TEXT, needs_reply INTEGER, confidence REAL,
  is_automated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',   -- new | triaged | drafted | replied | ignored | error
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (mailbox_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_ws ON messages(workspace_id, received_at DESC);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  subject TEXT, body TEXT NOT NULL,
  source TEXT NOT NULL,                 -- ai | template | manual
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | rejected | failed
  error TEXT,
  approved_by INTEGER REFERENCES users(id),
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  conditions_json TEXT NOT NULL,   -- {match:"all"|"any", items:[{field, op, value}]}
  actions_json TEXT NOT NULL,      -- [{type, ...}]
  stop_processing INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, subject TEXT, body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  emails_sent INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, period)
);

CREATE TABLE IF NOT EXISTS sent_log (     -- loop protection: who did we auto-reply to and when
  workspace_id INTEGER NOT NULL,
  to_email TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sent_log ON sent_log(workspace_id, to_email, sent_at);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL, detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_ws ON activity(workspace_id, id DESC);
`);

// node:sqlite rejects undefined/boolean bindings; normalise them.
const norm = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p));
export const one = (sql, ...params) => db.prepare(sql).get(...norm(params));
export const all = (sql, ...params) => db.prepare(sql).all(...norm(params));
export const run = (sql, ...params) => db.prepare(sql).run(...norm(params));

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const period = () => new Date().toISOString().slice(0, 7);

export function bumpUsage(workspaceId, fields) {
  const p = period();
  run('INSERT OR IGNORE INTO usage (workspace_id, period) VALUES (?, ?)', workspaceId, p);
  for (const [k, v] of Object.entries(fields)) {
    if (!['ai_calls', 'ai_replies', 'emails_sent', 'input_tokens', 'output_tokens'].includes(k)) continue;
    run(`UPDATE usage SET ${k} = ${k} + ? WHERE workspace_id = ? AND period = ?`, v, workspaceId, p);
  }
}

export function getUsage(workspaceId) {
  return one('SELECT * FROM usage WHERE workspace_id = ? AND period = ?', workspaceId, period())
    || { ai_calls: 0, ai_replies: 0, emails_sent: 0, input_tokens: 0, output_tokens: 0 };
}

export function logActivity(workspaceId, type, detail) {
  run('INSERT INTO activity (workspace_id, type, detail) VALUES (?, ?, ?)', workspaceId, type,
    typeof detail === 'string' ? detail : JSON.stringify(detail));
}

// ---------------------------------------------------------------------------
// Migrations (v2). Idempotent: safe to run on every boot and on old databases.
// ---------------------------------------------------------------------------
function addColumn(table, col, def) {
  const cols = all(`PRAGMA table_info(${table})`).map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

for (const [col, def] of [
  ['google_id', 'TEXT'], ['microsoft_id', 'TEXT'], ['avatar_url', 'TEXT'],
  ['email_verified', 'INTEGER NOT NULL DEFAULT 0'], ['suspended', 'INTEGER NOT NULL DEFAULT 0'],
  ['totp_secret_enc', 'TEXT'], ['totp_enabled', 'INTEGER NOT NULL DEFAULT 0'],
  ['last_login_at', 'TEXT'], ['last_login_ip', 'TEXT'], ['referral_code', 'TEXT'], ['referred_by', 'INTEGER'],
  ['current_workspace_id', 'INTEGER'], ['locale', "TEXT NOT NULL DEFAULT 'en'"],
]) addColumn('users', col, def);

for (const [col, def] of [
  ['suspended', 'INTEGER NOT NULL DEFAULT 0'], ['limits_override_json', 'TEXT'], ['admin_notes', 'TEXT'],
  ['style_guide', 'TEXT'], ['retention_days', 'INTEGER NOT NULL DEFAULT 0'],
  ['privacy_shield', 'INTEGER NOT NULL DEFAULT 1'],
  ['reply_delay_min', 'INTEGER NOT NULL DEFAULT 2'], ['reply_delay_max', 'INTEGER NOT NULL DEFAULT 8'],
  ['followup_days', 'INTEGER NOT NULL DEFAULT 3'], ['digest_enabled', 'INTEGER NOT NULL DEFAULT 1'],
  ['digest_hour', 'INTEGER NOT NULL DEFAULT 8'], ['timezone', "TEXT NOT NULL DEFAULT 'UTC'"],
  ['last_digest_on', 'TEXT'], ['telegram_chat_id', 'TEXT'], ['slack_webhook', 'TEXT'],
  ['alert_on', "TEXT NOT NULL DEFAULT 'urgent,negative,vip,phishing'"], ['booking_link', 'TEXT'],
  ['learn_from_edits', 'INTEGER NOT NULL DEFAULT 1'],
]) addColumn('workspaces', col, def);

for (const [col, def] of [
  ['auth_type', "TEXT NOT NULL DEFAULT 'password'"], ['oauth_refresh_enc', 'TEXT'],
  ['oauth_access_enc', 'TEXT'], ['oauth_expires_at', 'INTEGER'], ['signature', 'TEXT'],
]) addColumn('mailboxes', col, def);

for (const [col, def] of [
  ['reasoning', 'TEXT'], ['intent', 'TEXT'], ['lead_score', 'INTEGER'], ['extracted_json', 'TEXT'],
  ['is_phishing', 'INTEGER NOT NULL DEFAULT 0'], ['contact_id', 'INTEGER'], ['starred', 'INTEGER NOT NULL DEFAULT 0'],
  ['first_response_sec', 'INTEGER'],
]) addColumn('messages', col, def);

for (const [col, def] of [
  ['scheduled_at', 'TEXT'], ['ai_original', 'TEXT'], ['kind', "TEXT NOT NULL DEFAULT 'reply'"],
]) addColumn('replies', col, def);

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS plans (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  mailboxes INTEGER NOT NULL, ai_replies INTEGER NOT NULL, rules INTEGER NOT NULL, team_members INTEGER NOT NULL,
  auto_send INTEGER NOT NULL DEFAULT 1, features_json TEXT,
  price_monthly REAL, price_yearly REAL, price_once REAL,
  stripe_price_monthly TEXT, stripe_price_yearly TEXT, stripe_price_once TEXT,
  public INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, highlight INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL, name TEXT, company TEXT, phone TEXT,
  vip INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0,
  tags TEXT, notes TEXT, lead_score INTEGER, last_sentiment TEXT,
  emails_in INTEGER NOT NULL DEFAULT 0, emails_out INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT DEFAULT (datetime('now')), last_seen TEXT,
  UNIQUE (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email_summary TEXT, ai_draft TEXT NOT NULL, final_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
  last_used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tokens (          -- password reset / email verification / 2FA pending login
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL, expires_at TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_contacts_ws ON contacts(workspace_id, last_seen DESC);
`);

// Seed default plans once (admins edit them from the admin panel afterwards).
if (one('SELECT COUNT(*) AS n FROM plans').n === 0) {
  const seed = [
    ['trial', 'Free Trial', 'Try everything free', 2, 100, 5, 1, 1, null, 0, 0, null, 0, 0],
    ['starter', 'Starter', 'For freelancers & solo founders', 3, 1000, 20, 1, 1, null, 19, 190, null, 1, 1],
    ['pro', 'Pro', 'For growing businesses', 10, 5000, 100, 5, 1, null, 49, 490, null, 1, 2],
    ['business', 'Business', 'For teams & agencies', 50, 25000, 500, 25, 1, null, 149, 1490, null, 1, 3],
    ['lifetime', 'Lifetime', 'Pay once, use forever', 5, 1500, 50, 2, 1, null, null, null, 299, 1, 4],
  ];
  for (const p of seed) {
    run(`INSERT INTO plans (key, name, description, mailboxes, ai_replies, rules, team_members, auto_send, features_json,
      price_monthly, price_yearly, price_once, public, sort, highlight) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...p, p[0] === 'pro' ? 1 : 0);
  }
}

// Existing users without a referral code get one.
for (const u of all('SELECT id FROM users WHERE referral_code IS NULL')) {
  run('UPDATE users SET referral_code = ? WHERE id = ?', Math.random().toString(36).slice(2, 8) + u.id.toString(36), u.id);
}

export function audit(req, action, target, detail) {
  run('INSERT INTO audit_log (actor_id, actor_email, action, target, detail, ip) VALUES (?,?,?,?,?,?)',
    req?.user?.id ?? null, req?.user?.email ?? 'system', action, target == null ? null : String(target),
    detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)), req?.ip ?? null);
}

// ---------------------------------------------------------------------------
// Migrations (v3): security, trust & team features.
// ---------------------------------------------------------------------------
for (const [col, def] of [
  ['failed_logins', 'INTEGER NOT NULL DEFAULT 0'], ['locked_until', 'TEXT'], ['password_changed_at', 'TEXT'],
  ['ui_theme', "TEXT NOT NULL DEFAULT 'system'"], ['ui_language', "TEXT NOT NULL DEFAULT 'en'"],
]) addColumn('users', col, def);

for (const [col, def] of [
  ['dek_enc', 'TEXT'], ['support_access_until', 'TEXT'],
  ['sensitive_topics', "TEXT NOT NULL DEFAULT 'refund, chargeback, cancel subscription, lawyer, legal action, lawsuit, medical, emergency'"],
  ['never_say', 'TEXT'], ['allowed_link_domains', 'TEXT'], ['hourly_rate', 'REAL NOT NULL DEFAULT 30'],
  ['ooo_until', 'TEXT'], ['ooo_message', 'TEXT'], ['sla_json', "TEXT NOT NULL DEFAULT '{\"urgent\":60,\"high\":240,\"normal\":1440}'"],
  ['webhook_secret', 'TEXT'], ['read_attachments', 'INTEGER NOT NULL DEFAULT 1'], ['owner_language', "TEXT NOT NULL DEFAULT 'en'"],
  ['last_sla_alert_at', 'TEXT'],
]) addColumn('workspaces', col, def);

for (const [col, def] of [
  ['auto_categories', 'TEXT'], // JSON array; null = all categories may be auto-sent ("earned autopilot")
  ['revoked_at', 'TEXT'],
]) addColumn('mailboxes', col, def);

for (const [col, def] of [
  ['assigned_to', 'INTEGER'], ['snoozed_until', 'TEXT'], ['injection_flag', 'INTEGER NOT NULL DEFAULT 0'],
  ['attachments_json', 'TEXT'], ['list_unsubscribe', 'TEXT'], ['list_unsubscribe_post', 'INTEGER NOT NULL DEFAULT 0'],
  ['opt_out', 'INTEGER NOT NULL DEFAULT 0'], ['facts_used', 'TEXT'], ['sla_due_at', 'TEXT'], ['done', 'INTEGER NOT NULL DEFAULT 0'],
]) addColumn('messages', col, def);

for (const [col, def] of [
  ['guard_json', 'TEXT'], ['edited', 'INTEGER'],
]) addColumn('replies', col, def);

addColumn('contacts', 'do_not_contact', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`
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

CREATE TABLE IF NOT EXISTS message_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_log (            -- transparency: every time an email is shown to the AI
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id INTEGER, purpose TEXT NOT NULL, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
  redactions INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ailog_ws ON ai_log(workspace_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_snooze ON messages(workspace_id, snoozed_until);
`);

addColumn('plans', 'ai_calls', 'INTEGER');
run('UPDATE plans SET ai_calls = ai_replies * 3 WHERE ai_calls IS NULL');

export function securityEvent(req, type, detail, { userId, workspaceId } = {}) {
  run('INSERT INTO security_events (user_id, workspace_id, type, detail, ip, user_agent) VALUES (?,?,?,?,?,?)',
    userId ?? req?.user?.id ?? null, workspaceId ?? req?.workspace?.id ?? null, type,
    detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)),
    req?.ip ?? null, String(req?.headers?.['user-agent'] || '').slice(0, 200) || null);
}
addColumn('messages', 'reply_to_email', 'TEXT');
addColumn('messages', 'guard_flags', 'TEXT');
