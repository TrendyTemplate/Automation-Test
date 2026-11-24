import 'dotenv/config';
import crypto from 'node:crypto';

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

// In development we generate throwaway secrets so the app boots with zero setup.
// In production these MUST be set (the app refuses to start otherwise).
const devSecret = (label) => (isProd ? undefined : `dev-${label}-${crypto.randomBytes(8).toString('hex')}`);

export const config = {
  isProd,
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  appName: process.env.APP_NAME || 'ChatPilot AI',
  dbPath: process.env.DB_PATH || './data/chatpilot.db',

  jwtSecret: required('JWT_SECRET', devSecret('jwt')),
  // 32-byte key (64 hex chars) used to wrap the per-workspace keys that encrypt tokens and chats.
  encryptionKey: required('ENCRYPTION_KEY', isProd ? undefined : crypto.createHash('sha256').update('dev-only-key').digest('hex')),

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-opus-5-5',
    effort: process.env.AI_EFFORT || 'low',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    prices: {
      starter_monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY || '',
      starter_yearly: process.env.STRIPE_PRICE_STARTER_YEARLY || '',
      pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || '',
      pro_yearly: process.env.STRIPE_PRICE_PRO_YEARLY || '',
      business_monthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY || '',
      business_yearly: process.env.STRIPE_PRICE_BUSINESS_YEARLY || '',
      lifetime: process.env.STRIPE_PRICE_LIFETIME || '',
    },
  },

  // Emails listed here become platform admins on sign-up.
  adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),

  // Master key rotation: put the new key in ENCRYPTION_KEY, bump ENCRYPTION_KEY_VERSION, and move the old one to
  // ENCRYPTION_KEYS_OLD="1:<hex>" until Admin → Security → "Re-encrypt with current key" has finished.
  encryptionKeyVersion: Number(process.env.ENCRYPTION_KEY_VERSION || 1),
  oldEncryptionKeys: (process.env.ENCRYPTION_KEYS_OLD || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [v, k] = s.split(':'); return [Number(v), k]; }),
  trialDays: Number(process.env.TRIAL_DAYS || 14),
};

for (const [v, k] of config.oldEncryptionKeys) {
  if (!Number.isInteger(v) || !/^[0-9a-f]{64}$/i.test(k || '')) throw new Error('ENCRYPTION_KEYS_OLD must look like "1:<64 hex chars>,2:<64 hex chars>"');
}
if (config.isProd && config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');
if (!/^[0-9a-f]{64}$/i.test(config.encryptionKey)) {
  throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate one with: openssl rand -hex 32');
}
