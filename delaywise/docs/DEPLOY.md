# Deploying Delaywise

Delaywise is one Node.js process (React Router server) plus a SQLite database file, and an external scheduler that calls `/jobs/scan`.

## Rules that matter

1. **Run exactly one instance.** The scan lock and the daily rate limits live in this one process and its database. Don't scale horizontally on SQLite.
2. **Put the database on a persistent disk.** If the file is lost, the app forgets which customers were already emailed and would warn them again. Mount a volume (Render Disk, Fly volume, Railway volume) and point `DATABASE_URL` at it, e.g. `DATABASE_URL=file:/data/delaywise.sqlite`. Back the file up daily.
3. **Set every variable in `.env.example`** on the host. In production the app refuses to "send" emails without `RESEND_API_KEY` rather than pretending.

## Docker

```bash
docker build -t delaywise .
docker run -p 3000:3000 \
  -v delaywise-data:/data \
  -e DATABASE_URL=file:/data/delaywise.sqlite \
  -e SHOPIFY_API_KEY=... -e SHOPIFY_API_SECRET=... -e SHOPIFY_APP_URL=https://your-app.example.com \
  -e SCOPES=read_orders,write_discounts -e SHOPIFY_APP_HANDLE=delaywise \
  -e ANTHROPIC_API_KEY=... -e RESEND_API_KEY=... -e EMAIL_FROM_ADDRESS=updates@your-domain.com \
  -e JOB_SECRET=$(openssl rand -hex 24) -e APP_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  -e COMPANY_NAME="..." -e COMPANY_ADDRESS="..." -e SUPPORT_EMAIL=support@your-domain.com \
  delaywise
```

`npm run docker-start` runs `prisma migrate deploy` before starting, so schema migrations apply on every deploy.

**Keep `APP_ENCRYPTION_KEY` safe and stable.** If it changes, stored Klaviyo keys can't be read; merchants see a "Reconnect Klaviyo" warning.

## Scheduler

Call the job every 15–60 minutes:

```bash
curl -X POST https://your-app.example.com/jobs/scan -H "Authorization: Bearer $JOB_SECRET"
```

Each call works for up to `JOB_TIME_BUDGET_MS` (default 50 s), scanning `JOB_CONCURRENCY` shops at a time (default 3), oldest-scanned first. Shops it doesn't reach go first next time, and overlapping calls are safe. The response lists `processed` and `remaining`; if `remaining` stays above 0, call more often or raise the budget.

## Moving to Postgres later

For many hundreds of shops, switch `provider` in `prisma/schema.prisma` to `postgresql`, create a fresh migration (`npx prisma migrate dev --name init_postgres` against an empty Postgres), and copy data over. The code uses no SQLite-specific features.

## Checks before each release

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run validate:graphql -- path/to/admin_2026-10.json.br
```
