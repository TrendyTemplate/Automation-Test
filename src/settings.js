// Platform settings editable from the admin panel. DB values override environment variables,
// so the owner can configure the product without touching the server.
import { one, run, all } from './db.js';
import { encrypt, decrypt } from './crypto.js';

export const SETTINGS = [
  // group, key, label, type, env fallback, secret, default, help
  ['general', 'app_name', 'Product name', 'text', 'APP_NAME', false, 'MailPilot AI'],
  ['general', 'app_url', 'Public URL', 'text', 'APP_URL', false, 'http://localhost:3000', 'Used in OAuth redirects, emails and Stripe'],
  ['general', 'support_email', 'Support email', 'text', 'SUPPORT_EMAIL', false, ''],
  ['general', 'signup_enabled', 'Allow new sign-ups', 'bool', null, false, '1'],
  ['general', 'maintenance_mode', 'Maintenance mode (only admins can use the app)', 'bool', null, false, '0'],
  ['general', 'trial_days', 'Free trial length (days)', 'number', 'TRIAL_DAYS', false, '14'],
  ['general', 'require_email_verification', 'Require email verification before connecting mailboxes', 'bool', null, false, '0'],

  ['security', 'require_admin_2fa', 'Require 2FA for platform admins (production)', 'bool', null, false, '1'],
  ['security', 'new_device_alerts', 'Email users when their account is accessed from a new device', 'bool', null, false, '1'],
  ['security', 'impersonation_requires_consent', 'Admins can only "log in as" a customer who granted support access', 'bool', null, false, '1'],
  ['security', 'allowed_admin_ips', 'Restrict the admin panel to these IPs (comma separated, blank = any)', 'text', null, false, ''],

  ['ai', 'anthropic_api_key', 'Anthropic API key', 'text', 'ANTHROPIC_API_KEY', true, ''],
  ['ai', 'ai_model', 'AI model', 'text', 'AI_MODEL', false, 'claude-opus-5-5'],
  ['ai', 'ai_effort', 'AI effort (low / medium / high)', 'text', 'AI_EFFORT', false, 'low'],
  ['ai', 'ai_input_price', 'Cost per 1M input tokens (USD, for reports)', 'number', null, false, '4'],
  ['ai', 'ai_output_price', 'Cost per 1M output tokens (USD, for reports)', 'number', null, false, '20'],

  ['oauth', 'google_client_id', 'Google OAuth client ID', 'text', 'GOOGLE_CLIENT_ID', false, ''],
  ['oauth', 'google_client_secret', 'Google OAuth client secret', 'text', 'GOOGLE_CLIENT_SECRET', true, ''],
  ['oauth', 'google_login_enabled', 'Enable "Sign in with Google"', 'bool', null, false, '1'],
  ['oauth', 'google_mailbox_enabled', 'Enable one-click Gmail connect (needs Google verification for >100 users)', 'bool', null, false, '1'],
  ['oauth', 'microsoft_client_id', 'Microsoft (Azure) app client ID', 'text', 'MICROSOFT_CLIENT_ID', false, ''],
  ['oauth', 'microsoft_client_secret', 'Microsoft app client secret', 'text', 'MICROSOFT_CLIENT_SECRET', true, ''],
  ['oauth', 'microsoft_login_enabled', 'Enable "Sign in with Microsoft"', 'bool', null, false, '1'],
  ['oauth', 'microsoft_mailbox_enabled', 'Enable one-click Outlook / Microsoft 365 connect', 'bool', null, false, '1'],

  ['email', 'smtp_host', 'System SMTP host (password resets, digests, alerts)', 'text', 'SMTP_HOST', false, ''],
  ['email', 'smtp_port', 'System SMTP port', 'number', 'SMTP_PORT', false, '587'],
  ['email', 'smtp_user', 'System SMTP username', 'text', 'SMTP_USER', false, ''],
  ['email', 'smtp_pass', 'System SMTP password', 'text', 'SMTP_PASS', true, ''],
  ['email', 'smtp_from', 'From address', 'text', 'SMTP_FROM', false, ''],

  ['payments', 'stripe_secret_key', 'Stripe secret key', 'text', 'STRIPE_SECRET_KEY', true, ''],
  ['payments', 'stripe_webhook_secret', 'Stripe webhook signing secret', 'text', 'STRIPE_WEBHOOK_SECRET', true, ''],
  ['payments', 'stripe_automatic_tax', 'Stripe automatic tax', 'bool', 'STRIPE_AUTOMATIC_TAX', false, '0'],
  ['payments', 'manual_payment_instructions', 'Manual payment instructions (bKash / bank / PayPal) shown on billing page', 'textarea', null, false, ''],
  ['payments', 'referral_commission_pct', 'Affiliate commission (%)', 'number', null, false, '30'],

  ['notifications', 'telegram_bot_token', 'Telegram bot token (for customer alerts)', 'text', 'TELEGRAM_BOT_TOKEN', true, ''],
  ['notifications', 'admin_alert_email', 'Email admins on new sign-ups / payments / tickets', 'text', null, false, ''],
];

const meta = Object.fromEntries(SETTINGS.map(([group, key, label, type, env, secret, def, help]) => [key, { group, key, label, type, env, secret, def, help }]));
let cache = null;

function load() {
  cache = Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
  return cache;
}

export function getSetting(key) {
  const m = meta[key];
  const c = cache || load();
  if (c[key] != null && c[key] !== '') {
    if (m?.secret) { try { return decrypt(c[key]); } catch { return ''; } }
    return c[key];
  }
  if (m?.env && process.env[m.env]) return m.env === 'STRIPE_AUTOMATIC_TAX' ? String(process.env[m.env] === 'true' ? 1 : 0) : process.env[m.env];
  return m?.def ?? '';
}
export const getBool = (k) => ['1', 'true', 'yes'].includes(String(getSetting(k)).toLowerCase());
export const getNum = (k) => Number(getSetting(k)) || 0;

export function setSetting(key, value) {
  const m = meta[key];
  if (!m) throw new Error(`Unknown setting ${key}`);
  const v = value == null ? '' : String(value);
  run(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  key, m.secret && v ? encrypt(v) : v);
  cache = null;
}

/** For the admin UI: never returns secret values, only whether they are set. */
export function listSettings() {
  return SETTINGS.map(([group, key, label, type, , secret, , help]) => ({
    group, key, label, type, secret, help: help || '',
    value: secret ? '' : getSetting(key),
    isSet: Boolean(getSetting(key)),
  }));
}

export const appUrl = () => getSetting('app_url').replace(/\/$/, '');
export const appName = () => getSetting('app_name');
