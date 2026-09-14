# restosync-api

NestJS REST + WebSocket API for multi-restaurant management — menu, tables, orders,
reservations, payments, cash register, inventory, reports, and SaaS billing — built with
Prisma + PostgreSQL, JWT auth with roles, per-restaurant data isolation, real-time updates,
Stripe payments, and Swagger docs.

## Stack

- **NestJS 10** (modular structure)
- **Prisma 5 + PostgreSQL**
- **JWT auth** (access + rotating refresh tokens, persisted sessions) with roles:
  `ADMIN` / `MANAGER` / `CASHIER` / `WAITER` / `KITCHEN` / `STAFF` / `CUSTOMER`
- **Multi-restaurant tenancy** — every tenant-owned entity is scoped by `restaurantId`,
  enforced in every service and backstopped by a Prisma Client Extension that throws on
  any unscoped query. Cross-restaurant access always returns `404`, never `403`.
- **Real-time updates** — `@nestjs/websockets` gateway (`src/realtime/`), JWT-authenticated
  socket connections, events scoped to `staff:${restaurantId}` and `customer:${userId}`
  rooms. No REST polling needed for order status/totals.
- **Stripe** — POS checkout payments (Payment Intents) *and* a decoupled SaaS billing
  module (`src/billing/`) for restaurant subscriptions — both signature-verified webhooks.
- **Swagger** at `/docs`, **Docker** + docker-compose, **GitHub Actions** CI with
  per-module coverage gates, image-per-tag release pipeline.

## Quick start

```bash
cp .env.example .env            # adjust secrets as needed
docker compose up -d postgres   # start Postgres
npm install
npx prisma migrate dev          # create schema (20+ migrations)
npm run prisma:seed             # admin/manager/cashier/waiter users + demo menu
npm run start:dev               # API on localhost:3000
```

- API: `http://localhost:3000/api`
- Swagger: `http://localhost:3000/docs`
- Health: `http://localhost:3000/health`
- WebSocket: same origin, JWT passed via socket handshake `auth.token`

Seed creates demo staff (all under the default restaurant "El Buen Filo"):

| Email | Password | Role |
|---|---|---|
| `admin@restosync.local` | `Admin123!` | ADMIN |
| `manager@restosync.local` | `Manager123!` | MANAGER |
| `cashier@restosync.local` | `Cashier123!` | CASHIER |
| `waiter@restosync.local` | `Waiter123!` | WAITER |

> **Running alongside `restosync-web`?** The web dev server also defaults to port 3000 —
> start it on a different port: `PORT=3001 pnpm dev`.

## Run everything in Docker

```bash
docker compose up --build       # Postgres + API (runs migrations on boot)
```

| Service | Image / Build | Port | Notes |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5433 (mapped) | Data persisted in `restosync-pgdata` volume |
| `api` | built from `Dockerfile` | 3000 | Runs `prisma migrate deploy` on boot |

## API docs & client publishing

The OpenAPI spec is the **contract** shared with `restosync-web`. On every push to
`main`, the `Docs` workflow generates the spec, diffs it (`oasdiff`) against the published
version, and — only on a real contract change — deploys it and dispatches an event that
makes `restosync-web` regenerate its typed client automatically via a rolling PR.

Live docs: <https://restosync-api-docs.iznomag.workers.dev>

## Modules

| Module | Highlights |
|---|---|
| `auth` | register / login / refresh / logout / me; JWT carries `role` + `restaurantId` |
| `users` | staff listing, scoped to caller's restaurant |
| `restaurants` | onboarding — create/list restaurants (tenant roots) |
| `menu` | categories + items; public reads, staff-guarded writes |
| `tables` | floor plan entities — `AVAILABLE` / `RESERVED` / `OCCUPIED`; opening an order on an occupied table returns the existing order instead of duplicating it |
| `orders` | server-computed totals, price snapshots, status state machine, discounts (fixed/percentage with audit trail), real-time emission on every change |
| `reservations` | three types — `INFORMAL` (no payment, table assigned on arrival), `DEPOSIT_ONLY` (fixed deposit), `WITH_PREORDER` (50% deposit on a pre-built order); type-aware default no-show tolerance; deposits confirmed manually by staff, never auto-refunded |
| `payments` | Stripe Payment Intents, raw-body webhook, idempotent event handling, auto-decrements linked inventory on checkout |
| `cash-register` | open/close sessions, expected vs. counted reconciliation |
| `inventory` | stock adjustments (`RESTOCK` / `SALE` / `WASTE` / `CORRECTION`), low-stock alerts, clamped at zero |
| `reports` | daily summaries, best-selling, payment breakdowns — all with optional `?format=csv` export |
| `audit` | generic `AuditLog` for sensitive actions (discounts, etc.), scoped per restaurant |
| `billing` | SaaS subscription webhooks — decoupled from POS checkout (`src/billing/README.md`) |
| `realtime` | WebSocket gateway — `order.status_changed` / `order.totals_changed` events |
| `menu` (modifiers) | `ModifierGroup` + `Modifier` per menu item (e.g. "Size", "Extras"), required/optional with min/max rules, validated and priced server-side at order time, selections snapshotted onto `OrderItem.modifiers` |

### Key design points

- **Money is stored in integer cents** everywhere — never floats.
- **Order totals are computed server-side**, snapshotted onto each line item; the client
  total is never trusted, and every checkout re-reads the current total from the DB.
- **Order status transitions** are enforced by a state machine (`src/orders/order-status.ts`).
- **Every tenant-owned model carries its own `restaurantId`** (direct column, not
  inherited via relation) — chosen for query simplicity and to minimize missed-JOIN risk.
  A Prisma Client Extension validates every query to a tenant-owned model and throws if
  the scope is missing; it does not silently inject the filter.
- **Reservation deposits are applied as a normal order discount** once the order has real
  items — reusing the existing discount mechanism rather than a parallel one.
- **Modifier price deltas are folded into `lineTotalCents`** everywhere a line total is
  computed (`create`, `addItem`, `updateItemQuantity`) — `lineTotalCents = (priceCents +
  modifierDeltaCents) * quantity`. Selections are validated server-side (unknown/
  unavailable/duplicate options, missing required groups, min/max rules) before being
  accepted.
- **Tax rate is configurable** (`TAX_RATE` env var, fails startup in production if unset;
  optional in dev). Restaurant timezone is configurable per-restaurant
  (`Restaurant.timezone`), used to interpret reservation times as local, not UTC.
- **The Stripe webhook is the source of truth** for POS payment success — confirms the
  order, not the client. Events are idempotent (dedup on event id). The SaaS billing
  webhook is entirely separate infrastructure from the POS checkout webhook.
- Payments sit behind a provider-agnostic `PaymentGateway` interface.

## Testing

```bash
npm test              # unit tests
npm run test:e2e       # e2e — --runInBand (shared cash-register/global state across files)
npm run test:cov       # unit tests + per-module coverage thresholds
```

CI enforces per-module coverage minimums (see `package.json`'s `jest.coverageThreshold`)
and re-checks the full e2e suite on every PR.

### Testing the Stripe webhooks locally

```bash
stripe listen --forward-to localhost:3000/api/payments/webhook
stripe trigger payment_intent.succeeded
```

## Environment variables

See `.env.example` for the full list. Notable ones beyond the basics:

| Variable | Purpose |
|---|---|
| `TAX_RATE` | Decimal tax rate (e.g. `0.18`). Required in production, optional in dev. |
| `RESERVATION_DEPOSIT_CENTS` | Fixed deposit amount for `DEPOSIT_ONLY` reservations. |
| `STRIPE_BILLING_WEBHOOK_SECRET` | Separate from `STRIPE_WEBHOOK_SECRET` — SaaS billing webhook has its own Stripe signing secret. |

## Scripts

| Script | Purpose |
|---|---|
| `npm run start:dev` | watch-mode dev server |
| `npm run build` | compile to `dist/` |
| `npm run prisma:migrate` | create/apply a dev migration |
| `npm run prisma:studio` | open Prisma Studio |
| `npm run prisma:seed` | seed demo restaurant + staff + menu |
| `npm run openapi:generate` | write OpenAPI spec to `site/openapi.json` |
| `npm run lint` | eslint --fix |

## CI/CD

- `ci.yml` — lint, build, unit + e2e tests, coverage gates on every push/PR.
- `release.yml` — on merge to `main`: bumps patch version, tags, builds & pushes a
  Docker image tagged with that version, deploys to dev *(currently disabled pending
  Fly.io dev environment provisioning — see `#73`)*.
- `deploy-prod.yml` — manual `workflow_dispatch`, deploys a specific image tag to
  production. Rollback = redeploy an older tag.
- `docs.yml` — publishes the OpenAPI spec and notifies `restosync-web` on contract changes.
- `infra-validate.yml` — validates `infra/fly.toml` on PRs.

## Breaking changes log

- **`#6` (2026-08-28):** `OrderLineDto.modifiers` / `AddOrderItemDto.modifiers` — previously
  a free-form object with no server-side logic — was **replaced** by `modifierIds: string[]`.
  `CreateReservationDto` reuses `OrderLineDto`, so `WITH_PREORDER` reservations also use
  `modifierIds` now. Picked up automatically in `restosync-web` via the OpenAPI sync pipeline.

## Known gaps / deferred

- `SUPER_ADMIN` role (cross-restaurant support access) is designed conceptually but not
  implemented — `POST /restaurants` currently uses `ADMIN` as a placeholder.
- File/image upload for menu items — URL-only for the MVP (`imageUrl` field), no direct
  upload endpoint.
