# Delaywise security

Every protection below is in the code and covered by tests unless marked otherwise.

## Data we hold
| Data | Stored? | Protection |
|---|---|---|
| Shopify access and refresh tokens | Yes | AES-256-GCM at rest, bound to the shop (`EncryptedSessionStorage`), expiring offline tokens |
| Merchant's Klaviyo key | Yes, optional | AES-256-GCM, bound to the shop; never returned to the browser (masked) |
| Customer name, email, phone, street address | **No** | Email is read from Shopify only at send time; only the destination country code is stored |
| Order/fulfillment IDs, tracking status, email text | Yes | Deleted after 90/180 days, on `customers/redact` and on `shop/redact` |
| Activity log | Yes | No setting values or personal data; deleted after 180 days and on `shop/redact` |

## Request handling
- **Embedded admin:** every `/app` route calls `authenticate.admin` (session tokens, App Bridge). Every database query is scoped to the authenticated shop; `sendMessage` re-checks the shop.
- **Webhooks:** HMAC verified by `authenticate.webhook` (bad signature → 401). Each delivery is processed once (`ProcessedWebhook`).
- **Customer-account endpoint `/api/order-status`:** customer session token required, and the order's customer must match the token's customer. Rate-limited per shop and customer.
- **Scheduler endpoint `/jobs/scan`:** 24+ character secret compared in constant time; repeated failures from one IP get 429.
- **Input validation:** every action validates its input (zod for messages, clamping and an allow-list for settings, an ID pattern for orders).
- **Headers:** `nosniff`, a strict referrer policy, a permissions policy, HSTS in production, and `frame-ancestors 'none'` outside the embedded admin (where Shopify's own frame-ancestors apply).
- **Abuse limits:** test emails only go to the store's saved address, with daily limits on previews and tests; bulk sends are capped at 25 per request.

## AI safety
- Order data is passed to the model as JSON *data*, with instructions to ignore any instructions inside it.
- Every AI email is checked before use: no links except the real tracking link, no HTML, bounded length, and it must contain the tracking link and discount code. Otherwise the fixed template is used.

## Operations
- **Production start-up check:** the server refuses to start without the Shopify credentials, an https app URL, a 32-byte `APP_ENCRYPTION_KEY`, a strong `JOB_SECRET`, or the email settings.
- **Activity log:** settings changes (field names only), sends, skips, plan changes, Klaviyo connections and uninstalls, with the acting staff member.
- **Dependencies:** `npm audit --omit=dev` reports 2 moderate findings, both in `minimatch` used by `@react-router/fs-routes`. That code runs only at build time over the app's own route file names (no untrusted input), and no fixed version is compatible. Accepted risk; re-check on every release.

## Before every release
```bash
npm test && npm run typecheck && npm run typecheck:extensions && npm run lint && npm run build
npm audit --omit=dev
shopify app security check   # Shopify CLI; runs locally
```

## Merchant/partner account hygiene (manual)
Turn on two-step login for the Partner account, hosting, GitHub and email; keep the emergency developer contact current; rotate `JOB_SECRET` if it leaks. Don't rotate `APP_ENCRYPTION_KEY` without re-encrypting: merchants would have to reconnect Klaviyo, and the app would ask Shopify to re-authorize.
