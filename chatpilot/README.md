# ChatPilot AI

AI sales assistant SaaS for **Facebook Messenger, Instagram Direct and WhatsApp Business**. Shops connect their Page / Instagram account / WhatsApp number, add their products, and the assistant (Anthropic Claude) answers customers 24/7 in their own language, recommends products from the catalog, collects name, phone and address, and records confirmed orders — prices always come from the catalog, never from the AI.

> 🇧🇩 বাংলা: **[সেটআপ গাইড](docs/SETUP_BN.md)** · 🔒 **[Security architecture](docs/SECURITY.md)**
>
> ChatPilot is a separate product from MailPilot AI (the email assistant at the repository root). It shares the same account, billing, admin and security foundation, but has its own database, plans, pages and deployment.

## What it does
- **Answers in seconds, day and night** — price, size, colour, stock, delivery charge, payment method; Bangla, Banglish, English and 40+ languages.
- **Takes the order** — asks only for what's missing, appends an exact order summary computed by the server from catalog prices, and records the order when the customer confirms. Stock is reduced (and restored when an order is cancelled).
- **Safe by design** — invented prices or discounts, unknown links, "never say" phrases, low confidence, complaints/refunds and prompt-injection attempts are held as drafts for a person. Even on Auto-pilot.
- **Hands off to you** — "Needs human" queue with Telegram/Slack alerts; when anyone replies (in ChatPilot or in Meta's own inbox) the AI stays quiet for 12 hours.
- **Meta-compliant** — signed webhooks (X-Hub-Signature-256), 24-hour messaging window enforced in code, retries de-duplicated, message bursts debounced into one answer.
- **Brings buyers back** — optional one-time follow-up for quiet buyers inside the 24-hour window.
- **Draft → Auto-pilot** — every channel starts in Draft mode (one-click approve/edit); switch to Auto-pilot when you trust it.
- **Test chat** — chat as a customer and see stage, lead score, order and safety decisions without sending anything.
- **SaaS foundation** — sign-up (email or Google/Microsoft), teams & roles, agency workspaces, Stripe subscriptions + yearly + lifetime + manual bKash/bank payments, affiliate program, platform admin panel, lifecycle emails, 2FA, per-workspace AES-256-GCM encryption, GDPR export/delete, REST API with `cp_live_…` keys.

## Quick start (local)
```bash
cd chatpilot
npm install
npm start            # http://localhost:3000 — works with zero config in dev
npm test             # 38 tests: unit, API, security, webhook→AI→Graph pipeline, browser (Playwright)
```
Without an Anthropic key, customer messages are stored but not answered. Keys can be entered in **Admin → Settings** instead of `.env`.

## Production
1. Copy `.env.example` to `.env`; generate secrets with `openssl rand -hex 32`. **Back up `ENCRYPTION_KEY`.**
2. `docker compose up -d --build` behind HTTPS (Caddy / Nginx / Cloudflare). Set `APP_URL` to the public URL — the Meta callback URL is `APP_URL/api/social/webhook`.
3. Sign up with an email listed in `ADMIN_EMAILS` to get the **Platform admin** page.
4. Create a Meta app (Business type) with Messenger / Instagram / WhatsApp products and pass **App Review** (`pages_messaging`, `instagram_manage_messages`, `whatsapp_business_messaging`) and Business Verification before onboarding public customers. Each shop pastes its own Page/System-user token and app secret under **Channels** — see [docs/SETUP_BN.md](docs/SETUP_BN.md).
5. Stripe: create Starter / Pro / Business (monthly + yearly) and Lifetime prices, paste them in **Admin → Plans & pricing**, add the webhook `APP_URL/api/billing/webhook`.

## Architecture
```
src/
  server.js            Express app, security middleware, Meta webhook (raw body), static frontend
  db.js                SQLite schema (node:sqlite): accounts, billing, channels, products, conversations, chat_messages, orders
  plans.js             plans & limits (channels, AI replies, products, seats)
  auth.js · crypto.js · vault.js · settings.js   sessions, roles, envelope encryption, admin-editable settings
  routes/
    sales.js           Meta webhook + /api/sales (channels, products, conversations, orders, test chat)
    app.js             dashboard, knowledge base, assistant settings, team, notifications, API keys, tickets, referrals
    auth.js · oauth.js · billing.js · admin.js
  services/
    social.js          webhook parsing (Messenger / Instagram / WhatsApp), signature check, Graph API send, 24h window
    sales.js           the assistant: catalog-grounded structured replies, guards, server-priced orders, hand-off, follow-ups
    ai.js              Claude client, privacy masking, usage tracking
    guard.js           deterministic outbound checks and injection detection
    worker.js          follow-ups, lifecycle emails, retention
public/                landing, auth pages, customer app (/app, js/views/*) and admin panel (/admin)
test/                  unit, api, security, sales (fake Anthropic + fake Graph API), ui (Playwright)
```

## AI cost
One Claude call per customer burst (messages within `SALES_DEBOUNCE_MS` are answered together). The system prompt (business, catalog, knowledge base) is prompt-cached; `AI_EFFORT=low` keeps it cheap. Usage per workspace is tracked and capped by plan; the admin panel shows cost and margin per customer.

## REST API
Create a key in **Alerts & API**, then call `/api/v1/...` with `Authorization: Bearer cp_live_…` — e.g. `GET /api/v1/sales/orders`, `GET /api/v1/sales/conversations`, `POST /api/v1/sales/products`. Admin, account and billing endpoints are never reachable with API keys.
