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
docker compose up -d postgres   # start Postgres on localhost:5432
npm install
npx prisma migrate dev          # create schema
npm run prisma:seed             # optional: admin user + sample menu
npm run start:dev               # API on localhost:3000
```

- API: `http://localhost:3000/api`
- Swagger: `http://localhost:3000/docs`
- Health: `http://localhost:3000/health`

Seed creates an admin: `admin@restosync.local` / `Admin123!`.

> **Running alongside `restosync-web`?** The web dev server also defaults to port 3000.
> Start the web app on a different port: `PORT=3001 pnpm dev` (or `pnpm dev -- --port 3001`).

## Run everything in Docker

```bash
docker compose up --build       # Postgres + API (runs migrations on boot)
```

The `docker-compose.yml` defines two services:

| Service    | Image / Build      | Port  | Notes                                         |
| ---------- | ------------------ | ----- | --------------------------------------------- |
| `postgres` | `postgres:16-alpine` | 5432 | Data persisted in `restosync-pgdata` volume   |
| `api`      | built from `Dockerfile` | 3000 | Runs `prisma migrate deploy` on boot      |

## API docs & client publishing

The OpenAPI spec is the **contract** shared with consumers (e.g. `restosync-web`). On every
push to `main`, the [`Docs` workflow](.github/workflows/docs.yml):

1. Generates the spec — `npm run openapi:generate` boots the app and writes
   `site/openapi.json` (`scripts/generate-openapi.ts`, reusing `src/swagger.config.ts`).
2. Runs **`oasdiff`** between the freshly generated spec and the **currently published**
   one to detect whether the contract actually changed.
3. **Only on a change**: deploys the Swagger UI + spec to Cloudflare
   (live at <https://restosync-api-docs.iznomag.workers.dev>) and sends a
   `repository_dispatch` (`update-openapi-client`) to **`restosync-web`**, which regenerates
   its typed client and opens a rolling `chore/update-openapi` PR. No contract change ⇒ no
   deploy, no notification.

```
push to main → generate spec → oasdiff
   ├─ unchanged → done (no deploy, no dispatch)
   └─ changed   → deploy docs + dispatch → restosync-web opens/updates client PR
```

**Setup (one-time):** repo secret **`OPENAPI_SYNC_TOKEN`** — a fine-grained PAT with
**Contents** + **Pull requests** read/write on `restosync-web` — used to send the dispatch.
Regenerate the spec locally with `npm run openapi:generate` (needs a reachable Postgres).

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
