import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { get } from './db.js';
import { sha256, sign } from './crypto.js';
import { api, inbound } from './routes/api.js';
import { shopifyRoutes } from './routes/shopify.js';

const here = path.dirname(fileURLToPath(import.meta.url));

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

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      // frame-ancestors lets the page load inside Shopify admin later (embedded app).
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors https://*.myshopify.com https://admin.shopify.com",
    });
    next();
  });
  app.use(cookies);

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(inbound);
  app.use(shopifyRoutes);

  // Sign in with a store API key (stores created by scripts/create-store.js, or for testing).
  app.post('/session', express.json(), (req, res) => {
    const store = get('SELECT id FROM stores WHERE api_key_hash = ?', sha256(String(req.body?.api_key || '').trim()));
    if (!store) return res.status(401).json({ error: 'Invalid API key' });
    res.cookie('od_store', sign(String(store.id)), { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 30 * 24 * 3600 * 1000 });
    res.json({ ok: true });
  });
  app.post('/session/logout', (_req, res) => { res.clearCookie('od_store'); res.json({ ok: true }); });

  app.use('/api', api);
  app.use(express.static(path.join(here, '..', 'public')));

  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[error]', err);
    res.status(status).json({ error: status >= 500 && status !== 502 ? 'Something went wrong' : err.message });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp().listen(config.port, () => console.log(`${config.appName} on ${config.appUrl}`));
}
