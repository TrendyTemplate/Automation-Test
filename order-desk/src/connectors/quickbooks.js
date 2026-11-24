// QuickBooks Online connector. For wholesalers without an online store: approved POs become Estimates
// (QuickBooks' draft sales document), which the merchant converts to an invoice when shipping.
import { config } from '../config.js';
import { accessToken } from '../core/oauth2.js';
import { http, readJson } from './http.js';

const MINOR = 'minorversion=75';
const base = () => (config.quickbooks.sandbox ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com');
const appBase = () => (config.quickbooks.sandbox ? 'https://app.sandbox.qbo.intuit.com' : 'https://app.qbo.intuit.com');
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function call(store, path, { method = 'GET', body } = {}) {
  const { token, data } = await accessToken(store, 'quickbooks');
  const sep = path.includes('?') ? '&' : '?';
  const res = await http.fetch(`${base()}/v3/company/${data.realm_id}/${path}${sep}${MINOR}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await readJson(res, 'QuickBooks');
  if (json?.Fault) throw new Error(`QuickBooks: ${json.Fault.Error?.map((e) => e.Detail || e.Message).join('; ')}`);
  return json;
}

const query = (store, sql) => call(store, `query?query=${encodeURIComponent(sql)}`).then((r) => r.QueryResponse || {});

async function findOrCreateCustomer(store, { email, company, name }) {
  if (email) {
    const r = await query(store, `select * from Customer where PrimaryEmailAddr = '${q(email)}'`).catch(() => ({}));
    if (r.Customer?.[0]) return r.Customer[0];
  }
  const display = (company || name || email || 'Wholesale customer').slice(0, 100);
  const byName = await query(store, `select * from Customer where DisplayName = '${q(display)}'`);
  if (byName.Customer?.[0]) return byName.Customer[0];
  const created = await call(store, 'customer', {
    method: 'POST',
    body: { DisplayName: display, CompanyName: company || undefined, PrimaryEmailAddr: email ? { Address: email } : undefined },
  });
  return created.Customer;
}

export const quickbooks = {
  id: 'quickbooks',
  label: 'QuickBooks Online',

  async fetchCatalog(store) {
    const items = [];
    for (let start = 1; start < 100_000; start += 1000) {
      const r = await query(store, `select * from Item where Active = true STARTPOSITION ${start} MAXRESULTS 1000`);
      const rows = (r.Item || []).filter((i) => ['Inventory', 'NonInventory', 'Service'].includes(i.Type));
      for (const i of rows) {
        items.push({
          external_id: String(i.Id), sku: i.Sku || null, barcode: null, title: i.Name, variant_title: null,
          price: i.UnitPrice == null ? null : Number(i.UnitPrice), inventory: i.TrackQtyOnHand ? Math.trunc(Number(i.QtyOnHand) || 0) : null,
        });
      }
      if ((r.Item || []).length < 1000) break;
    }
    return items;
  },

  async findCustomer(store, { email }) {
    if (!email) return null;
    const r = await query(store, `select * from Customer where PrimaryEmailAddr = '${q(email)}'`).catch(() => ({}));
    const c = r.Customer?.[0];
    return c ? { external_id: String(c.Id), name: c.DisplayName, company: c.CompanyName || null, ref: { id: c.Id } } : null;
  },

  async createOrder(store, order) {
    const a = order.ship_to || {};
    const customer = order.customer?.ref?.id
      ? { Id: order.customer.ref.id }
      : await findOrCreateCustomer(store, { email: order.email, company: a.company, name: a.name });
    const body = {
      CustomerRef: { value: String(customer.Id) },
      BillEmail: order.email ? { Address: order.email } : undefined,
      PrivateNote: (order.note || '').slice(0, 4000),
      CustomerMemo: order.po_number ? { value: `Your PO ${order.po_number}` } : undefined,
      ShipAddr: a.address1 ? {
        Line1: a.company || a.name || undefined, Line2: a.address1, Line3: a.address2 || undefined, City: a.city || undefined,
        CountrySubDivisionCode: a.province_code || undefined, PostalCode: a.zip || undefined, Country: a.country_code || undefined,
      } : undefined,
      Line: order.lines.map((l) => ({
        DetailType: 'SalesItemLineDetail',
        Amount: Math.round((l.unit_price || 0) * l.quantity * 100) / 100,
        Description: l.title,
        SalesItemLineDetail: { ItemRef: { value: String(l.external_id) }, Qty: l.quantity, UnitPrice: l.unit_price || 0 },
      })),
    };
    const r = await call(store, 'estimate', { method: 'POST', body });
    const e = r.Estimate;
    return { external_id: String(e.Id), name: `Estimate ${e.DocNumber || e.Id}`, url: `${appBase()}/app/estimate?txnId=${e.Id}` };
  },
};
