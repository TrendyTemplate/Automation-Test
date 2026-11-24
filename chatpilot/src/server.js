import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import './db.js';
import { requireAuth, requireAdmin } from './auth.js';
import authRoutes from './routes/auth.js';
import appRoutes from './routes/app.js';
import billingRoutes, { webhookRouter } from './routes/billing.js';
import adminRoutes from './routes/admin.js';
import oauthRoutes from './routes/oauth.js';
import { webhookRouter as socialWebhook } from './routes/sales.js';
import metaCallbacks, { deletionStatusPage } from './routes/meta.js';
import { appUrl, appName, getSetting, getBool } from './settings.js';
import { metaConnectAvailable } from './services/meta.js';
import fs from 'node:fs';
import { aiEnabled } from './services/ai.js';
import { stripe } from './routes/billing.js';
import { startWorker } from './services/worker.js';
import { migrateEncryption } from './vault.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

let migrated = false;

export function createApp() {
  if (!migrated) {
    // Encrypt any legacy plaintext data and re-wrap keys after a master-key rotation (idempotent).
    const counts = migrateEncryption();
    if (Object.values(counts).some(Boolean)) console.log('[security] encryption migration:', counts);
    migrated = true;
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        // No third-party scripts, fonts or trackers at all: nothing external can read the page.
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'], connectSrc: ["'self'"],
        formAction: ["'self'", 'https://accounts.google.com', 'https://login.microsoftonline.com', 'https://checkout.stripe.com'],
        frameAncestors: ["'none'"], objectSrc: ["'none'"], baseUri: ["'self'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
  }));
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store'); // never cache customer data in browsers/proxies
    next();
  });

  app.use('/api/billing/webhook', webhookRouter); // raw body, before json parser
  // Messenger / Instagram / WhatsApp webhooks: raw body is needed to verify Meta's X-Hub-Signature-256.
  app.use('/api/social/webhook', rateLimit({ windowMs: 60_000, limit: 3000 }), socialWebhook);
  app.use('/api/meta', rateLimit({ windowMs: 60_000, limit: 120 }), metaCallbacks); // Meta data-deletion / deauthorize callbacks
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // CSRF defense for cookie auth (in addition to SameSite cookies): state-changing API calls must come from our
  // own origin. Uses Fetch Metadata where available and the Origin header otherwise.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.path.startsWith('/billing/webhook') || req.path.startsWith('/social/webhook') || req.path.startsWith('/meta/')) return next();
    const site = req.headers['sec-fetch-site'];
    if (site && !['same-origin', 'none'].includes(site)) return res.status(403).json({ error: 'Cross-site request blocked' });
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch { /* invalid */ }
      if (host !== req.headers.host) return res.status(403).json({ error: 'Bad origin' });
    }
    next();
  });

  // Affiliate links: remember ?ref=CODE for 30 days.
  app.use((req, res, next) => {
    if (req.method === 'GET' && typeof req.query.ref === 'string' && /^[a-z0-9]{3,20}$/i.test(req.query.ref)) {
      res.cookie('mp_ref', req.query.ref, { maxAge: 30 * 86400_000, sameSite: 'lax', httpOnly: true });
    }
    next();
  });

  // API keys are for the data API only — never for account, OAuth, billing or admin routes.
  app.use(['/api/auth', '/api/oauth', '/api/billing', '/api/admin'], (req, res, next) =>
    (/^Bearer\s+cp_live_/i.test(req.headers.authorization || '') ? res.status(403).json({ error: 'API keys cannot access this endpoint' }) : next()));
  app.get('/api/public/config', (req, res) => res.json({ appName: appName(), facebookSignup: metaConnectAvailable() && getBool('signup_enabled') }));
  app.use('/api/oauth', rateLimit({ windowMs: 15 * 60_000, limit: 60 }), oauthRoutes);
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: Number(process.env.AUTH_RATE_LIMIT || 30), standardHeaders: true, legacyHeaders: false }), authRoutes);
  app.use('/api/billing', billingRoutes);
  app.use('/api/admin', requireAuth, requireAdmin, adminRoutes);
  // Public REST API (API keys) uses the same handlers under /api/v1.
  const guard = [rateLimit({ windowMs: 60_000, limit: 300 }), requireAuth, (req, res, next) => {
    if (!req.workspace) return res.status(403).json({ error: 'No workspace' });
    next();
  }];
  app.use('/api/v1', ...guard, appRoutes);
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 300 }), requireAuth, (req, res, next) => {
    if (!req.workspace) return res.status(403).json({ error: 'No workspace' });
    next();
  }, appRoutes);

  app.get('/health', (req, res) => res.json({ ok: true }));

  // HTML pages are rendered with the brand and company details from Admin → Settings, so renaming the product
  // or filling in the legal entity updates every page (titles, landing, legal pages) without touching code.
  const PAGES = new Set(fs.readdirSync(publicDir).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5)));
  const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const renderPage = (name) => {
    const brand = escHtml(appName() || 'ChatPilot AI');
    const company = escHtml(getSetting('company_legal_name') || appName());
    return fs.readFileSync(path.join(publicDir, `${name}.html`), 'utf8')
      .replace(/ChatPilot( AI)?/g, (m) => (m === 'ChatPilot AI' ? brand : brand.replace(/ AI$/, '')))
      .replaceAll('{{COMPANY}}', company).replaceAll('{{COMPANY_ADDRESS}}', escHtml(getSetting('company_address') || '[company address]'))
      .replaceAll('{{TEMPLATE_NOTICE}}', getSetting('company_legal_name') ? '' : '<div class="callout warn"><b>Template.</b>&nbsp;Fill in Admin → Settings → Company legal name &amp; address, edit the [bracketed] parts, and have a lawyer review before launch. This notice disappears once the company name is set.</div>')
      .replaceAll('{{SUPPORT_EMAIL}}', escHtml(getSetting('support_email') || '[support email]')).replaceAll('{{APP_URL}}', escHtml(appUrl()))
      .replace('<head>', `<head>\n<meta name="app-name" content="${brand}">`);
  };
  const sendPage = (res, name, status = 200) => res.status(status).type('html').set('Cache-Control', 'no-cache').send(renderPage(name));
  app.get(['/app', '/app/*splat'], (req, res) => sendPage(res, 'app'));
  app.get(['/admin', '/admin/*splat'], (req, res) => sendPage(res, 'admin'));
  app.get('/', (req, res) => sendPage(res, 'index'));
  app.get('/deletion', deletionStatusPage);
  app.get('/:page', (req, res, next) => {
    const name = req.params.page.replace(/\.html$/, '');
    if (PAGES.has(name) && !['app', 'admin', 'index', '404'].includes(name)) return sendPage(res, name);
    next();
  });
  app.use(express.static(publicDir, { index: false }));
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api/') && req.accepts('html') ? sendPage(res, '404', 404) : next()));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(`[error] ${req.method} ${req.path}:`, err.message); // never log bodies (may contain secrets)
    res.status(err.status || 500).json({ error: config.isProd ? 'Something went wrong. Please try again.' : err.message });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createApp().listen(config.port, () => {
    console.log(`${appName()} running at ${appUrl()} (port ${config.port})`);
    if (!aiEnabled()) console.warn('Anthropic API key not set: AI disabled (keyword fallback only). Set it in Admin → Settings.');
    if (!stripe()) console.warn('Stripe key not set: online payments disabled.');
  });
  if (process.env.DISABLE_WORKER !== 'true') startWorker();
}
