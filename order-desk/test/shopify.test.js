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
