// WooCommerce connector (REST API v3, consumer key/secret over HTTPS).
// Orders are created with status "pending" (awaiting payment), which is WooCommerce's closest thing to a draft.
import { decrypt } from '../crypto.js';
import { http, readJson } from './http.js';

const PER_PAGE = 100;

function creds(store) {
  const c = JSON.parse(decrypt(store.access_token_enc, `store:${store.id}:token`) || '{}');
  if (!store.site_url || !c.key || !c.secret) throw Object.assign(new Error('Connect your WooCommerce store first'), { status: 400 });
  return c;
}

async function call(store, path, { method = 'GET', body } = {}) {
  const { key, secret } = creds(store);
  const res = await http.safeFetch(`${store.site_url.replace(/\/$/, '')}/wp-json/wc/v3/${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return readJson(res, 'WooCommerce');
}

async function pages(store, path) {
  const out = [];
  for (let page = 1; page <= 200; page += 1) {
    const sep = path.includes('?') ? '&' : '?';
    const rows = await call(store, `${path}${sep}per_page=${PER_PAGE}&page=${page}`);
    out.push(...rows);
    if (rows.length < PER_PAGE) break;
  }
  return out;
}

const stock = (p) => (p.manage_stock && Number.isInteger(p.stock_quantity) ? p.stock_quantity : null);
const price = (p) => (p.price === '' || p.price == null ? null : Number(p.price));

export const woocommerce = {
  id: 'woocommerce',
  label: 'WooCommerce',

  /** Called when the merchant saves credentials. */
  async test(store) { await call(store, 'products?per_page=1'); },

  async fetchCatalog(store) {
    const items = [];
    for (const p of await pages(store, 'products?status=publish')) {
      if (p.type === 'variable') {
        for (const v of await pages(store, `products/${p.id}/variations`)) {
          items.push({
            external_id: `${p.id}:${v.id}`, sku: v.sku || null, barcode: v.global_unique_id || null, title: p.name,
            variant_title: (v.attributes || []).map((a) => a.option).filter(Boolean).join(' / ') || null, price: price(v), inventory: stock(v),
          });
        }
      } else if (['simple', 'external'].includes(p.type) || !p.type) {
        items.push({ external_id: String(p.id), sku: p.sku || null, barcode: p.global_unique_id || null, title: p.name, variant_title: null, price: price(p), inventory: stock(p) });
      }
    }
    return items;
  },

  async findCustomer(store, { email }) {
    if (!email) return null;
    const rows = await call(store, `customers?email=${encodeURIComponent(email)}`);
    const c = rows?.[0];
    if (!c) return null;
    return { external_id: String(c.id), name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email, company: c.billing?.company || null, ref: { customer_id: c.id } };
  },

  async createOrder(store, order) {
    const a = order.ship_to || {};
    const body = {
      status: 'pending',
      customer_id: order.customer?.ref?.customer_id || 0,
      billing: { email: order.email || undefined, company: a.company || undefined },
      shipping: {
        company: a.company || '', first_name: a.name || '', address_1: a.address1 || '', address_2: a.address2 || '',
        city: a.city || '', state: a.province_code || '', postcode: a.zip || '', country: a.country_code || '',
      },
      line_items: order.lines.map((l) => {
        const [productId, variationId] = String(l.external_id).split(':');
        return { product_id: Number(productId), ...(variationId ? { variation_id: Number(variationId) } : {}), quantity: l.quantity };
      }),
      customer_note: order.note || '',
      meta_data: order.po_number ? [{ key: '_po_number', value: order.po_number }] : [],
    };
    const o = await call(store, 'orders', { method: 'POST', body });
    return {
      external_id: String(o.id),
      name: `#${o.number || o.id}`,
      url: `${store.site_url.replace(/\/$/, '')}/wp-admin/admin.php?page=wc-orders&action=edit&id=${o.id}`,
    };
  },
};
