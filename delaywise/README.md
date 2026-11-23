# Delaywise

A Shopify app that tells customers about late parcels before they ask.

Delaywise checks a store's shipped orders every hour. When a parcel stalls, runs late, hits a carrier problem or looks lost, it writes a short update to the customer **in the customer's own language** and **in the store's tone**, optionally with a single-use apology discount. The merchant approves each email or turns on Autopilot.

> 🇧🇩 বাংলা: **[সেটআপ ও লঞ্চ গাইড](docs/SETUP_BN.md)** · **[App Store রিভিউ চেকলিস্ট](docs/REVIEW_CHECKLIST_BN.md)**
> App Store listing copy: [docs/APP_STORE_LISTING.md](docs/APP_STORE_LISTING.md) · Feature research & roadmap: [docs/FEATURES_ROADMAP_BN.md](docs/FEATURES_ROADMAP_BN.md)

## What makes it different

| Feature | What it does |
|---|---|
| Early warning | Flags parcels with no carrier scan for 72 h (configurable), before the delivery date passes |
| Native-language emails | Claude writes each email in the customer's language (from `order.customerLocale`), in a friendly, professional or playful tone. Falls back to built-in templates in 7 languages |
| Approval or Autopilot | Review and edit each draft, or let them send automatically (paid plans) |
| Apology discounts | Optional single-use discount code for parcels that are days late or lost |
| Carrier scorecard | On-time rate, average days late and problem count per carrier |
| Revenue at risk | Live total of order value sitting in late or stalled parcels |
| Privacy by design | Stores no customer names, emails or addresses; email is read from Shopify only at send time |
| No theme changes | Nothing is injected into the storefront, so there is no speed impact |
| Shopify Flow trigger | "Shipment at risk" starts merchant workflows (tag order, Slack, help desk) |
| Arrived follow-up | Short "it arrived, thanks for your patience" note after a warned-about delay |
| Daily summary | One email per local day to the merchant when orders need attention |
| Rules | Exclude by order tag, country or minimum value; per-carrier transit days; send window in the shop's time zone |
| Results | Apology discount redemptions and the revenue they brought back |
| Bulk actions & CSV | Send/skip all drafts; export at-risk orders for carrier claims |

## How it works

```
Hourly job (/jobs/scan) ──► for each installed shop:
  1. Admin GraphQL: shipped orders from the last 45 days + fulfillment status/events
  2. Ship24 fallback for parcels Shopify has no scans for (capped by plan)
  3. Risk engine: none · watch · stalled · delayed · exception · lost   (app/lib/risk.ts)
  4. New or worse risk → draft email (Claude, app/services/ai-writer.server.ts)
     → optional discount code → approval queue or send (Resend)
```

| Path | Purpose |
|---|---|
| `app/lib/` | Pure logic: risk engine, status mapping, plans, scorecard, templates (unit tested) |
| `app/services/` | Shopify GraphQL, sync pipeline, AI writer, notifier, Ship24, email |
| `app/routes/app.*` | Embedded admin: dashboard, messages, carrier scorecard, settings, plans |
| `app/routes/webhooks.*` | Uninstall, scopes update, mandatory compliance webhooks |
| `app/routes/jobs.scan.tsx` | Scheduler endpoint, protected by `JOB_SECRET` |
| `prisma/schema.prisma` | Data model (SQLite by default) |

## Development

```bash
npm install
npx prisma migrate dev
npm test            # unit + integration tests (no network)
npm run typecheck
npm run lint
npm run validate:graphql -- path/to/admin_2026-10.json.br
shopify app dev     # needs a Shopify Partner account and a dev store
```

Pricing uses **Shopify App Pricing** (managed pricing): plans named `Starter`, `Growth` and `Pro` are created in the Partner Dashboard, and the app reads the active plan from `currentAppInstallation.activeSubscriptions`. See `app/lib/plans.ts`.

Built from Shopify's official React Router app template (MIT).
