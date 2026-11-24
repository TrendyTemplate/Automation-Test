import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
-- One row per connected store. "platform" names the connector (shopify, csv, ... later woocommerce, quickbooks).
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  shop_domain TEXT,
  access_token_enc TEXT,
  api_key_hash TEXT UNIQUE,
  inbound_token TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'USD',
  auto_create INTEGER NOT NULL DEFAULT 0,   -- 1 = create orders without review when every line is certain
  catalog_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (platform, shop_domain)
);

-- The store's sellable items, synced from the platform. case_pack is editable by the merchant.
CREATE TABLE IF NOT EXISTS catalog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  title TEXT NOT NULL,
  variant_title TEXT,
  price REAL,
  inventory INTEGER,
  case_pack INTEGER NOT NULL DEFAULT 1,
  UNIQUE (store_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_sku ON catalog_items(store_id, sku);
CREATE INDEX IF NOT EXISTS idx_catalog_barcode ON catalog_items(store_id, barcode);

-- Learned mapping: "when buyer X writes code Y they mean item Z". This is the product's moat.
CREATE TABLE IF NOT EXISTS customer_sku_map (
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_key TEXT NOT NULL,
  raw_key TEXT NOT NULL,
  external_id TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (store_id, customer_key, raw_key)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  source TEXT NOT NULL,                 -- email | upload | api
  source_filename TEXT,
  sender_email TEXT,
  buyer_email TEXT,
  customer_key TEXT,
  customer_external_id TEXT,
  customer_name TEXT,
  company_name TEXT,
  po_number TEXT,
  po_date TEXT,
  requested_ship_date TEXT,
  currency TEXT,
  ship_to_json TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'needs_review', -- needs_review | ready | created | rejected | failed
  flags_json TEXT NOT NULL DEFAULT '[]',
  order_external_id TEXT,
  order_name TEXT,
  order_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_po_store ON purchase_orders(store_id, status, id);

CREATE TABLE IF NOT EXISTS po_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  raw_code TEXT,
  raw_description TEXT,
  quantity REAL NOT NULL,
  unit TEXT,
  unit_price REAL,
  matched_external_id TEXT,
  final_quantity INTEGER,
  confidence REAL NOT NULL DEFAULT 0,
  match_method TEXT,                    -- memory | sku | barcode | fuzzy | manual | none
  flags_json TEXT NOT NULL DEFAULT '[]',
  candidates_json TEXT NOT NULL DEFAULT '[]',
  corrected INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lines_po ON po_lines(po_id, line_no);
`);

db.exec(`
-- Background work: inbound email parsing, catalog sync, mailbox polling, notifications.
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, run_at);

-- Mailboxes polled over IMAP (alternative to forwarding).
CREATE TABLE IF NOT EXISTS mailboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 993,
  secure INTEGER NOT NULL DEFAULT 1,
  username TEXT NOT NULL,
  password_enc TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT 'INBOX',
  last_uid INTEGER,
  uid_validity TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_polled_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Additive migrations for databases created by earlier versions.
function addColumn(table, column, definition) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
addColumn('stores', 'plan', "TEXT NOT NULL DEFAULT 'free'");
addColumn('stores', 'billing_subscription_id', 'TEXT');
addColumn('stores', 'notify_email', 'TEXT');
addColumn('stores', 'slack_webhook_url', 'TEXT');
addColumn('stores', 'confirm_buyer', 'INTEGER NOT NULL DEFAULT 0');
addColumn('stores', 'confirm_message', 'TEXT');
addColumn('stores', 'oauth_enc', 'TEXT');          // encrypted JSON: refresh token, expiry, realm/tenant (QuickBooks, Xero)
addColumn('stores', 'site_url', 'TEXT');           // WooCommerce site
addColumn('purchase_orders', 'email_message_id', 'TEXT');
addColumn('purchase_orders', 'email_subject', 'TEXT');
addColumn('purchase_orders', 'confirmation_sent_at', 'TEXT');
addColumn('po_lines', 'expected_price', 'REAL');   // buyer-specific price (B2B price list) when known

export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
