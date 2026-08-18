# Retroactive product documentation: Tables & Reservations

**Date:** 2026-08-19
**Status:** Approved — pending GitHub creation

## Context

The MVP — POS v1 milestone shows 57/57 issues closed (100%), but two shipped
feature modules were merged without ever being tracked as GitHub issues:

- **`src/tables`** (PR [#124](https://github.com/resto-management-system-service/restosync-api/pull/124),
  merged 2026-07-13): Table entity, AVAILABLE/OCCUPIED lifecycle, full CRUD,
  auto-release on checkout, duplicate-order prevention on an occupied table.
  The PR body left `Closes: (link to whatever issue...)` unfilled — confirmed
  no issue ever existed.
- **`src/reservations`** (PR [#125](https://github.com/resto-management-system-service/restosync-api/pull/125),
  merged 2026-07-13): full reservation booking system (3 types, deposits,
  no-show handling). No `Closes #` line in the PR at all.

This spec retroactively documents both as GitHub epics/user-stories/tech-tasks,
using the exact structure and tone already established by the closed MVP
issues (see #1–#61): `epic` → `user-story` (As a/I want/so that + Acceptance)
+ `tech-task` (Goal/Tasks), tagged with an `area:*` label and `P0`–`P2`.

Billing (`src/billing`, Subscription model) is explicitly **out of scope** —
it already has an adequate closed tech-task (#60) and is RestoSync's own SaaS
layer, not a restaurant-facing POS capability.

## Decision: grouping

Two structural options were considered:

1. **(Chosen)** Tables extends the existing epic **#2 "Order taking"** (it
   evolves the old tech-task #24 "Order type + table/identifier"). Reservations
   becomes a **new epic** with a new `area:reservations` label, since it's a
   distinct booking capability, not just an order-taking detail.
2. A single new combined epic "Table & reservation management" — rejected as
   less granular than the existing per-capability pattern.

Both retroactive epics attach to the existing **MVP — POS v1** milestone,
whose description is updated to mention tables and reservations explicitly.

## Content

### Milestone description update

> `Restaurant POS MVP: Menu, Order-taking (incl. tables), Reservations, Cash & register, Reports, Inventory.`

### Epic #2 "Order taking" — update

- Add to **In scope**: `Table management (CRUD, AVAILABLE/OCCUPIED lifecycle, auto-release on checkout)`
- Update **Status** to: `100% delivered. Table management added retroactively — delivered in PR #124.`

New sub-issues under #2 (`area:orders`, `P0`):

| Type | Title | Body |
|---|---|---|
| user-story | Create and manage tables | As a manager, I want to create and manage the restaurant's tables (name, capacity) so that the floor plan matches how we actually serve. Acceptance: create/update table; delete blocked while OCCUPIED. |
| user-story | View table status at a glance | As staff, I want to see all tables with their current status so that I know where to seat walk-ins. Acceptance: GET /tables lists status; OCCUPIED tables include a summary of the active order. |
| tech-task | Table entity + lifecycle model | Goal: model table lifecycle. Tasks: Table entity (AVAILABLE/OCCUPIED), tableId FK on Order replacing the free-text field; migration. |
| tech-task | Reuse active order on occupied table | Goal: prevent duplicate tickets on an occupied table. Tasks: order creation on an occupied table returns the existing active order instead of creating a new one. |
| tech-task | Auto-release table on checkout | Goal: keep table state correct after payment. Tasks: auto-release table to AVAILABLE inside the checkout transaction (critical path, not best-effort). |
| tech-task | Tests: table lifecycle | Goal: cover table lifecycle. Tasks: unit + e2e for CRUD, delete-blocked-when-occupied, auto-release on checkout. |

### New epic — Reservations (`area:reservations`, new label, `P0`)

```
## Epic — Reservations

Let staff register and manage table reservations ahead of a guest's arrival — from
a simple estimated-arrival note to a paid deposit that holds a specific table —
matching how the restaurant already takes bookings over WhatsApp/phone.

**Status:** 100% delivered in PR #125 (`src/reservations`). This epic documents
it retroactively.

### In scope
- Three types: INFORMAL (no payment, no table commitment), DEPOSIT_ONLY (fixed
  deposit holds a table), WITH_PREORDER (phone pre-order + 50% deposit)
- Manual staff lifecycle: confirm (deposit received) -> seat (order
  created/linked, table occupied) -> no-show/cancel (table released)
- Type-aware default no-show tolerance, staff-editable
- Table gains a RESERVED status between AVAILABLE and OCCUPIED

### Out of scope
- Live Stripe deposit collection (deposits confirmed manually by staff)
- Automatic no-show detection (always a manual staff decision)

### Sub-issues
_Tracked as GitHub sub-issues (see the Sub-issues panel)._
```

New sub-issues under the Reservations epic (`area:reservations`):

| Type | Priority | Title | Body |
|---|---|---|---|
| user-story | P1 | Log an informal reservation | As staff, I want to log an informal reservation with just an estimated arrival time and party size so that I can note walk-in-adjacent bookings the way we already do over WhatsApp, with no payment involved. Acceptance: creates a PENDING reservation; no tableId/items allowed. |
| user-story | P1 | Reserve a table with a fixed deposit | As staff, I want to take a reservation with a fixed deposit to hold a specific table so that a no-show has a real cost instead of losing the table for nothing. Acceptance: table must be AVAILABLE; deposit defaults to a configurable amount. |
| user-story | P1 | Reserve with phone pre-order + deposit | As staff, I want to take a reservation with a phone pre-order and 50% deposit so that the kitchen can prepare ahead of the guest's arrival. Acceptance: reuses order pricing; deposit is half the pre-order total. |
| user-story | P1 | Confirm a reservation on deposit received | As staff, I want to confirm a reservation once the deposit is actually received so that a table is only committed (RESERVED) after money is in hand. Acceptance: only PENDING reservations can be confirmed; table flips to RESERVED for paid types. |
| user-story | P1 | Seat a reservation into an order | As staff, I want to seat a reservation so that it flows directly into a normal order and checkout. Acceptance: reservation must be CONFIRMED; creates/links the order and sets the table OCCUPIED. |
| user-story | P1 | Mark no-show or cancel a reservation | As staff, I want to mark a reservation as a no-show or cancel it so that the table becomes available again. Acceptance: manual only, never automatic; releases a RESERVED table; deposit is forfeited, not refunded. |
| user-story | P2 | List and filter reservations | As staff, I want to list and filter reservations by status and date so that I can see the day's booking schedule at a glance. Acceptance: GET /reservations supports status + date filters. |
| tech-task | P1 | Reservation entity + status/type enums | Goal: model the reservation lifecycle. Tasks: Reservation entity + ReservationType/ReservationStatus enums, Table.status gains RESERVED; migration. |
| tech-task | P1 | Reuse order/discount logic for deposits | Goal: avoid duplicating order/discount logic. Tasks: reuse OrdersService.create() for pre-orders and applyDiscount() for deposit application instead of a bespoke code path. |
| tech-task | P1 | Type-aware no-show tolerance defaults | Goal: sensible no-show patience by commitment level. Tasks: default tolerance minutes by type (INFORMAL 10 / DEPOSIT_ONLY 20 / WITH_PREORDER 30), fully staff-editable per reservation. |
| tech-task | P1 | Tests: reservation lifecycle | Goal: cover the full booking lifecycle. Tasks: unit + e2e for all 3 types — create, confirm, seat, no-show/cancel, list filtering, regression on shared discount guard. |

Note: `reservedFor` timezone handling is already tracked separately in the
closed issue #126 — not duplicated here.

## Out of scope

- Billing/Subscription epic (already covered by closed tech-task #60)
- Live Stripe deposit collection
- Automatic no-show detection
- Any *new* functionality — this spec documents what already shipped, it does
  not propose new work

## Execution

All issues, the new label, the milestone description update, and the epic #2
body update are created directly via `gh` CLI / GitHub REST API — no code
changes, no implementation plan needed (this is a documentation-only change
to the issue tracker).
