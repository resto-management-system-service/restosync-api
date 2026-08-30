# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev          # watch mode (requires postgres running)
docker compose up postgres -d  # start only the DB for local dev

# Build & lint
npm run build
npm run lint               # eslint --fix

# Tests
npm test                   # unit tests (jest, rootDir: src)
npm run test:e2e           # e2e tests (test/jest-e2e.json)
npm run test:watch
npx jest src/orders/order-status.spec.ts  # single file

# Database
npm run prisma:migrate     # create + apply migration (dev)
npm run prisma:deploy      # apply existing migrations (prod/CI)
npm run prisma:studio      # Prisma GUI
npm run prisma:seed        # seed via prisma/seed.ts

# OpenAPI
npm run openapi:generate   # outputs to site/openapi.json
```

**Required env vars** (startup fails without them): `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`. Stripe vars are optional; webhook endpoint returns 400 if `STRIPE_WEBHOOK_SECRET` is absent.

## Architecture

Standard NestJS module-per-domain layout under `src/`: `auth`, `users`, `menu`, `orders`, `payments`, `prisma`, `config`, `common`.

### Global infrastructure

- **`PrismaModule`** — exported globally; inject `PrismaService` anywhere without re-importing.
- **`ConfigModule`** — global, validated at startup via `src/config/env.validation.ts`. Access typed config through `ConfigService`.
- **`PrismaExceptionFilter`** — global filter in `main.ts`; maps Prisma error codes (P2002 → 409, P2025 → 404, P2003 → 400) so services never need try/catch for DB constraint errors.

### Auth & authorization

Two global `APP_GUARD`s are registered in `AppModule`:

1. **`JwtAuthGuard`** — all routes are protected by default. Opt out with `@Public()` (`src/auth/decorators/public.decorator.ts`).
2. **`RolesGuard`** — enforces `@Roles(Role.ADMIN, ...)` on handlers/controllers. Passes through if no roles are declared.

Refresh tokens are stored as bcrypt hashes in the `sessions` table (never the raw token). On refresh, every active session for the user is checked via `bcrypt.compare`; the matched session is revoked and a new pair is issued (token rotation).

### Payment gateway abstraction

`src/payments/gateway/payment-gateway.interface.ts` defines a `PaymentGateway` interface injected via the `PAYMENT_GATEWAY` symbol. `PaymentsModule` provides `StripeGateway` under that symbol. To swap providers, implement the interface and update the provider binding — `PaymentsService` requires no changes.

The Stripe webhook controller lives at `src/payments/gateway/` and needs `rawBody: true` (set in `main.ts`) for signature verification.

### Order state machine

`src/orders/order-status.ts` exports `ORDER_STATUS_TRANSITIONS` (a record of allowed next states) and `canTransition(from, to)`. `OrdersService` calls `canTransition` before every status update and throws `BadRequestException` on invalid transitions. Terminal states are `COMPLETED` and `CANCELLED`.

### OpenAPI / docs pipeline

`scripts/generate-openapi.ts` boots the app headlessly and writes the spec to `site/openapi.json`. The `docs` CI workflow compares it against the deployed Cloudflare spec with `oasdiff`; it only redeploys and dispatches `update-openapi-client` to `restosync-web` when the contract actually changes.

## Infra

- **Fly.io** — one shared app `restosync-api` (used as "dev"), config at `infra/fly.toml`; Dockerfile is at the repo root (`../Dockerfile` relative to `fly.toml`).
- `[deploy] release_command` runs `npx prisma migrate deploy` before each new Machine starts.
- **Auto-deploy**: `release.yml` fires after CI passes on `main` — bumps the patch version, tags it, builds+pushes `registry.fly.io/restosync-api:vX.Y.Z`, then `deploy` job runs `flyctl deploy --image …` to `restosync-api`.
- **Rollback / pin**: `deploy-pinned.yml` (manual `workflow_dispatch`, `version` input) re-deploys an older tag to the same app.
- `infra-validate` workflow validates `fly.toml` on every PR.
- **CORS**: `src/common/cors.ts` + `CORS_ORIGINS` env (comma-separated, `*` = single-label wildcard). Empty = reflect any origin in dev, blocked in production. Set in `infra/fly.toml [env]` for the deployed app.
