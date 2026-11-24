// Shopify connector (Admin GraphQL API). Orders are created as draft orders so the merchant keeps control.
import { config } from '../config.js';
import { decrypt } from '../crypto.js';

const VARIANTS_QUERY = `query Variants($after: String) {
  productVariants(first: 250, after: $after) {
    nodes { id sku barcode title price inventoryQuantity product { title } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const CUSTOMER_QUERY = `query Customer($q: String!) {
  customers(first: 1, query: $q) {
    nodes {
      id displayName email
      companyContactProfiles { id company { id name locations(first: 1) { nodes { id } } } }
    }
  }
}`;

const DRAFT_CREATE = `mutation Draft($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder { id name legacyResourceId }
    userErrors { field message }
  }
}`;

const PRICE_LIST_QUERY = `query Prices($id: ID!, $after: String) {
  companyLocation(id: $id) {
    catalogs(first: 5) { nodes { status priceList { id prices(first: 250, after: $after) {
      nodes { variant { id } price { amount } }
      pageInfo { hasNextPage endCursor }
    } } } }
  }
}`;

const SUBSCRIBE = `mutation Subscribe($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
  appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
    confirmationUrl
    appSubscription { id status }
    userErrors { field message }
  }
}`;

const ACTIVE_SUBSCRIPTIONS = `query { currentAppInstallation { activeSubscriptions { id name status } } }`;

const CANCEL = `mutation Cancel($id: ID!) { appSubscriptionCancel(id: $id) { appSubscription { id status } userErrors { field message } } }`;

export const shopify = {
  id: 'shopify',
  label: 'Shopify',
  // Overridable in tests.
  fetch: (...args) => globalThis.fetch(...args),

  async graphql(store, query, variables = {}) {
    const token = decrypt(store.access_token_enc, `store:${store.id}:token`);
    const res = await this.fetch(`https://${store.shop_domain}/admin/api/${config.shopify.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) throw Object.assign(new Error('Shopify rate limit, try again shortly'), { retryable: true });
    if (!res.ok) throw new Error(`Shopify API error ${res.status}`);
    const body = await res.json();
    if (body.errors?.length) throw new Error(`Shopify: ${body.errors.map((e) => e.message).join('; ')}`);
    return body.data;
  },

  async fetchCatalog(store) {
    const items = [];
    let after = null;
    for (let page = 0; page < 400; page += 1) { // 100k variants max
      const data = await this.graphql(store, VARIANTS_QUERY, { after });
      for (const v of data.productVariants.nodes) {
        items.push({
          external_id: v.id,
          sku: v.sku || null,
          barcode: v.barcode || null,
          title: v.product?.title || v.title,
          variant_title: v.title && v.title !== 'Default Title' ? v.title : null,
          price: v.price == null ? null : Number(v.price),
          inventory: Number.isInteger(v.inventoryQuantity) ? v.inventoryQuantity : null,
        });
      }
      if (!data.productVariants.pageInfo.hasNextPage) break;
      after = data.productVariants.pageInfo.endCursor;
    }
    return items;
  },

  async findCustomer(store, { email }) {
    if (!email) return null;
    const safe = String(email).replace(/["\\]/g, '');
    const data = await this.graphql(store, CUSTOMER_QUERY, { q: `email:"${safe}"` });
    const c = data.customers.nodes[0];
    if (!c) return null;
    const profile = c.companyContactProfiles?.[0];
    const location = profile?.company?.locations?.nodes?.[0];
    return {
      external_id: c.id,
      name: c.displayName,
      company: profile?.company?.name || null,
      ref: profile && location
        ? { purchasingCompany: { companyId: profile.company.id, companyContactId: profile.id, companyLocationId: location.id } }
        : { customerId: c.id },
    };
  },

  /** B2B: prices from the price lists of the buyer's company location (Shopify catalogs). Map variantId → price. */
  async getPrices(store, customer) {
    const locationId = customer?.ref?.purchasingCompany?.companyLocationId;
    const prices = new Map();
    if (!locationId) return prices;
    let after = null;
    for (let page = 0; page < 40; page += 1) {
      const data = await this.graphql(store, PRICE_LIST_QUERY, { id: locationId, after });
      const catalogs = (data.companyLocation?.catalogs?.nodes || []).filter((c) => c.status !== 'ARCHIVED' && c.priceList);
      if (!catalogs.length) break;
      // The first active catalog's price list wins (Shopify applies the lowest; good enough for a mismatch check).
      const list = catalogs[0].priceList.prices;
      for (const p of list.nodes) if (!prices.has(p.variant.id)) prices.set(p.variant.id, Number(p.price.amount));
      if (!list.pageInfo.hasNextPage) break;
      after = list.pageInfo.endCursor;
    }
    return prices;
  },

  /** Shopify Billing API: returns the URL where the merchant approves the charge. */
  async createSubscription(store, plan, { returnUrl, test }) {
    const data = await this.graphql(store, SUBSCRIBE, {
      name: `${plan.name} plan`,
      returnUrl,
      test,
      lineItems: [{ plan: { appRecurringPricingDetails: { price: { amount: plan.price, currencyCode: 'USD' }, interval: 'EVERY_30_DAYS' } } }],
    });
    const r = data.appSubscriptionCreate;
    if (r.userErrors?.length) throw new Error(`Shopify billing: ${r.userErrors.map((e) => e.message).join('; ')}`);
    return { confirmationUrl: r.confirmationUrl, id: r.appSubscription?.id };
  },

  async activeSubscriptions(store) {
    const data = await this.graphql(store, ACTIVE_SUBSCRIPTIONS);
    return data.currentAppInstallation?.activeSubscriptions || [];
  },

  async cancelSubscription(store, id) {
    const data = await this.graphql(store, CANCEL, { id });
    const errs = data.appSubscriptionCancel?.userErrors || [];
    if (errs.length) throw new Error(errs.map((e) => e.message).join('; '));
  },

  async createOrder(store, order) {
    const input = {
      lineItems: order.lines.map((l) => ({ variantId: l.external_id, quantity: l.quantity })),
      tags: ['order-desk', 'wholesale-po'],
      note: order.note || undefined,
      poNumber: order.po_number || undefined,
      email: order.customer ? undefined : order.email || undefined,
      purchasingEntity: order.customer?.ref || undefined,
      shippingAddress: shippingAddress(order.ship_to),
    };
    const data = await this.graphql(store, DRAFT_CREATE, { input });
    const { draftOrder, userErrors } = data.draftOrderCreate;
    if (userErrors?.length) throw new Error(`Shopify rejected the draft: ${userErrors.map((e) => e.message).join('; ')}`);
    return {
      external_id: draftOrder.id,
      name: draftOrder.name,
      url: `https://${store.shop_domain}/admin/draft_orders/${draftOrder.legacyResourceId}`,
    };
  },
};

function shippingAddress(a) {
  if (!a || !(a.address1 || a.city)) return undefined;
  const out = {
    company: a.company || undefined,
    firstName: a.name || undefined,
    address1: a.address1 || undefined,
    address2: a.address2 || undefined,
    city: a.city || undefined,
    zip: a.zip || undefined,
    phone: a.phone || undefined,
  };
  if (/^[A-Z]{2}$/i.test(a.country_code || '')) out.countryCode = a.country_code.toUpperCase();
  if (/^[A-Z0-9]{1,3}$/i.test(a.province_code || '')) out.provinceCode = a.province_code.toUpperCase();
  return out;
}
