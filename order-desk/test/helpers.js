// Must be imported before any src/ module: config is read at import time.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.SHOPIFY_API_KEY = 'test-key';
process.env.SHOPIFY_API_SECRET = 'test-secret';
process.env.APP_URL = 'http://localhost:3100';

const { run } = await import('../src/db.js');
const { sha256, randomToken, encrypt } = await import('../src/crypto.js');
const { importCatalogRows } = await import('../src/connectors/csv.js');
const { createApp } = await import('../src/server.js');
const { setAiClient } = await import('../src/core/ai.js');

export const CATALOG = [
  { sku: 'TEA-GRN-12', barcode: '0850001112223', title: 'Organic Green Tea', variant_title: '12 x 20 bags', price: 4.5, inventory: 500, case_pack: 12 },
  { sku: 'TEA-BLK-12', barcode: '0850001112230', title: 'English Breakfast Black Tea', variant_title: '12 x 20 bags', price: 4.25, inventory: 40, case_pack: 12 },
  { sku: 'HON-RAW-500', barcode: '0850001112247', title: 'Raw Wildflower Honey', variant_title: '500 g jar', price: 7.8, inventory: 120, case_pack: 6 },
  { sku: 'HON-RAW-250', barcode: '0850001112254', title: 'Raw Wildflower Honey', variant_title: '250 g jar', price: 4.9, inventory: 200, case_pack: 12 },
  { sku: 'MUG-CER-01', barcode: '', title: 'Ceramic Tea Mug', variant_title: 'White', price: 6, inventory: 30, case_pack: 1 },
];

export function makeStore({ platform = 'csv', shop = null, token = null, autoCreate = 0 } = {}) {
  const apiKey = `od_${randomToken(8)}`;
  const inbound = randomToken(8);
  const { lastInsertRowid } = run('INSERT INTO stores (name, platform, shop_domain, api_key_hash, inbound_token, auto_create) VALUES (?,?,?,?,?,?)',
    'Test Store', platform, shop, sha256(apiKey), inbound, autoCreate);
  const id = Number(lastInsertRowid);
  if (token) run('UPDATE stores SET access_token_enc = ? WHERE id = ?', encrypt(token, `store:${id}:token`), id);
  if (platform === 'csv') importCatalogRows(id, CATALOG);
  return { id, apiKey, inbound };
}

/** Fake Claude client: returns the given PO object as structured output and records the request. */
export function fakeAi(po) {
  const calls = [];
  setAiClient({
    messages: {
      create: async (params) => {
        calls.push(params);
        const out = typeof po === 'function' ? po(params) : po;
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
  });
  return calls;
}

export function poFixture(overrides = {}) {
  return {
    is_purchase_order: true, po_number: 'PO-1001', po_date: '2026-11-20', requested_ship_date: '2026-12-01', currency: 'USD',
    buyer: { company: 'Corner Grocer', name: 'Dana Lee', email: 'dana@cornergrocer.com', phone: '' },
    ship_to: { company: 'Corner Grocer', name: 'Receiving', address1: '12 Main St', address2: '', city: 'Portland', province_code: 'OR', zip: '97201', country_code: 'US', phone: '' },
    notes: '',
    lines: [],
    ...overrides,
  };
}

/** Start the app on a random port and return a small client bound to a store's API key. */
export async function startServer() {
  const app = createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = (apiKey) => async (path, { method = 'GET', body, headers = {} } = {}) => {
    const h = { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...headers };
    let payload = body;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(base + path, { method, headers: h, body: payload });
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, data, headers: res.headers };
  };
  return { base, client, close: () => new Promise((r) => server.close(r)) };
}
