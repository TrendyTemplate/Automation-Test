# MailPilot AI

Multi-mailbox email automation SaaS. Customers connect all their email accounts (Gmail, Outlook, Yahoo, iCloud, Zoho, Yandex, any custom-domain IMAP/SMTP), and the AI (Anthropic Claude) reads, classifies, prioritizes and replies automatically — or drafts replies for one-click approval.

> 🇧🇩 বাংলা: **[লঞ্চ চেকলিস্ট](docs/LAUNCH_CHECKLIST_BN.md)** · **[ব্যবসায়িক গাইড ও প্রতিযোগী বিশ্লেষণ](docs/BUSINESS_GUIDE_BN.md)** · **[গবেষণা: কেন অন্যরা ব্যর্থ হয়েছে](docs/RESEARCH_BN.md)**
> 🔒 **[Security architecture](docs/SECURITY.md)**

## What makes it different
- **Any provider**: Gmail, Outlook/M365, Yahoo, iCloud, Zoho, Yandex and any IMAP/cPanel/custom domain — plus one-click Google & Microsoft OAuth.
- **Writes like you, improves itself**: learns your style from your Sent folder and learns from every edit you make to a draft.
- **Safe autopilot**: confidence threshold, human-like send delay with undo, VIP/legal/refund guardrails, business hours, loop protection.
- **Explainable**: every classification and every held reply shows *why*.
- **Ask your inbox**: natural-language questions across all accounts, with links to source emails.
- **Lead radar & mini-CRM**: lead score, intent, extracted company/phone/budget/deadline, automatic follow-ups for quiet leads.
- **Morning briefing + Telegram/Slack alerts**, **Privacy Shield** (masks cards/passwords/OTPs before AI), phishing guard, 2FA, retention auto-delete.
- **Agency workspaces**, REST API with API keys, webhooks, rule recipes, affiliate program, lifetime licenses.
- **Trust layer**: deterministic outbound guard (invented prices, unapproved links, third-party addresses, secrets, card numbers, "never say"), prompt-injection detection, BEC/look-alike detection, earned autopilot per category, AI accuracy score, AI transparency log, test lab.
- **Team inbox**: assignment, internal notes with @mentions, collision warnings, SLA targets & breach alerts, snooze, awaiting-reply view, out-of-office mode.
- **Global**: translate any email, preview replies in your own language, reads PDF/image attachments, one-click unsubscribe (RFC 8058) declutter.
- **Organised for teams & agencies**: email invitations (`/join` links), roles (owner/admin/member) with role-aware menus, ownership transfer, leave/delete workspace, multiple client workspaces, bulk inbox actions, AI corrections, notification bell.
- **Runs itself**: automatic lifecycle emails (welcome, trial ending/ended, 80%/100% usage, disconnected mailbox, failed payment) and white-label branding — product name, company details and support email from Admin → Settings appear on every page and in the legal templates.
- **Security**: per-workspace envelope encryption (AES-256-GCM + AAD) for credentials *and* email content, server-side revocable sessions, lockout, 2FA (required for admins), consent-based support access, emergency lockdown, SSRF-proof networking — see [docs/SECURITY.md](docs/SECURITY.md).

## Features

| Area | What it does |
|---|---|
| Unified inbox | All connected accounts in one searchable, filterable inbox |
| AI triage | Category, priority, sentiment, language, one-line summary per email |
| Auto-reply | Replies in the sender's language, grounded in the customer's knowledge base. Modes per account: **Off** (sort only), **Draft** (human approves), **Auto-pilot** |
| Guardrails | Never replies to no-reply/newsletters/bulk/auto-replies (RFC 3834), max one auto-reply per sender per 24h, business hours, confidence threshold, AI flags sensitive mail (legal, refunds, unknown facts) for a human, prompt-injection-resistant system prompt |
| Rules engine | IF from/domain/subject/body/category/priority/sentiment/language … THEN AI reply (with extra instructions), template reply, forward, mark read, ignore, webhook (Slack/Zapier/Make/CRM) |
| Approval queue | Edit-and-send AI drafts; ask AI to rewrite with instructions ("offer 10% discount") |
| Knowledge base & templates | Facts the AI may use; canned replies with `{{first_name}}` tags |
| Thread context | Previous messages and replies in the same conversation are given to the AI |
| Team | Owner / admin / member roles, seat limits per plan |
| Billing | Stripe Checkout: monthly, yearly, and one-time **Lifetime** license; Stripe customer portal; webhooks keep plans in sync; free trial |
| Plan limits | Mailboxes, AI replies/month, rules, seats enforced server-side (`src/plans.js`) |
| Platform admin (`/admin`) | Overview (MRR/ARR, revenue, sign-ups, AI cost), users (suspend, impersonate, reset password/2FA, email), workspaces (plans, custom limits, trial extension, suspension), payments (Stripe + manual bKash/bank/PayPal with plan activation, CSV), plan & pricing editor, affiliates, mailbox monitor, AI usage & cost, support tickets, announcements & email broadcast, settings (AI, OAuth, SMTP, Stripe, Telegram, maintenance mode), system health, one-click DB backup, audit & activity logs |
| Accounts | Email/password, Sign in with Google/Microsoft, TOTP 2FA, password reset, email verification, GDPR export & delete |
| Security | Mailbox passwords AES-256-GCM encrypted, bcrypt passwords, httpOnly JWT cookie, CSRF origin check, rate limits, Helmet CSP, tenant isolation, SSRF-safe webhooks |

## Quick start (local)

```bash
npm install
npm start            # http://localhost:3000 — works with zero config in dev
npm test             # 51 tests: unit, API, workflows, security attacks, real IMAP/SMTP end-to-end, browser (Playwright)
# Optional: explore with demo data (login demo@mailpilot.test / Demo-Pass-2026, platform admin)
DB_PATH=./data/demo.db node scripts/seed-demo.js && DB_PATH=./data/demo.db npm start
```

Without an Anthropic key the app runs with keyword-based sorting only; without Stripe, payments are manual (record them in Admin → Payments). All keys can be entered in **Admin → Settings** instead of `.env`.

## Production deployment

1. Copy `.env.example` to `.env` and fill it in. Generate secrets with `openssl rand -hex 32`. **Back up `ENCRYPTION_KEY`** — without it stored mailbox passwords can't be decrypted.
2. `docker compose up -d --build` (or `npm ci --omit=dev && npm start` behind a process manager).
3. Put it behind HTTPS (Caddy, Nginx + Let's Encrypt, Cloudflare). Set `APP_URL` to the public URL.
4. Sign up with an email listed in `ADMIN_EMAILS` to get the **Platform admin** page.

Works on any VPS (Hetzner, DigitalOcean, AWS Lightsail, Contabo) or Railway/Render/Fly.io with a persistent volume for `/app/data`.

### Stripe setup
1. Create Products in Stripe: Starter, Pro, Business (each with a monthly and a yearly recurring Price) and Lifetime (one-time Price).
2. Paste the Price IDs in **Admin → Plans & pricing** (or `.env` `STRIPE_PRICE_*` on first boot).
3. Add a webhook endpoint `https://YOUR_DOMAIN/api/billing/webhook` with events `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`; put its signing secret in Admin → Settings → Payments.
4. Enable the Customer Portal in Stripe settings. Optionally enable Stripe Tax.

### Google & Microsoft OAuth
See the step-by-step in [docs/LAUNCH_CHECKLIST_BN.md](docs/LAUNCH_CHECKLIST_BN.md#ধাপ-৫). Redirect URIs: `/api/oauth/google/callback`, `/api/oauth/microsoft/callback`.
"Sign in with Google" uses only basic scopes. One-click **Gmail** mailbox connection uses the restricted `https://mail.google.com/` scope: fine for up to 100 test users; beyond that Google requires restricted-scope verification and an annual CASA security assessment. App passwords work for everyone meanwhile.

### AI cost control
Each incoming email that isn't filtered out costs one Claude call (triage + draft in a single structured-output request). The system prompt (business description + knowledge base) is prompt-cached. `AI_EFFORT=low` keeps it cheap; usage and tokens per workspace are tracked in the `usage` table and on the admin page. Plan limits cap AI replies per month. Server-side refusal fallback is enabled.

## Architecture

```
src/
  server.js            Express app, security middleware, static frontend
  config.js            env configuration
  db.js                SQLite schema (node:sqlite) + helpers
  plans.js             pricing & limits
  auth.js              server-side sessions, roles, lockout, password policy
  crypto.js            AES-256-GCM primitives, versioned master keys
  vault.js             per-workspace envelope encryption + migration
  settings.js          admin-editable platform settings (secrets encrypted)
  routes/              auth, oauth, app (inbox, contacts, AI, analytics, …), billing (Stripe), admin
  services/
    mail.js            IMAP fetch (imapflow), SMTP send (nodemailer), threading headers
    ai.js              Claude triage + reply drafting (structured JSON output)
    processor.js       pipeline: store → triage → rules → draft/auto-send → side actions
    rules.js           rule matching/validation
    safety.js          automated-sender detection, reply rate-limit, business hours
    guard.js           deterministic outbound checks, injection / BEC / look-alike / opt-out detection
    net.js             SSRF-safe fetch (DNS-pinned), mail-host validation
    worker.js          sync loop, scheduled sends, follow-ups, daily briefing, retention purge
    oauth.js           Google/Microsoft OAuth + XOAUTH2 token refresh
    notify.js          system email, Telegram, Slack
    totp.js            2FA (RFC 6238)
public/                landing, auth pages, customer app (/app, js/views/*) and admin panel (/admin); vanilla JS ES modules, no build step
test/                  unit, api, security, e2e-mail (real IMAP+SMTP servers), ui (Playwright), ai-pipeline
scripts/seed-demo.js   demo data for screenshots and sales demos
```

## App map (customer side)
| Sidebar | Tabs / contents | Who |
|---|---|---|
| Home | setup checklist, KPIs, hot leads, activity | everyone |
| Inbox | two-pane inbox; views: inbox, mine, unassigned, overdue, awaiting reply, flagged, snoozed; bulk actions | everyone |
| Approvals | AI drafts, follow-ups, scheduled autopilot replies (undo) | everyone |
| Ask AI · Contacts & leads · Analytics | | everyone |
| Email accounts | connect (OAuth / IMAP), edit, signature, mode | owner/admin |
| AI training | Business & voice · Knowledge base · Templates | owner/admin |
| Autopilot & rules | Autopilot & safety · Rules · Test lab | owner/admin |
| Alerts & API | Telegram/Slack, signed webhooks, API keys | owner/admin |
| Declutter | newsletters & robots, one-click unsubscribe | everyone |
| Settings | Profile · Team · Plan & billing (owner/admin) · Security & privacy · Refer & earn | everyone |
| Help & support | FAQ, tickets | everyone |

## REST API
Create a key in **Alerts & integrations**, then call `/api/v1/...` with `Authorization: Bearer mp_live_…`. Every dashboard endpoint is available (e.g. `GET /api/v1/messages`, `GET /api/v1/contacts`, `POST /api/v1/messages/:id/reply`, `GET /api/v1/analytics`). Admin endpoints are never reachable with API keys.

## Roadmap ideas
- Paddle / Lemon Squeezy (merchant of record) checkout
- Postgres + separate worker processes / queue (BullMQ) for >1,000 mailboxes; IMAP IDLE for instant replies
- White-label reseller mode, WhatsApp alerts, localized UI (Bangla, Spanish, Arabic …), PWA mobile app
