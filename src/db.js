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
