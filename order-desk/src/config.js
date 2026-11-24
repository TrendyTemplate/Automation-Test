import 'dotenv/config';
import crypto from 'node:crypto';

const isProd = process.env.NODE_ENV === 'production';

function secret(name) {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`Missing required environment variable: ${name}`);
  // Development only: a stable throwaway value so the app boots with zero setup.
  return crypto.createHash('sha256').update(`order-desk-dev-${name}`).digest('hex');
}

export const config = {
  isProd,
  port: Number(process.env.PORT || 3100),
  appUrl: (process.env.APP_URL || 'http://localhost:3100').replace(/\/$/, ''),
  appName: process.env.APP_NAME || 'AI Order Desk',
  dbPath: process.env.DB_PATH || './data/order-desk.db',

  // 64 hex chars (32 bytes). Encrypts platform access tokens at rest.
  encryptionKey: secret('ENCRYPTION_KEY'),
  // Signs session cookies.
  sessionSecret: secret('SESSION_SECRET'),

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-opus-5-5',
    effort: process.env.AI_EFFORT || 'low',
  },

  shopify: {
    apiKey: process.env.SHOPIFY_API_KEY || '',
    apiSecret: process.env.SHOPIFY_API_SECRET || '',
    apiVersion: process.env.SHOPIFY_API_VERSION || '2026-10',
    scopes: process.env.SHOPIFY_SCOPES || 'read_products,read_inventory,read_customers,write_draft_orders,read_companies',
  },

  // Matching thresholds
  autoMatchConfidence: Number(process.env.AUTO_MATCH_CONFIDENCE || 0.9),
  maxLinesPerPo: Number(process.env.MAX_LINES_PER_PO || 500),
  maxAttachmentBytes: Number(process.env.MAX_ATTACHMENT_BYTES || 15 * 1024 * 1024),
};

if (!/^[0-9a-f]{64}$/i.test(config.encryptionKey)) {
  throw new Error('ENCRYPTION_KEY must be 64 hex characters. Generate one with: openssl rand -hex 32');
}
