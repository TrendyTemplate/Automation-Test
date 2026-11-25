# ChatPilot AI

AI sales assistant SaaS for **Facebook Messenger, Instagram Direct and WhatsApp Business**. Shops connect their Page / Instagram account / WhatsApp number, add their products, and the assistant (Anthropic Claude) answers customers 24/7 in their own language, recommends products from the catalog, collects name, phone and address, and records confirmed orders — prices always come from the catalog, never from the AI.

> 🇧🇩 বাংলা: **[সেটআপ গাইড](docs/SETUP_BN.md)** · **[Meta App Review গাইড](docs/META_APP_REVIEW_BN.md)** · **[A–Z রোডম্যাপ](docs/ROADMAP_BN.md)** · 🔒 **[Security architecture](docs/SECURITY.md)**
>
> ChatPilot is a separate product from MailPilot AI (the email assistant at the repository root). It shares the same account, billing, admin and security foundation, but has its own database, plans, pages and deployment.

## What it does
- **One step to start** — "Continue with Facebook" creates the account and connects every Page (plus linked Instagram) the owner selects; the shop profile is filled from the Page and the assistant is live immediately.
- **Learns by itself, continuously** — from the Page's past chats and comment replies on connect, then from every reply the team sends (in ChatPilot or in Facebook/Instagram), every edited or discarded AI draft, and which chats end in orders. Per-page playbooks (style, facts, FAQs, comment style, "never say") are re-distilled automatically; similar past replies are recalled for each new message. Personal data is masked; everything is encrypted per workspace. See the **Learning** page.
- **Many pages, one account** — filter chats by page, per-page cards on Home, per-page learning and settings.
- **Post comments** — public reply under the comment plus an optional private inbox reply, in the page's own learned style.
- **Answers in seconds, day and night** — price, size, colour, stock, delivery charge, payment method; Bangla, Banglish, English and 40+ languages.
- **Takes the order** — asks only for what's missing, appends an exact order summary computed by the server from catalog prices, and records the order when the customer confirms. Stock is reduced (and restored when an order is cancelled).
- **Safe by design** — invented prices or discounts, unknown links, "never say" phrases, low confidence, complaints/refunds and prompt-injection attempts are held as drafts for a person. Even on Auto-pilot.
- **Hands off to you** — "Needs human" queue with Telegram/Slack alerts; when anyone replies (in ChatPilot or in Meta's own inbox) the AI stays quiet for 12 hours.
- **Meta-compliant** — signed webhooks (X-Hub-Signature-256), 24-hour messaging window enforced in code, retries de-duplicated, message bursts debounced into one answer.
- **Comment rules without AI** — hide comments with phone numbers / links / blocked words, instant keyword replies (public + inbox), per-post on/off, one answer per person per post.
- **Chat menu** — Messenger Get Started, greeting, ice breakers and persistent menu; Instagram ice breakers; WhatsApp conversation starters. Story replies and mentions reach the assistant.
- **Business hours** — away message (once per 12h) or the assistant keeps selling and says a person will confirm when you open.
- **Delivery charges & payments** — zones by address words, free-delivery threshold; bKash / Nagad / Rocket numbers with an advance-payment rule; the assistant collects the TrxID, a person verifies it, reused TrxIDs are flagged.
- **Couriers** — Steadfast, Pathao, RedX booking from an order, tracking code sent to the customer, status sync by webhook or polling; delivery-history fraud check (BDCourier / Steadfast / own orders).
- **Customers & analytics** — customers merged by phone across channels (orders, spend, return rate, segments, CSV); first-response time, AI share, chat→order conversion, delivery rate, revenue by page / click-to-message ad / product.
- **Broadcasts inside Meta's rules** — 24-hour window on Messenger/Instagram, approved templates on WhatsApp, "stop" opt-out, daily cap.
- **Installable app + push** — PWA with Web Push (VAPID, RFC 8291, no extra dependency) for new orders, risky orders, payments to verify and hand-offs. Bangla interface.
- **Brings buyers back** — optional one-time follow-up for quiet buyers inside the 24-hour window.
- **One-click "Connect with Facebook"** — shops connect their Page, Instagram and WhatsApp (Embedded Signup) through the platform's Meta app; webhooks are subscribed automatically. Manual token entry remains as an advanced option. Meta's data-deletion and deauthorize callbacks are built in.
- **Draft → Auto-pilot** — every channel starts in Draft mode (one-click approve/edit); switch to Auto-pilot when you trust it.
- **Test chat** — chat as a customer and see stage, lead score, order and safety decisions without sending anything.
- **SaaS foundation** — sign-up (email or Google/Microsoft), teams & roles, agency workspaces, Stripe subscriptions + yearly + lifetime + manual bKash/bank payments, affiliate program, platform admin panel, lifecycle emails, 2FA, per-workspace AES-256-GCM encryption, GDPR export/delete, REST API with `cp_live_…` keys.

## Quick start (local)
```bash
cd chatpilot
npm install
npm start            # http://localhost:3000 — works with zero config in dev
npm test             # 80 tests: unit, API, security, webhook→AI→Graph pipeline, learning, comments & rules, orders, couriers, payments, broadcasts, push, Meta connect & deletion callbacks, browser + phone layout + Bangla UI (Playwright)
ANTHROPIC_API_KEY=sk-ant-… npm run check:ai   # 10 real conversations against the live Claude API (quality check, nothing is sent)
```
Without an Anthropic key, customer messages are stored but not answered. Keys can be entered in **Admin → Settings** instead of `.env`.

## Production
1. Copy `.env.example` to `.env`; generate secrets with `openssl rand -hex 32`. **Back up `ENCRYPTION_KEY`.**
2. `docker compose up -d --build` behind HTTPS (Caddy / Nginx / Cloudflare). Set `APP_URL` to the public URL — the Meta callback URL is `APP_URL/api/social/webhook`.
3. Sign up with an email listed in `ADMIN_EMAILS` to get the **Platform admin** page.
4. Create **one** Meta app (Business type) for the platform, put its App ID / secret / webhook verify token in **Admin → Settings → Meta**, and pass Business Verification + **App Review** — step by step in [docs/META_APP_REVIEW_BN.md](docs/META_APP_REVIEW_BN.md). Shops then just click **Connect** under Channels.
5. To move ChatPilot to its own repository with history: `chatpilot/scripts/move-to-own-repo.sh <new-repo-url>`.
6. Stripe: create Starter / Pro / Business (monthly + yearly) and Lifetime prices, paste them in **Admin → Plans & pricing**, add the webhook `APP_URL/api/billing/webhook`.

## Design
ChatPilot has its own design language ("Bazaar"), separate from MailPilot: warm paper surfaces, deep teal brand with a coral accent, rounded pill controls, and self-hosted Onest + Bricolage Grotesque + **Hind Siliguri** (Bangla) fonts. The app is chat-first and mobile-first: an icon rail on desktop, a bottom tab bar with a "More" sheet on phones, and a three-pane Conversations view (list · chat · customer & orders) that turns into a full-screen messenger on phones. Platform colours (Messenger blue, Instagram magenta, WhatsApp green) mark every chat.

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
    meta.js            Meta data-deletion / deauthorize callbacks + /deletion status page
    auth.js · oauth.js (sign-in + Connect with Facebook) · billing.js · admin.js
  services/
    social.js          webhook parsing (Messenger / Instagram / WhatsApp), signature check, Graph API send, 24h window
    learning.js        the learning engine: collect examples, recall similar replies, distill per-page playbooks, history import
    connect.js         connect every granted Page / Instagram / WhatsApp at once, fill the shop profile, start learning
    meta.js            Connect with Facebook (Pages, Instagram, WhatsApp), webhook subscriptions, signed_request
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
