import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { get } from './db.js';
import { sha256, sign } from './crypto.js';
import { api, inbound } from './routes/api.js';
import { shopifyRoutes } from './routes/shopify.js';
import { connectRoutes } from './routes/connect.js';
import { rateLimit } from './ratelimit.js';
import { startWorker } from './core/jobs.js';
import './core/handlers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function cookies(req, _res, next) {
  req.cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip malformed */ }
    }
  }
  next();
}

function csp(shop) {
  const frame = shop ? `https://${shop} https://admin.shopify.com` : "'none'";
  return [
    "default-src 'self'", "img-src 'self' data:", "style-src 'self' 'unsafe-inline'",
    "script-src 'self' https://cdn.shopify.com", "connect-src 'self' https://*.shopify.com",
    `frame-ancestors ${frame}`, "base-uri 'none'", "form-action 'self'",
  ].join('; ');
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    const shop = SHOP_RE.test(String(req.query.shop || '')) ? String(req.query.shop) : null;
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': csp(shop) });
    next();
  });
  app.use(cookies);

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(inbound);
  app.use(shopifyRoutes);
  app.use(connectRoutes);

  // Sign in with a store API key.
  app.post('/session', rateLimit({ windowMs: 15 * 60_000, max: 20 }), express.json(), (req, res) => {
    const store = get('SELECT id FROM stores WHERE api_key_hash = ?', sha256(String(req.body?.api_key || '').trim()));
    if (!store) return res.status(401).json({ error: 'Invalid API key' });
    res.cookie('od_store', sign(String(store.id)), { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 30 * 24 * 3600 * 1000 });
    res.json({ ok: true });
  });
  app.post('/session/logout', (_req, res) => { res.clearCookie('od_store'); res.json({ ok: true }); });

  app.use('/api', api);

  // App page. Inside Shopify admin (?shop=…&host=…) it loads App Bridge, which supplies session tokens.
  const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  app.get(['/', '/index.html'], (req, res) => {
    const shop = String(req.query.shop || '').toLowerCase();
    const embedded = SHOP_RE.test(shop) && req.query.host && config.shopify.apiKey;
    if (embedded) {
      const installed = get("SELECT 1 FROM stores WHERE platform = 'shopify' AND shop_domain = ? AND access_token_enc IS NOT NULL", shop);
      if (!installed) {
        // Not installed yet: OAuth must run in the top window, not inside the admin iframe.
        const url = `/shopify/install?shop=${encodeURIComponent(shop)}`;
        return res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Installing…</title><a id="go" href="${esc(url)}" target="_top">Continue installing</a><script src="/top-redirect.js"></script>`);
      }
      const head = `<meta name="shopify-api-key" content="${esc(config.shopify.apiKey)}">\n<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>`;
      return res.type('html').send(indexHtml.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${head}`));
    }
    res.type('html').send(indexHtml);
  });
  app.use(express.static(publicDir, { index: false }));

  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500 && status !== 502) console.error('[error]', err);
    res.status(status).json({ error: status >= 500 && status !== 502 ? 'Something went wrong' : err.message });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp().listen(config.port, () => console.log(`${config.appName} on ${config.appUrl}`));
  startWorker();
}
