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
import { appUrl, appName } from './settings.js';
import { aiEnabled } from './services/ai.js';
import { stripe } from './routes/billing.js';
import { startWorker } from './services/worker.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'], connectSrc: ["'self'"],
        formAction: ["'self'"], frameAncestors: ["'none'"],
      },
    },
  }));

  app.use('/api/billing/webhook', webhookRouter); // raw body, before json parser
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // CSRF defense for cookie auth: state-changing API calls must come from our own origin.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Bad origin' });
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
    (/^Bearer\s+mp_live_/i.test(req.headers.authorization || '') ? res.status(403).json({ error: 'API keys cannot access this endpoint' }) : next()));
  app.get('/api/public/config', (req, res) => res.json({ appName: appName() }));
  app.use('/api/oauth', rateLimit({ windowMs: 15 * 60_000, limit: 60 }), oauthRoutes);
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }), authRoutes);
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
  app.use(express.static(publicDir, { extensions: ['html'] }));
  app.get(['/app', '/app/*splat'], (req, res) => res.sendFile(path.join(publicDir, 'app.html')));
  app.get(['/admin', '/admin/*splat'], (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));

  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: config.isProd ? 'Internal server error' : err.message });
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
