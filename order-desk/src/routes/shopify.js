// Shopify app install (OAuth) and mandatory compliance webhooks.
import express from 'express';
import { config } from '../config.js';
import { get, run } from '../db.js';
import { encrypt, hmacHex, hmacBase64, randomToken, safeEqual, sign, unsign } from '../crypto.js';
import { syncCatalog, getStore } from '../core/pipeline.js';

export const shopifyRoutes = express.Router();
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 30 * 24 * 3600 * 1000 };

/** Shopify signs install/callback query strings with the app secret. */
export function verifyQueryHmac(query) {
  const { hmac, signature, ...rest } = query;
  if (!hmac || !config.shopify.apiSecret) return false;
  const msg = Object.keys(rest).sort().map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`).join('&');
  return safeEqual(hmacHex(config.shopify.apiSecret, msg), String(hmac));
}

shopifyRoutes.get('/shopify/install', (req, res) => {
  const shop = String(req.query.shop || '').toLowerCase();
  if (!SHOP_RE.test(shop)) return res.status(400).send('Invalid shop domain');
  if (!config.shopify.apiKey) return res.status(500).send('SHOPIFY_API_KEY is not configured');
  const state = randomToken(16);
  res.cookie('od_oauth_state', sign(state), { ...cookieOpts, maxAge: 10 * 60 * 1000 });
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set('client_id', config.shopify.apiKey);
  url.searchParams.set('scope', config.shopify.scopes);
  url.searchParams.set('redirect_uri', `${config.appUrl}/shopify/callback`);
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

shopifyRoutes.get('/shopify/callback', async (req, res, next) => {
  try {
    const shop = String(req.query.shop || '').toLowerCase();
    const state = unsign(req.cookies?.od_oauth_state);
    if (!SHOP_RE.test(shop) || !verifyQueryHmac(req.query) || !state || !safeEqual(state, String(req.query.state || ''))) {
      return res.status(400).send('Install request could not be verified. Please start again from your Shopify admin.');
    }
    res.clearCookie('od_oauth_state');
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: config.shopify.apiKey, client_secret: config.shopify.apiSecret, code: String(req.query.code || '') }),
    });
    if (!tokenRes.ok) return res.status(502).send('Shopify did not issue an access token');
    const { access_token: token } = await tokenRes.json();

    let store = get("SELECT * FROM stores WHERE platform = 'shopify' AND shop_domain = ?", shop);
    if (!store) {
      const { lastInsertRowid } = run("INSERT INTO stores (name, platform, shop_domain, inbound_token) VALUES (?, 'shopify', ?, ?)",
        shop.replace('.myshopify.com', ''), shop, randomToken(12));
      store = getStore(Number(lastInsertRowid));
    }
    run('UPDATE stores SET access_token_enc = ? WHERE id = ?', encrypt(token, `store:${store.id}:token`), store.id);
    res.cookie('od_store', sign(String(store.id)), cookieOpts);
    syncCatalog(getStore(store.id)).catch((e) => console.error('[shopify] catalog sync failed', shop, e.message));
    res.redirect('/');
  } catch (e) { next(e); }
});

// Mandatory GDPR webhooks + app/uninstalled. We store no end-customer personal data beyond PO contact fields.
shopifyRoutes.post('/shopify/webhooks', express.raw({ type: () => true, limit: '1mb' }), (req, res) => {
  const sig = req.get('x-shopify-hmac-sha256') || '';
  if (!config.shopify.apiSecret || !req.body?.length || !safeEqual(hmacBase64(config.shopify.apiSecret, req.body), sig)) {
    return res.status(401).end();
  }
  const topic = req.get('x-shopify-topic') || '';
  const shop = String(req.get('x-shopify-shop-domain') || '').toLowerCase();
  const store = get("SELECT * FROM stores WHERE platform = 'shopify' AND shop_domain = ?", shop);
  if (store && (topic === 'shop/redact' || topic === 'app/uninstalled')) {
    if (topic === 'shop/redact') run('DELETE FROM stores WHERE id = ?', store.id);
    else run('UPDATE stores SET access_token_enc = NULL WHERE id = ?', store.id);
  }
  if (store && topic === 'customers/redact') {
    let body = {};
    try { body = JSON.parse(req.body.toString('utf8')); } catch { /* ignore */ }
    const email = String(body.customer?.email || '').toLowerCase();
    if (email) {
      run(`UPDATE purchase_orders SET sender_email = NULL, buyer_email = NULL, customer_name = NULL, ship_to_json = '{}'
           WHERE store_id = ? AND (lower(sender_email) = ? OR lower(buyer_email) = ?)`, store.id, email, email);
    }
  }
  res.status(200).end();
});
