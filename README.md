# restosync-api

NestJS REST API for restaurant management — **menu, orders, payments** — built with
Prisma + PostgreSQL, JWT auth with roles, Stripe payments, and Swagger docs.

## Stack

- **NestJS 10** (modular, hexagonal-leaning structure)
- **Prisma 5 + PostgreSQL**
- **JWT auth** (access + rotating refresh tokens, persisted sessions) with `ADMIN` / `STAFF` / `CUSTOMER` roles
- **Stripe** payments via Payment Intents + signature-verified webhooks
- **Swagger** at `/docs`, **Docker** + docker-compose, **GitHub Actions** CI

## Quick start

```bash
cp .env.example .env            # adjust secrets as needed
docker compose up -d postgres   # start Postgres
npm install
npx prisma migrate dev          # create schema
npm run prisma:seed             # optional: admin user + sample menu
npm run start:dev
```

- API: `http://localhost:3000/api`
- Swagger: `http://localhost:3000/docs`
- Health: `http://localhost:3000/health`

Seed creates an admin: `admin@restosync.local` / `Admin123!`.

## API documentation

Interactive Swagger docs are published to Cloudflare and updated automatically on
every push to `main`:

**https://restosync-api-docs.iznomag.workers.dev**

The site is a static OpenAPI spec rendered with Swagger UI:

- `/` — Swagger UI
- `/openapi.json` — raw OpenAPI 3.0 spec

The same docs are served live by the running API at `http://localhost:3000/docs`.

### How it's published

The [`Docs` workflow](.github/workflows/docs.yml) runs on each push to `main`
(or manually via **Actions → Docs → Run workflow**):

1. `npm run openapi:generate` boots the app and writes `site/openapi.json`
   (`scripts/generate-openapi.ts`, reusing `src/swagger.config.ts`).
2. The Swagger UI shell (`scripts/swagger-ui.html`) is copied to `site/index.html`.
3. `site/` is deployed to a Cloudflare Worker (static assets) via
   `cloudflare/wrangler-action` (config in `wrangler.jsonc`).

To regenerate the spec locally (needs a reachable Postgres for Prisma):

```bash
npm run openapi:generate   # writes site/openapi.json
```

## Run everything in Docker

```bash
docker compose up --build       # Postgres + API (runs migrations on boot)
```

## Modules

| Module     | Highlights                                                              |
| ---------- | ----------------------------------------------------------------------- |
| `auth`     | register / login / refresh / logout / me; global JWT + roles guards     |
| `users`    | admin-only user listing                                                 |
| `menu`     | categories + items; public reads, admin-guarded writes                  |
| `orders`   | server-computed totals, price snapshots, status state machine           |
| `payments` | Stripe Payment Intents, raw-body webhook, idempotent event handling     |

### Key design points

- **Money is stored in integer cents** everywhere — never floats.
- **Order totals are computed server-side** from current menu prices and snapshotted
  onto each line item; the client total is never trusted.
- **Order status transitions** are enforced by a state machine (`src/orders/order-status.ts`).
- **The Stripe webhook is the source of truth** for payment success — it confirms the
  order, not the client. Events are idempotent (dedup on event id).
- Payments sit behind a provider-agnostic `PaymentGateway` interface so a second
  provider can be added without touching `PaymentsService`.

## Testing

```bash
npm test          # unit tests
npm run test:e2e  # e2e (needs a running Postgres + migrations)
```

### Testing the Stripe webhook locally

```bash
stripe listen --forward-to localhost:3000/api/payments/webhook
stripe trigger payment_intent.succeeded
```

## Scripts

| Script                  | Purpose                          |
| ----------------------- | -------------------------------- |
| `npm run start:dev`     | watch-mode dev server            |
| `npm run build`         | compile to `dist/`               |
| `npm run prisma:migrate`| create/apply a dev migration     |
| `npm run prisma:studio` | open Prisma Studio               |
| `npm run prisma:seed`   | seed admin + sample menu         |
| `npm run openapi:generate` | write OpenAPI spec to `site/openapi.json` |
| `npm run lint`          | eslint --fix                     |
