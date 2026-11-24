# AI Order Desk

Turns wholesale purchase orders that arrive by email — PDF, Excel, CSV, photos or plain text — into draft orders, with every line matched to the right SKU. The merchant reviews and approves with one click.

Works with **Shopify** (embedded app, Shopify Billing, B2B price lists), **WooCommerce**, **QuickBooks Online**, **Xero**, or no platform at all (CSV catalog + CSV export). The core is platform-neutral: each platform is **one connector file** (see `src/connectors/index.js`).

> 🇧🇩 ব্যবসায়িক প্ল্যান ও যাচাই কিট: [`../docs/AI_ORDER_DESK_PLAN_BN.md`](../docs/AI_ORDER_DESK_PLAN_BN.md)

![Review screen](docs/review-screen.png)

## How it works

```
email / upload ─► extract ─► find buyer ─► match lines ─► review ─► approve ─► connector.createOrder()
                  (table      (connector)   memory → SKU →  (UI)                (Shopify draft order,
                   or AI)                   barcode → fuzzy                      CSV export, …)
```

| Step | File | Notes |
|---|---|---|
| Inbound email | `src/core/pipeline.js` `ingestEmail` | `POST /inbound/<token>` with the raw message (forwarding rule, Postmark/Mailgun/SES inbound). Skips logo/signature images. |
| Extraction | `src/core/extract.js`, `src/core/ai.js` | CSV/XLSX with recognizable headers are parsed exactly with no AI cost. PDFs, images, email text and odd sheets go to Claude with a strict JSON schema. AI output is validated and clamped. |
| Matching | `src/core/match.js` | Buyer memory (per company domain) → exact SKU → barcode → fuzzy text. Converts cases/dozens to units using `case_pack`, flags price differences, low stock, ambiguous names. Fuzzy matches never auto-approve. |
| Learning | `remember()` | Every correction and every approved order teaches "buyer X's code Y = item Z". The second PO from a buyer usually matches fully. |
| Safety | `pipeline.js` | Duplicate PO numbers, prompt-injection text, empty catalog and unknown buyers hold the PO for review. Approve is idempotent (no double orders). |
| Connectors | `src/connectors/` | `shopify.js` (Admin GraphQL: variants, B2B company/location, price lists, `draftOrderCreate`, billing), `woocommerce.js` (REST v3, pending orders), `quickbooks.js` (Estimates), `xero.js` (DRAFT invoices), `csv.js` (no platform). |
| Mailbox | `src/core/mailbox.js` | IMAP polling as an alternative to forwarding. Starts at the newest message (never imports history), SSRF-safe connection pinning, encrypted password. |
| Background jobs | `src/core/jobs.js`, `handlers.js` | SQLite queue with retries and backoff: inbound email, catalog sync, mailbox polls, alerts, confirmations. Inbound email answers `202` immediately. |
| Notifications | `src/core/notify.js` | "PO needs review" to Slack (incoming webhook) and email; order confirmation to the buyer, threaded under their original email. |
| Plans | `src/plans.js` | Free 5 / Starter 50 / Growth 200 / Pro 750 orders a month. Over the limit, POs are still received; only order creation waits. |

Statuses: `needs_review` → `ready` → `created`, or `rejected` / `failed` (retryable).

## Run locally

```bash
cd order-desk
npm install
npm test                       # 38 tests, no network needed (AI and platforms are faked; IMAP uses a local test server)

# a store without Shopify (catalog via CSV)
npm run create-store -- --name "Demo Tea Co" --platform csv
# or a Shopify store via a custom-app admin token
npm run create-store -- --name "Acme" --platform shopify --shop acme.myshopify.com --token shpat_...

ANTHROPIC_API_KEY=sk-ant-... npm start   # http://localhost:3100, sign in with the printed API key
```

## Environment

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Reads PDFs, images and free-text orders (spreadsheets work without it) |
| `AI_MODEL`, `AI_EFFORT` | Default `claude-opus-5-5`, `low` |
| `ENCRYPTION_KEY` | 64 hex chars; encrypts platform tokens (required in production) |
| `SESSION_SECRET` | Signs session cookies (required in production) |
| `APP_URL`, `PORT`, `DB_PATH` | Public URL (used for OAuth redirect and inbound address), port, SQLite path |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | Public Shopify app credentials (OAuth install + webhooks) |
| `SHOPIFY_API_VERSION`, `SHOPIFY_SCOPES` | Default `2026-10`; `read_products,read_inventory,read_customers,write_draft_orders,read_companies` |
| `AUTO_MATCH_CONFIDENCE` | Lines at or above this need no review (default 0.9) |
| `SHOPIFY_BILLING_TEST` | `true` (default) creates test charges; set `false` in production |
| `SMTP_URL`, `MAIL_FROM` | Outgoing email for alerts and buyer confirmations, e.g. `smtps://user:pass@smtp.postmarkapp.com:465` |
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENV` | Intuit app; redirect URI `APP_URL/connect/quickbooks/callback`; `QBO_ENV=production` for live companies |
| `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | Xero app; redirect URI `APP_URL/connect/xero/callback` |
| `MAILBOX_POLL_SEC` | How often IMAP mailboxes are checked (default 60) |
| `ALLOW_PRIVATE_HOSTS` | Testing only: allow IMAP/WooCommerce hosts on private networks. Never on a public server |

## Shopify app setup

1. Create an app in the Shopify Partner dashboard. App URL: `APP_URL/`, redirect URL: `APP_URL/shopify/callback`, embedded: yes.
2. Webhooks → `APP_URL/shopify/webhooks`: compliance (`customers/data_request`, `customers/redact`, `shop/redact`), `app/uninstalled`, `app_subscriptions/update`.
3. Install from `APP_URL/shopify/install?shop=<shop>.myshopify.com`. The catalog syncs automatically. Inside Shopify admin the page loads App Bridge and authenticates every request with a session token (no third-party cookies needed).
4. Plans are charged with the Shopify Billing API (`appSubscriptionCreate`). The return URL is verified against `currentAppInstallation.activeSubscriptions`, never trusted on its own.

## Other platforms

Merchants sign up on the start page (WooCommerce, QuickBooks, Xero or CSV), save their API key, then connect:
- **WooCommerce**: Settings → paste site URL + REST API key/secret (WooCommerce → Settings → Advanced → REST API, Read/Write). Orders are created as *Pending payment*.
- **QuickBooks / Xero**: Settings → Connect (OAuth 2). Tokens are encrypted and refreshed automatically (rotating refresh tokens are saved). Orders become a QuickBooks **Estimate** or a Xero **DRAFT invoice**; unknown buyers are created as customers/contacts.

## Adding a platform

Implement `fetchCatalog`, `findCustomer` and `createOrder` (contract in `src/connectors/index.js`) and register it. The test `a new platform only needs a connector` in `test/shopify.test.js` shows a complete WooCommerce-style example in 10 lines.

## Verified vs. not yet verified

All connectors are tested against faked platform APIs that follow the public documentation; IMAP is tested against a real local IMAP server. **Not yet run against live accounts**: a real Shopify development store (install, billing approval, B2B price lists), a live WooCommerce site, a QuickBooks sandbox company and a Xero demo company. Do this before launch; the most likely surprises are field-level details (e.g. QuickBooks filtering customers by email, Xero item codes, WooCommerce HPOS admin URLs).

## Known limits

- Billing for non-Shopify stores is manual (set `stores.plan`); add Stripe when those customers arrive.
- Rate limiting and the job queue are per process; use Redis/a managed queue when running several servers.
- Shopify price lists: the first active catalog of the company location is used, up to 10,000 prices.
