import { makeStore, fakeAi, poFixture, startServer } from './helpers.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { http } from '../src/connectors/http.js';
import { getStore, syncCatalog } from '../src/core/pipeline.js';
import { saveOAuth, readOAuth } from '../src/core/oauth2.js';
import { encrypt } from '../src/crypto.js';
import { run } from '../src/db.js';
import { drainJobs } from '../src/core/jobs.js';

const srv = await startServer();
after(() => srv.close());

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** Route table fake: [[method, regex, handler(url, body)]] */
function fakeHttp(routes, which = 'fetch') {
  const calls = [];
  http[which] = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body && typeof opts.body === 'string' && opts.body.startsWith('{') ? JSON.parse(opts.body) : opts.body;
    calls.push({ method, url: String(url), headers: opts.headers || {}, body });
    for (const [m, re, fn] of routes) if (m === method && re.test(String(url))) return fn(String(url), body);
    return json({ message: `no route ${method} ${url}` }, 404);
  };
  return calls;
}

// ---------------- WooCommerce ----------------
test('woocommerce: connect, sync simple + variable products, create a pending order', async () => {
  const s = makeStore({ platform: 'woocommerce' });
  const call = srv.client(s.apiKey);
  const calls = fakeHttp([
    ['GET', /products\?per_page=1$/, () => json([])],
    ['GET', /products\?status=publish&per_page=100&page=1$/, () => json([
      { id: 10, type: 'simple', name: 'Ceramic Tea Mug', sku: 'MUG-CER-01', price: '6.00', manage_stock: true, stock_quantity: 30 },
      { id: 20, type: 'variable', name: 'Organic Green Tea', sku: '', price: '4.50' },
    ])],
    ['GET', /products\/20\/variations\?per_page=100&page=1$/, () => json([
      { id: 21, sku: 'TEA-GRN-12', price: '4.50', manage_stock: false, attributes: [{ option: '12 x 20 bags' }] },
    ])],
    ['GET', /customers\?email=dana%40cornergrocer\.com/, () => json([{ id: 7, first_name: 'Dana', last_name: 'Lee', billing: { company: 'Corner Grocer' } }])],
    ['POST', /\/orders$/, () => json({ id: 501, number: '501' }, 201)],
  ], 'safeFetch');

  assert.equal((await call('/api/connect/woocommerce', { method: 'POST', body: { site_url: 'http://shop.example', consumer_key: 'ck_x', consumer_secret: 'cs_y' } })).status, 400);
  const ok = await call('/api/connect/woocommerce', { method: 'POST', body: { site_url: 'https://shop.example.com/', consumer_key: `ck_${'a'.repeat(40)}`, consumer_secret: `cs_${'b'.repeat(40)}` } });
  assert.equal(ok.status, 200);
  assert.match(calls[0].headers.Authorization, /^Basic /);
  await drainJobs();
  const items = (await call('/api/catalog')).data;
  assert.deepEqual(items.map((i) => [i.external_id, i.sku]).sort(), [['10', 'MUG-CER-01'], ['20:21', 'TEA-GRN-12']]);

  fakeAi(poFixture({ lines: [{ code: 'TEA-GRN-12', description: '', quantity: 24, unit: '', unit_price: 4.5 }, { code: 'MUG-CER-01', description: '', quantity: 2, unit: '', unit_price: 6 }] }));
  const r = await call('/api/pos', { method: 'POST', body: Buffer.from('%PDF'), headers: { 'Content-Type': 'application/pdf' } });
  const po = (await call(`/api/pos/${r.data.id}`)).data;
  assert.equal(po.status, 'ready');
  const created = await call(`/api/pos/${po.id}/approve`, { method: 'POST' });
  assert.equal(created.data.order.name, '#501');
  assert.equal(created.data.order.url, 'https://shop.example.com/wp-admin/admin.php?page=wc-orders&action=edit&id=501');
  const order = calls.find((c) => c.method === 'POST').body;
  assert.equal(order.status, 'pending');
  assert.equal(order.customer_id, 7);
  assert.deepEqual(order.line_items, [{ product_id: 20, variation_id: 21, quantity: 24 }, { product_id: 10, quantity: 2 }]);
  assert.deepEqual(order.meta_data, [{ key: '_po_number', value: 'PO-1001' }]);
  assert.equal(order.shipping.country, 'US');
});

// ---------------- QuickBooks ----------------
test('quickbooks: OAuth connect, token refresh, items, estimate with new customer', async () => {
  const anon = srv.client(null);
  const signup = await anon('/signup', { method: 'POST', body: { store_name: 'QB Foods', platform: 'quickbooks' } });
  const cookie = signup.headers.get('set-cookie').split(';')[0];

  const start = await fetch(`${srv.base}/connect/quickbooks/start`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(start.status, 302);
  const auth = new URL(start.headers.get('location'));
  assert.equal(auth.origin + auth.pathname, 'https://appcenter.intuit.com/connect/oauth2');
  assert.equal(auth.searchParams.get('scope'), 'com.intuit.quickbooks.accounting');
  const state = auth.searchParams.get('state');
  const stateCookie = start.headers.get('set-cookie').split(';')[0];

  let tokenCalls = 0;
  const calls = fakeHttp([
    ['POST', /oauth\.platform\.intuit\.com/, (_u, body) => {
      tokenCalls += 1;
      const p = new URLSearchParams(body);
      return json({ access_token: `at-${tokenCalls}`, refresh_token: `rt-${tokenCalls}`, expires_in: p.get('grant_type') === 'refresh_token' ? 3600 : 1 });
    }],
    ['GET', /\/query\?query=select%20\*%20from%20Item/, () => json({ QueryResponse: { Item: [
      { Id: '5', Name: 'Organic Green Tea 12ct', Sku: 'TEA-GRN-12', UnitPrice: 4.5, Type: 'Inventory', TrackQtyOnHand: true, QtyOnHand: 80 },
      { Id: '6', Name: 'Shipping', Type: 'Category' },
    ] } })],
    ['GET', /\/query\?query=select%20\*%20from%20Customer/, () => json({ QueryResponse: {} })],
    ['POST', /\/customer\?minorversion/, () => json({ Customer: { Id: '42', DisplayName: 'Corner Grocer' } })],
    ['POST', /\/estimate\?minorversion/, () => json({ Estimate: { Id: '900', DocNumber: '1007' } })],
  ]);

  const bad = await fetch(`${srv.base}/connect/quickbooks/callback?code=c&state=wrong&realmId=123`, { headers: { cookie: `${cookie}; ${stateCookie}` } });
  assert.equal(bad.status, 400);
  const cb = await fetch(`${srv.base}/connect/quickbooks/callback?code=c&state=${state}&realmId=123`, { headers: { cookie: `${cookie}; ${stateCookie}` }, redirect: 'manual' });
  assert.equal(cb.status, 302);
  assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from('qbo-id:qbo-secret').toString('base64')}`);

  await drainJobs(); // catalog sync (token expires in 1s → refreshed before use)
  const call = srv.client(signup.data.api_key);
  const items = (await call('/api/catalog')).data;
  assert.deepEqual(items.map((i) => [i.sku, i.inventory]), [['TEA-GRN-12', 80]]);
  assert.ok(tokenCalls >= 2, 'refresh grant was used');
  const storeId = (await call('/api/me')).data.id;
  assert.equal(readOAuth(getStore(storeId)).refresh_token, `rt-${tokenCalls}`, 'rotated refresh token saved');
  assert.match(calls.find((c) => c.url.includes('/query?')).url, /^https:\/\/sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/123\//);

  fakeAi(poFixture({ lines: [{ code: 'TEA-GRN-12', description: '', quantity: 10, unit: '', unit_price: 4.5 }] }));
  const r = await call('/api/pos', { method: 'POST', body: Buffer.from('%PDF'), headers: { 'Content-Type': 'application/pdf' } });
  run("UPDATE stores SET plan = 'pro' WHERE id = ?", storeId);
  const created = await call(`/api/pos/${r.data.id}/approve`, { method: 'POST' });
  assert.equal(created.status, 200);
  assert.equal(created.data.order.name, 'Estimate 1007');
  const est = calls.find((c) => c.url.includes('/estimate')).body;
  assert.deepEqual(est.CustomerRef, { value: '42' });
  assert.equal(est.Line[0].Amount, 45);
  assert.deepEqual(est.Line[0].SalesItemLineDetail, { ItemRef: { value: '5' }, Qty: 10, UnitPrice: 4.5 });
  assert.equal(calls.find((c) => c.url.includes('/customer?')).body.DisplayName, 'Corner Grocer');
});

// ---------------- Xero ----------------
test('xero: items, contact lookup and DRAFT invoice', async () => {
  const s = makeStore({ platform: 'xero' });
  saveOAuth(s.id, { access_token: 'xat', refresh_token: 'xrt', expires_at: Date.now() + 3600_000, tenant_id: 'tenant-1' });
  const calls = fakeHttp([
    ['GET', /\/Items$/, () => json({ Items: [
      { ItemID: 'it-1', Code: 'TEA-GRN-12', Name: 'Organic Green Tea', SalesDetails: { UnitPrice: 4.5 }, IsSold: true, IsTrackedAsInventory: false },
      { ItemID: 'it-2', Code: 'PURCH-ONLY', Name: 'Packaging', IsSold: false },
    ] })],
    ['GET', /\/Contacts\?where=/, () => json({ Contacts: [{ ContactID: 'c-9', Name: 'Corner Grocer' }] })],
    ['PUT', /\/Invoices$/, () => json({ Invoices: [{ InvoiceID: 'inv-1', InvoiceNumber: 'INV-0042' }] })],
  ]);
  assert.equal(await syncCatalog(getStore(s.id)), 1);
  assert.equal(calls[0].headers['xero-tenant-id'], 'tenant-1');
  const call = srv.client(s.apiKey);
  fakeAi(poFixture({ lines: [{ code: 'TEA-GRN-12', description: '', quantity: 6, unit: '', unit_price: 4.5 }] }));
  const r = await call('/api/pos', { method: 'POST', body: Buffer.from('%PDF'), headers: { 'Content-Type': 'application/pdf' } });
  const po = (await call(`/api/pos/${r.data.id}`)).data;
  assert.equal(po.customer_external_id, 'c-9');
  const created = await call(`/api/pos/${po.id}/approve`, { method: 'POST' });
  assert.equal(created.data.order.name, 'Draft invoice INV-0042');
  const inv = calls.find((c) => c.method === 'PUT').body.Invoices[0];
  assert.equal(inv.Status, 'DRAFT');
  assert.equal(inv.Type, 'ACCREC');
  assert.equal(inv.Reference, 'PO-1001');
  assert.deepEqual(inv.Contact, { ContactID: 'c-9' });
  assert.deepEqual(inv.LineItems[0], { ItemCode: 'TEA-GRN-12', Description: 'Organic Green Tea', Quantity: 6, UnitAmount: 4.5 });
});

test('platform errors surface readable messages', async () => {
  const s = makeStore({ platform: 'xero' });
  saveOAuth(s.id, { access_token: 'xat', refresh_token: 'xrt', expires_at: Date.now() + 3600_000, tenant_id: 't' });
  fakeHttp([['GET', /\/Items$/, () => json({ Elements: [{ ValidationErrors: [{ Message: 'Organisation is not subscribed' }] }] }, 400)]]);
  await assert.rejects(syncCatalog(getStore(s.id)), /Xero error 400: Organisation is not subscribed/);
  const w = makeStore({ platform: 'woocommerce' });
  run('UPDATE stores SET site_url = ?, access_token_enc = ? WHERE id = ?', 'https://shop.example.com', encrypt(JSON.stringify({ key: 'ck', secret: 'cs' }), `store:${w.id}:token`), w.id);
  fakeHttp([['GET', /products/, () => json({ message: 'Consumer key is invalid.' }, 401)]], 'safeFetch');
  await assert.rejects(syncCatalog(getStore(w.id)), /WooCommerce error 401: Consumer key is invalid\./);
});
