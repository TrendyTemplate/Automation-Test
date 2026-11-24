// Xero connector. Approved POs become DRAFT sales invoices (ACCREC) that the merchant approves in Xero.
import { accessToken } from '../core/oauth2.js';
import { http, readJson } from './http.js';

const API = 'https://api.xero.com/api.xro/2.0';

async function call(store, path, { method = 'GET', body } = {}) {
  const { token, data } = await accessToken(store, 'xero');
  const res = await http.fetch(`${API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, 'xero-tenant-id': data.tenant_id, Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return readJson(res, 'Xero');
}

/** After OAuth: pick the organisation (tenant) the merchant just authorised. */
export async function xeroTenant(token) {
  const res = await http.fetch('https://api.xero.com/connections', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const rows = await readJson(res, 'Xero connections');
  const org = (rows || []).find((r) => r.tenantType === 'ORGANISATION') || rows?.[0];
  if (!org) throw new Error('No Xero organisation was authorised');
  return { tenant_id: org.tenantId, tenant_name: org.tenantName };
}

export const xero = {
  id: 'xero',
  label: 'Xero',

  async fetchCatalog(store) {
    const r = await call(store, 'Items');
    return (r.Items || []).filter((i) => i.IsSold !== false).map((i) => ({
      external_id: i.ItemID, sku: i.Code || null, barcode: null, title: i.Name || i.Code, variant_title: null,
      price: i.SalesDetails?.UnitPrice == null ? null : Number(i.SalesDetails.UnitPrice),
      inventory: i.IsTrackedAsInventory ? Math.trunc(Number(i.QuantityOnHand) || 0) : null,
    }));
  },

  async findCustomer(store, { email }) {
    if (!email) return null;
    const where = encodeURIComponent(`EmailAddress=="${String(email).replace(/"/g, '')}"`);
    const r = await call(store, `Contacts?where=${where}`);
    const c = r.Contacts?.[0];
    return c ? { external_id: c.ContactID, name: c.Name, company: c.Name, ref: { ContactID: c.ContactID } } : null;
  },

  async createOrder(store, order) {
    const a = order.ship_to || {};
    const contact = order.customer?.ref?.ContactID
      ? { ContactID: order.customer.ref.ContactID }
      : { Name: (a.company || a.name || order.email || 'Wholesale customer').slice(0, 255), EmailAddress: order.email || undefined };
    const body = {
      Invoices: [{
        Type: 'ACCREC',
        Status: 'DRAFT',
        Contact: contact,
        Reference: order.po_number || undefined,
        LineAmountTypes: 'Exclusive',
        LineItems: order.lines.map((l) => ({ ItemCode: l.sku || undefined, Description: l.title, Quantity: l.quantity, UnitAmount: l.unit_price ?? undefined })),
      }],
    };
    const r = await call(store, 'Invoices', { method: 'PUT', body });
    const inv = r.Invoices?.[0];
    if (!inv?.InvoiceID) throw new Error('Xero did not create the invoice');
    return { external_id: inv.InvoiceID, name: `Draft invoice ${inv.InvoiceNumber || ''}`.trim(), url: `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${inv.InvoiceID}` };
  },
};
