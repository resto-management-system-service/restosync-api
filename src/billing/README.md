# Billing vs Payments boundary

- `src/payments/` → POS checkout. The diner pays the restaurant.
  Methods: CASH, CARD, TRANSFER. STRIPE is a reserved enum value for
  a possible future diner-facing online payment flow — NOT implemented,
  NOT part of this module's active logic.

- `src/billing/` → SaaS subscription billing. The restaurant (as
  RestoSync's customer) pays RestoSync via Stripe. This is completely
  decoupled from the order/checkout flow and has no relationship to
  PaymentMethod or Order/Payment models.

- Do not mix these two concerns in the same module going forward.

## Scope (intentionally minimal for the MVP)

- One `Subscription` model — no Plan/features/entitlements model.
- One webhook endpoint (`POST /billing/webhook`) handling only the
  minimum events needed to keep subscription status in sync:
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_failed`.
- No Stripe Customer Portal integration.
- No Restaurant/Tenant model — the project is mono-tenant for the MVP
  (multi-tenancy is tracked separately in #9).

## Credentials

- Reuses the same `STRIPE_SECRET_KEY` (Stripe account/API key) already
  configured for `src/payments/`'s Stripe gateway — no separate Stripe
  account, no duplicated SDK setup.
- Uses its **own** webhook signing secret, `STRIPE_BILLING_WEBHOOK_SECRET`,
  distinct from `STRIPE_WEBHOOK_SECRET` (used by `src/payments/`). These
  must NOT be the same value — see "Stripe dashboard setup" below.

## Stripe dashboard setup

`POST /api/billing/webhook` and `POST /api/payments/webhook` are two
independent Stripe webhook endpoints and must be configured as **two
separate endpoints** in the Stripe dashboard (Developers → Webhooks),
each subscribed to its own set of events:

1. **Payments webhook** (existing, `src/payments/`) → URL pointing at
   `/api/payments/webhook`, subscribed to `payment_intent.succeeded` /
   `payment_intent.payment_failed`. Its signing secret goes into
   `STRIPE_WEBHOOK_SECRET`.
2. **Billing webhook** (this module) → a **new, separate** endpoint in
   the dashboard pointing at `/api/billing/webhook`, subscribed to
   `customer.subscription.created` / `customer.subscription.updated` /
   `customer.subscription.deleted` / `invoice.payment_failed`. Its
   signing secret goes into `STRIPE_BILLING_WEBHOOK_SECRET`.

Do not point both endpoints at the same URL, and do not reuse one
endpoint's signing secret for the other — each Stripe webhook endpoint
has its own unique signing secret, and mixing them up will cause
signature verification to fail for every event.
