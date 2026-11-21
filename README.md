# MailPilot AI

Multi-mailbox email automation SaaS. Customers connect all their email accounts (Gmail, Outlook, Yahoo, iCloud, Zoho, Yandex, any custom-domain IMAP/SMTP), and the AI (Anthropic Claude) reads, classifies, prioritizes and replies automatically — or drafts replies for one-click approval.

> বাংলায় ব্যবসায়িক গাইড: [docs/BUSINESS_GUIDE_BN.md](docs/BUSINESS_GUIDE_BN.md)

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
| Platform admin | Users, workspaces, est. MRR, AI token usage; manually grant plans (for bank transfer / bKash / PayPal customers) |
| Security | Mailbox passwords AES-256-GCM encrypted, bcrypt passwords, httpOnly JWT cookie, CSRF origin check, rate limits, Helmet CSP, tenant isolation, SSRF-safe webhooks |

## Quick start (local)

```bash
npm install
npm start            # http://localhost:3000 — works with zero config in dev
npm test
```

Without `ANTHROPIC_API_KEY` the app runs with keyword-based sorting only; without `STRIPE_SECRET_KEY` payments are disabled (you can still grant plans from the admin page).

## Production deployment

1. Copy `.env.example` to `.env` and fill it in. Generate secrets with `openssl rand -hex 32`. **Back up `ENCRYPTION_KEY`** — without it stored mailbox passwords can't be decrypted.
2. `docker compose up -d --build` (or `npm ci --omit=dev && npm start` behind a process manager).
3. Put it behind HTTPS (Caddy, Nginx + Let's Encrypt, Cloudflare). Set `APP_URL` to the public URL.
4. Sign up with an email listed in `ADMIN_EMAILS` to get the **Platform admin** page.

Works on any VPS (Hetzner, DigitalOcean, AWS Lightsail, Contabo) or Railway/Render/Fly.io with a persistent volume for `/app/data`.

### Stripe setup
1. Create Products in Stripe: Starter, Pro, Business (each with a monthly and a yearly recurring Price) and Lifetime (one-time Price).
2. Put the Price IDs in `.env` (`STRIPE_PRICE_*`).
3. Add a webhook endpoint `https://YOUR_DOMAIN/api/billing/webhook` with events `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_failed`; put its signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Enable the Customer Portal in Stripe settings. Optionally enable Stripe Tax and set `STRIPE_AUTOMATIC_TAX=true`.

Displayed prices live in `src/plans.js` — keep them in sync with Stripe.

### AI cost control
Each incoming email that isn't filtered out costs one Claude call (triage + draft in a single structured-output request). The system prompt (business description + knowledge base) is prompt-cached. `AI_EFFORT=low` keeps it cheap; usage and tokens per workspace are tracked in the `usage` table and on the admin page. Plan limits cap AI replies per month. Server-side refusal fallback is enabled.

## Architecture

```
src/
  server.js            Express app, security middleware, static frontend
  config.js            env configuration
  db.js                SQLite schema (node:sqlite) + helpers
  plans.js             pricing & limits
  auth.js              JWT cookie auth, roles
  routes/              auth, app (inbox, mailboxes, rules, …), billing (Stripe), admin
  services/
    mail.js            IMAP fetch (imapflow), SMTP send (nodemailer), threading headers
    ai.js              Claude triage + reply drafting (structured JSON output)
    processor.js       pipeline: store → triage → rules → draft/auto-send → side actions
    rules.js           rule matching/validation
    safety.js          automated-sender detection, reply rate-limit, business hours
    worker.js          background sync loop (concurrency 5)
public/                landing page, signup/login, dashboard SPA (vanilla JS)
```

## Roadmap ideas
- Google & Microsoft OAuth login for mailboxes (no app passwords; requires Google/Microsoft app verification)
- Postgres + separate worker processes / queue (BullMQ) for >1,000 mailboxes
- IMAP IDLE for instant replies, follow-up reminders, daily digest email, Slack/WhatsApp/Telegram alerts
- White-label / agency reseller mode, affiliate program, public API keys
- Localized UI (Bangla, Spanish, Arabic …)
