// Sign-up for stores that are not on Shopify, and connecting WooCommerce / QuickBooks / Xero.
import express from 'express';
import { config } from '../config.js';
import { get, run } from '../db.js';
import { encrypt, randomToken, sha256, sign, unsign, safeEqual } from '../crypto.js';
import { getConnector } from '../connectors/index.js';
import { authorizeUrl, exchangeCode, saveOAuth, PROVIDERS } from '../core/oauth2.js';
import { xeroTenant } from '../connectors/xero.js';
import { enqueue } from '../core/jobs.js';
import { getStore } from '../core/pipeline.js';
import { rateLimit } from '../ratelimit.js';

export const connectRoutes = express.Router();
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 30 * 24 * 3600 * 1000 };
const SIGNUP_PLATFORMS = ['csv', 'woocommerce', 'quickbooks', 'xero'];

connectRoutes.post('/signup', rateLimit({ windowMs: 3600_000, max: 10 }), express.json(), (req, res) => {
  const name = String(req.body?.store_name || '').trim().slice(0, 100);
  const platform = String(req.body?.platform || '');
  const currency = String(req.body?.currency || 'USD').toUpperCase();
  if (!name) return res.status(400).json({ error: 'Store name is required' });
  if (!SIGNUP_PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Shopify stores install the app from Shopify; choose another platform here' });
  if (!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({ error: 'Currency must be a 3-letter code' });
  const apiKey = `od_${randomToken(24)}`;
  const { lastInsertRowid } = run('INSERT INTO stores (name, platform, api_key_hash, inbound_token, currency) VALUES (?,?,?,?,?)',
    name, platform, sha256(apiKey), randomToken(12), currency);
  res.cookie('od_store', sign(String(lastInsertRowid)), cookieOpts);
  res.status(201).json({ ok: true, api_key: apiKey, next: platform === 'csv' ? 'upload_catalog' : `connect_${platform}` });
});

function sessionStore(req) {
  const id = unsign(req.cookies?.od_store);
  return id ? getStore(Number(id)) : null;
}

// WooCommerce: REST API keys (WooCommerce → Settings → Advanced → REST API, read/write).
// Mounted on the authenticated /api router (see routes/api.js).
export async function connectWoocommerce(req, res, next) {
  try {
    const { store } = req;
    if (store.platform !== 'woocommerce') return res.status(400).json({ error: 'This store is not a WooCommerce store' });
    let site;
    try { site = new URL(String(req.body?.site_url || '')); } catch { return res.status(400).json({ error: 'Enter your store address, e.g. https://shop.example.com' }); }
    if (site.protocol !== 'https:' && !(process.env.ALLOW_PRIVATE_HOSTS === 'true' && site.protocol === 'http:')) return res.status(400).json({ error: 'Your store must use https' });
    const key = String(req.body?.consumer_key || '').trim();
    const secret = String(req.body?.consumer_secret || '').trim();
    if (!/^ck_[a-f0-9]{20,}$/i.test(key) || !/^cs_[a-f0-9]{20,}$/i.test(secret)) return res.status(400).json({ error: 'Paste the consumer key (ck_…) and secret (cs_…)' });
    const siteUrl = `${site.origin}${site.pathname.replace(/\/$/, '')}`;
    const candidate = { ...store, site_url: siteUrl, access_token_enc: encrypt(JSON.stringify({ key, secret }), `store:${store.id}:token`) };
    try { await getConnector('woocommerce').test(candidate); } catch (e) { return res.status(400).json({ error: `Could not connect: ${e.message}` }); }
    run('UPDATE stores SET site_url = ?, shop_domain = ?, access_token_enc = ? WHERE id = ?', siteUrl, site.hostname, candidate.access_token_enc, store.id);
    enqueue('sync_catalog', { storeId: store.id });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// QuickBooks / Xero OAuth.
connectRoutes.get('/connect/:provider/start', (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS[provider]) return res.status(404).send('Unknown provider');
  const store = sessionStore(req);
  if (!store) return res.redirect('/');
  if (store.platform !== provider) return res.status(400).send(`This store uses ${store.platform}, not ${provider}`);
  const nonce = randomToken(12);
  res.cookie('od_oauth_state', sign(`${store.id}:${nonce}`), { ...cookieOpts, maxAge: 10 * 60 * 1000 });
  res.redirect(authorizeUrl(provider, nonce));
});

connectRoutes.get('/connect/:provider/callback', async (req, res, next) => {
  try {
    const { provider } = req.params;
    if (!PROVIDERS[provider]) return res.status(404).send('Unknown provider');
    const state = unsign(req.cookies?.od_oauth_state) || '';
    const [storeId, nonce] = state.split(':');
    const store = storeId ? getStore(Number(storeId)) : null;
    if (!store || !nonce || !safeEqual(nonce, String(req.query.state || '')) || store.platform !== provider) {
      return res.status(400).send('Connection could not be verified. Please try again.');
    }
    if (req.query.error) return res.status(400).send(`Connection cancelled: ${String(req.query.error).slice(0, 100)}`);
    res.clearCookie('od_oauth_state');
    const t = await exchangeCode(provider, String(req.query.code || ''));
    const data = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (Number(t.expires_in) || 1800) * 1000 };
    if (provider === 'quickbooks') {
      const realm = String(req.query.realmId || '');
      if (!/^\d+$/.test(realm)) return res.status(400).send('QuickBooks did not return a company id');
      data.realm_id = realm;
    } else {
      Object.assign(data, await xeroTenant(t.access_token));
    }
    const domain = provider === 'quickbooks' ? `qbo:${data.realm_id}` : `xero:${data.tenant_id}`;
    const taken = get('SELECT id FROM stores WHERE platform = ? AND shop_domain = ? AND id != ?', provider, domain, store.id);
    if (taken) return res.status(409).send('This company is already connected to another AI Order Desk account.');
    run('UPDATE stores SET shop_domain = ? WHERE id = ?', domain, store.id);
    saveOAuth(store.id, data);
    enqueue('sync_catalog', { storeId: store.id });
    res.redirect('/?connected=1');
  } catch (e) { next(e); }
});

export const connectionStatus = (store) => {
  if (store.platform === 'csv') return { connected: true };
  if (store.platform === 'woocommerce') return { connected: Boolean(store.site_url && store.access_token_enc), site_url: store.site_url };
  if (store.platform === 'quickbooks' || store.platform === 'xero') return { connected: Boolean(store.oauth_enc), configured: Boolean(PROVIDERS[store.platform].creds().clientId) };
  return { connected: Boolean(store.access_token_enc) };
};
