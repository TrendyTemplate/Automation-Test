// Create a store without the Shopify OAuth flow and print its API key + inbound email address.
//
//   npm run create-store -- --name "Acme Wholesale" --platform csv
//   npm run create-store -- --name "Acme" --platform shopify --shop acme.myshopify.com --token shpat_xxx
//     (token from a Shopify custom app with read_products, read_inventory, read_customers, write_draft_orders)
import { parseArgs } from 'node:util';
import { run } from '../src/db.js';
import { encrypt, randomToken, sha256 } from '../src/crypto.js';
import { config } from '../src/config.js';
import { getConnector } from '../src/connectors/index.js';

const { values } = parseArgs({
  options: {
    name: { type: 'string' }, platform: { type: 'string', default: 'csv' }, shop: { type: 'string' },
    token: { type: 'string' }, currency: { type: 'string', default: 'USD' },
  },
});
getConnector(values.platform); // throws for unknown platforms
if (!values.name) throw new Error('--name is required');
if (values.platform === 'shopify' && !(values.shop && values.token)) throw new Error('--shop and --token are required for shopify');

const apiKey = `od_${randomToken(24)}`;
const inboundToken = randomToken(12);
const { lastInsertRowid: id } = run(
  'INSERT INTO stores (name, platform, shop_domain, api_key_hash, inbound_token, currency) VALUES (?,?,?,?,?,?)',
  values.name, values.platform, values.shop?.toLowerCase() || null, sha256(apiKey), inboundToken, values.currency.toUpperCase(),
);
if (values.token) run('UPDATE stores SET access_token_enc = ? WHERE id = ?', encrypt(values.token, `store:${id}:token`), id);

console.log(`Store #${id} created.
API key (shown once, keep it secret): ${apiKey}
Inbound email webhook:               ${config.appUrl}/inbound/${inboundToken}`);
