import { makeStore, fakeAi, poFixture, startServer } from './helpers.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { shopify } from '../src/connectors/shopify.js';
import { verifyQueryHmac } from '../src/routes/shopify.js';
import { getStore, syncCatalog } from '../src/core/pipeline.js';
import { registerConnector, getConnector } from '../src/connectors/index.js';

const srv = await startServer();
after(() => srv.close());

/** Minimal fake of the Shopify Admin GraphQL API. */
function fakeShopify() {
  const requests = [];
  shopify.fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    requests.push({ url, headers: init.headers, query, variables });
    let data;
    if (query.includes('productVariants')) {
      data = !variables.after
        ? { productVariants: { nodes: [
          { id: 'gid://shopify/ProductVariant/1', sku: 'TEA-GRN-12', barcode: '111', title: 'Default Title', price: '4.50', inventoryQuantity: 100, product: { title: 'Organic Green Tea' } },
        ], pageInfo: { hasNextPage: true, endCursor: 'c1' } } }
        : { productVariants: { nodes: [
          { id: 'gid://shopify/ProductVariant/2', sku: 'MUG-CER-01', barcode: null, title: 'White', price: '6.00', inventoryQuantity: 3, product: { title: 'Ceramic Tea Mug' } },
        ], pageInfo: { hasNextPage: false, endCursor: null } } };
    } else if (query.includes('customers(')) {
      data = variables.q.includes('dana@cornergrocer.com')
        ? { customers: { nodes: [{ id: 'gid://shopify/Customer/9', displayName: 'Dana Lee', email: 'dana@cornergrocer.com', companyContactProfiles: [
          { id: 'gid://shopify/CompanyContact/5', company: { id: 'gid://shopify/Company/4', name: 'Corner Grocer', locations: { nodes: [{ id: 'gid://shopify/CompanyLocation/3' }] } } },
        ] }] } }
        : { customers: { nodes: [] } };
    } else if (query.includes('draftOrderCreate')) {
      data = { draftOrderCreate: { draftOrder: { id: 'gid://shopify/DraftOrder/77', name: '#D77', legacyResourceId: '77' }, userErrors: [] } };
    }
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return requests;
}

test('shopify: catalog sync pages through variants and sends the encrypted token', async () => {
  const requests = fakeShopify();
  const s = makeStore({ platform: 'shopify', shop: 'acme.myshopify.com', token: 'shpat_secret' });
  assert.equal(await syncCatalog(getStore(s.id)), 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers['X-Shopify-Access-Token'], 'shpat_secret');
  assert.match(requests[0].url, /^https:\/\/acme\.myshopify\.com\/admin\/api\/[\d-]+\/graphql\.json$/);
  const items = (await srv.client(s.apiKey)('/api/catalog')).data;
  assert.deepEqual(items.map((i) => i.title).sort(), ['Ceramic Tea Mug — White', 'Organic Green Tea']);
});

test('shopify: approved PO becomes a B2B draft order for the buyer company', async () => {
  const requests = fakeShopify();
  const s = makeStore({ platform: 'shopify', shop: 'b2b.myshopify.com', token: 'shpat_secret' });
  await syncCatalog(getStore(s.id));
  const call = srv.client(s.apiKey);
  fakeAi(poFixture({ lines: [{ code: 'TEA-GRN-12', description: 'Green tea', quantity: 10, unit: '', unit_price: 4.5 }] }));
  const r = await call('/api/pos', { method: 'POST', body: Buffer.from('%PDF'), headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'po.pdf' } });
  const po = (await call(`/api/pos/${r.data.id}`)).data;
  assert.equal(po.status, 'ready');
  assert.equal(po.customer_external_id, 'gid://shopify/Customer/9');

  const ok = await call(`/api/pos/${po.id}/approve`, { method: 'POST' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.order.url, 'https://b2b.myshopify.com/admin/draft_orders/77');
  const draft = requests.find((q) => q.query.includes('draftOrderCreate')).variables.input;
  assert.deepEqual(draft.lineItems, [{ variantId: 'gid://shopify/ProductVariant/1', quantity: 10 }]);
  assert.equal(draft.poNumber, 'PO-1001');
  assert.deepEqual(draft.purchasingEntity, { purchasingCompany: { companyId: 'gid://shopify/Company/4', companyContactId: 'gid://shopify/CompanyContact/5', companyLocationId: 'gid://shopify/CompanyLocation/3' } });
  assert.equal(draft.shippingAddress.countryCode, 'US');
  assert.match(draft.note, /Requested ship date: 2026-12-01/);
});

test('shopify: platform errors mark the PO failed and can be retried', async () => {
  fakeShopify();
  const s = makeStore({ platform: 'shopify', shop: 'retry.myshopify.com', token: 'shpat_secret' });
  await syncCatalog(getStore(s.id));
  const call = srv.client(s.apiKey);
  fakeAi(poFixture({ po_number: 'ERR-1', lines: [{ code: 'MUG-CER-01', description: '', quantity: 1, unit: '', unit_price: null }] }));
  const r = await call('/api/pos', { method: 'POST', body: Buffer.from('%PDF'), headers: { 'Content-Type': 'application/pdf' } });
  shopify.fetch = async () => new Response('{}', { status: 500 });
  assert.equal((await call(`/api/pos/${r.data.id}/approve`, { method: 'POST' })).status, 502);
  assert.equal((await call(`/api/pos/${r.data.id}`)).data.status, 'failed');
  fakeShopify();
  assert.equal((await call(`/api/pos/${r.data.id}/approve`, { method: 'POST' })).status, 200);
});

test('shopify: OAuth query HMAC and webhook HMAC are verified', async () => {
  const q = { shop: 'acme.myshopify.com', code: 'abc', state: 'xyz', timestamp: '1700000000' };
  const msg = Object.keys(q).sort().map((k) => `${k}=${q[k]}`).join('&');
  const hmac = crypto.createHmac('sha256', 'test-secret').update(msg).digest('hex');
  assert.equal(verifyQueryHmac({ ...q, hmac }), true);
  assert.equal(verifyQueryHmac({ ...q, shop: 'evil.myshopify.com', hmac }), false);

  const anon = srv.client(null);
  const install = await fetch(`${srv.base}/shopify/install?shop=acme.myshopify.com`, { redirect: 'manual' });
  assert.equal(install.status, 302);
  assert.match(install.headers.get('location'), /^https:\/\/acme\.myshopify\.com\/admin\/oauth\/authorize\?client_id=test-key/);
  assert.equal((await anon('/shopify/install?shop=evil.com')).status, 400);
  assert.equal((await anon('/shopify/callback?shop=acme.myshopify.com&code=x&state=y&hmac=bad')).status, 400);

  const s = makeStore({ platform: 'shopify', shop: 'gone.myshopify.com', token: 't' });
  const body = Buffer.from(JSON.stringify({ shop_domain: 'gone.myshopify.com' }));
  const bad = await anon('/shopify/webhooks', { method: 'POST', body, headers: { 'X-Shopify-Hmac-Sha256': 'nope', 'X-Shopify-Topic': 'shop/redact', 'X-Shopify-Shop-Domain': 'gone.myshopify.com' } });
  assert.equal(bad.status, 401);
  const sig = crypto.createHmac('sha256', 'test-secret').update(body).digest('base64');
  const good = await anon('/shopify/webhooks', { method: 'POST', body, headers: { 'X-Shopify-Hmac-Sha256': sig, 'X-Shopify-Topic': 'shop/redact', 'X-Shopify-Shop-Domain': 'gone.myshopify.com' } });
  assert.equal(good.status, 200);
  assert.equal(getStore(s.id), undefined, 'shop/redact deletes the store and its data');
});

test('a new platform only needs a connector', async () => {
  const created = [];
  registerConnector({
    id: 'woocommerce', label: 'WooCommerce (test double)',
    fetchCatalog: async () => [{ external_id: 'wc-1', sku: 'WC-SKU', title: 'Woo Item', price: 2 }],
    findCustomer: async () => null,
    createOrder: async (_store, order) => { created.push(order); return { external_id: 'wc-order-1', name: 'WC#1' }; },
  });
  assert.throws(() => registerConnector({ id: 'broken' }), /missing fetchCatalog/);
  const s = makeStore({ platform: 'woocommerce' });
  await syncCatalog(getStore(s.id));
  const call = srv.client(s.apiKey);
  const r = await call('/api/pos', { method: 'POST', body: Buffer.from('sku,qty\nWC-SKU,3\n'), headers: { 'Content-Type': 'text/csv', 'X-Filename': 'po.csv' } });
  assert.equal((await call(`/api/pos/${r.data.id}/approve`, { method: 'POST' })).data.order.name, 'WC#1');
  assert.deepEqual(created[0].lines.map((l) => [l.sku, l.quantity]), [['WC-SKU', 3]]);
  assert.equal(getConnector('woocommerce').label, 'WooCommerce (test double)');
});

// ---------------- embedded app, billing, B2B prices ----------------
import { signSessionToken, verifySessionToken } from '../src/core/session-token.js';
import { PLANS } from '../src/plans.js';
import { get as dbGet } from '../src/db.js';

test('shopify: session tokens authenticate embedded requests', async () => {
  fakeShopify();
  makeStore({ platform: 'shopify', shop: 'embed.myshopify.com', token: 't' });
  const good = signSessionToken('embed.myshopify.com');
  assert.equal(verifySessionToken(good), 'embed.myshopify.com');
  assert.equal(verifySessionToken(signSessionToken('embed.myshopify.com', { exp: Math.floor(Date.now() / 1000) - 120 })), null, 'expired');
  assert.equal(verifySessionToken(signSessionToken('embed.myshopify.com', { aud: 'other-app' })), null, 'wrong audience');
  assert.equal(verifySessionToken(`${good.slice(0, -2)}xx`), null, 'bad signature');
  const me = await srv.client(null)('/api/me', { headers: { Authorization: `Bearer ${good}` } });
  assert.equal(me.status, 200);
  assert.equal(me.data.shop_domain, 'embed.myshopify.com');
  const stranger = await srv.client(null)('/api/me', { headers: { Authorization: `Bearer ${signSessionToken('nobody.myshopify.com')}` } });
  assert.equal(stranger.status, 401);
});

test('shopify: embedded page loads App Bridge; unknown shops are sent to install', async () => {
  const page = await fetch(`${srv.base}/?shop=embed.myshopify.com&host=abc`);
  const html = await page.text();
  assert.match(html, /<meta name="shopify-api-key" content="test-key">/);
  assert.match(html, /cdn\.shopify\.com\/shopifycloud\/app-bridge\.js/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors https:\/\/embed\.myshopify\.com https:\/\/admin\.shopify\.com/);
  const install = await (await fetch(`${srv.base}/?shop=newbie.myshopify.com&host=abc`)).text();
  assert.match(install, /\/shopify\/install\?shop=newbie\.myshopify\.com/);
  const plain = await fetch(`${srv.base}/`);
  assert.doesNotMatch(await plain.text(), /app-bridge/);
  assert.match(plain.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('shopify: billing subscribe → approve → plan active; cancellation webhook downgrades', async () => {
  const requests = fakeShopify();
  const base = shopify.fetch;
  shopify.fetch = async (url, init) => {
    const { query } = JSON.parse(init.body);
    if (query.includes('appSubscriptionCreate')) {
      requests.push({ query, variables: JSON.parse(init.body).variables });
      return new Response(JSON.stringify({ data: { appSubscriptionCreate: { confirmationUrl: 'https://billing.shopify.test/confirm', appSubscription: { id: 'gid://shopify/AppSubscription/1', status: 'PENDING' }, userErrors: [] } } }));
    }
    if (query.includes('activeSubscriptions')) {
      return new Response(JSON.stringify({ data: { currentAppInstallation: { activeSubscriptions: [{ id: 'gid://shopify/AppSubscription/1', name: 'Growth plan', status: 'ACTIVE' }] } } }));
    }
    return base(url, init);
  };
  const s = makeStore({ platform: 'shopify', shop: 'billing.myshopify.com', token: 't', plan: 'free' });
  const call = srv.client(s.apiKey);
  const sub = await call('/api/billing/subscribe', { method: 'POST', body: { plan: 'growth' } });
  assert.equal(sub.data.confirmation_url, 'https://billing.shopify.test/confirm');
  const vars = requests.find((r) => r.query?.includes('appSubscriptionCreate')).variables;
  assert.equal(vars.lineItems[0].plan.appRecurringPricingDetails.price.amount, PLANS.growth.price);
  assert.equal(vars.test, true);
  const returnUrl = new URL(vars.returnUrl);

  const tampered = await fetch(`${srv.base}/shopify/billing/return?state=${encodeURIComponent(`${s.id}:pro.forged`)}`, { redirect: 'manual' });
  assert.equal(tampered.status, 400);
  const back = await fetch(`${srv.base}${returnUrl.pathname}${returnUrl.search}`, { redirect: 'manual' });
  assert.equal(back.status, 302);
  assert.equal(dbGet('SELECT plan FROM stores WHERE id = ?', s.id).plan, 'growth');

  const body = Buffer.from(JSON.stringify({ app_subscription: { admin_graphql_api_id: 'gid://shopify/AppSubscription/1', status: 'CANCELLED' } }));
  const sig = crypto.createHmac('sha256', 'test-secret').update(body).digest('base64');
  await srv.client(null)('/shopify/webhooks', { method: 'POST', body, headers: { 'X-Shopify-Hmac-Sha256': sig, 'X-Shopify-Topic': 'app_subscriptions/update', 'X-Shopify-Shop-Domain': 'billing.myshopify.com' } });
  assert.equal(dbGet('SELECT plan FROM stores WHERE id = ?', s.id).plan, 'free');
});

test('shopify: B2B price list of the buyer company is used for price checks and the order', async () => {
  const requests = fakeShopify();
  const base = shopify.fetch;
  shopify.fetch = async (url, init) => {
    const { query } = JSON.parse(init.body);
    if (query.includes('companyLocation')) {
      requests.push({ query });
      return new Response(JSON.stringify({ data: { companyLocation: { catalogs: { nodes: [{ status: 'ACTIVE', priceList: { id: 'pl', prices: {
        nodes: [{ variant: { id: 'gid://shopify/ProductVariant/1' }, price: { amount: '3.60' } }], pageInfo: { hasNextPage: false, endCursor: null },
      } } }] } } } }));
    }
    return base(url, init);
  };
  const s = makeStore({ platform: 'shopify', shop: 'pricing.myshopify.com', token: 't' });
  await syncCatalog(getStore(s.id));
  const call = srv.client(s.apiKey);
  // Buyer writes their negotiated price (3.60): no mismatch, although list price is 4.50.
  fakeAi(poFixture({ po_number: 'B2B-1', lines: [{ code: 'TEA-GRN-12', description: '', quantity: 10, unit: '', unit_price: 3.6 }] }));
  const r = await call('/api/pos', { method: 'POST', body: Buffer.from('%PDF'), headers: { 'Content-Type': 'application/pdf' } });
  const po = (await call(`/api/pos/${r.data.id}`)).data;
  assert.deepEqual(po.lines[0].flags, []);
  assert.equal(po.lines[0].expected_price, 3.6);
  assert.equal(po.status, 'ready');
  // A buyer writing the list price instead gets flagged.
  fakeAi(poFixture({ po_number: 'B2B-2', lines: [{ code: 'TEA-GRN-12', description: '', quantity: 10, unit: '', unit_price: 4.5 }] }));
  const r2 = await call('/api/pos', { method: 'POST', body: Buffer.from('%PDF'), headers: { 'Content-Type': 'application/pdf' } });
  assert.ok((await call(`/api/pos/${r2.data.id}`)).data.lines[0].flags.includes('price_mismatch'));
});
