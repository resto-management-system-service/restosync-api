# Restructure #9, #8, #6 into epics with user-stories/tech-tasks

**Date:** 2026-08-19
**Status:** Approved — pending GitHub creation

## Context

MVP — POS v1 shows 75/75 closed after the retroactive Tables/Reservations pass,
but three issues remain open and unstructured: #9 (Multi-restaurant tenancy),
#8 (Real-time order status / kitchen display), #6 (Menu item modifiers). Unlike
Tables/Reservations, none of this is built — `grep` confirms no `restaurantId`,
no WebSocket gateway, no `ModifierGroup`/`Modifier` models anywhere in `src/`.

The user's goal is to actually finish V1: these three are genuine outstanding
work, not documentation debt. Each already exists as a flat issue (`## Context
/ ## Scope / ## Notes`), with no `epic`/`user-story`/`tech-task` labels, no
`area:*`, no milestone. Each is explicitly referenced from an existing MVP
epic's "Out of scope" section:

- Epic #1 (Menu management): "Recipe/BOM, modifiers (tracked separately in #6)"
- Epic #2 (Order taking): "Real-time kitchen display (tracked in #8)"
- Epic #11 (Platform & foundations): "Full Billing/Subscriptions epic (post-MVP), multi-tenant (#9)"

This confirms the intended area for each and that they were always meant to
become their own follow-up work, not be folded into #1/#2/#11.

## Decision

Convert each of #9, #8, #6 **in place** into an epic (same issue number, so
the existing cross-references from #1/#2/#11 stay accurate) and attach
user-story/tech-task sub-issues, following the exact pattern established for
Tables/Reservations. Differences from that pass:

- **Status: Not started** (not "delivered") — nothing here is built.
- **Issues stay open** — this is real pending work, not retroactive record-keeping.
- All added to the **MVP — POS v1** milestone (per the user: finishing these
  is what "finishing V1" means), epic-level priority `P0` for consistency with
  every other MVP epic; story/tech-task level priority reflects actual
  criticality within each epic.
- Area labels: `area:platform` (#9), `area:orders` (#8), `area:menu` (#6) —
  reusing existing labels per the cross-references above, no new labels needed.

## Content

### Epic #9 — Multi-restaurant tenancy (`area:platform`, P0)

In scope: `Restaurant` model + `restaurantId` FK on tenant-owned entities;
scope every query by caller's restaurant; tenancy model decision (shared-DB
filtering vs schema-per-tenant); guards/services enforce isolation.

Sub-issues:
1. (user-story, P0) Cross-restaurant data isolation
2. (user-story, P0) Staff account scoped to one restaurant via JWT
3. (user-story, P1) Onboard a new restaurant
4. (tech-task, P0) Restaurant model + restaurantId FK migration
5. (tech-task, P0) Decide isolation strategy (ADR)
6. (tech-task, P0) Carry restaurantId through auth/JWT
7. (tech-task, P0) Enforce isolation in every service + backstop guard
8. (tech-task, P1) Tests: cross-tenant isolation for every entity/role

### Epic #8 — Real-time order status updates / kitchen display (`area:orders`, P0)

In scope: WebSocket/SSE channel emitting on order status transitions; events
scoped by role (staff see all, customer sees own); single emission point in
`OrdersService.updateStatus`; reuses existing JWT.

Sub-issues:
1. (user-story, P1) Live status updates for kitchen display
2. (user-story, P1) Customer sees only their own order's updates
3. (user-story, P2) Staff sees updates for all orders
4. (tech-task, P1) WebSocket gateway or SSE endpoint
5. (tech-task, P1) Emit from the single OrdersService transition point
6. (tech-task, P1) Socket auth (JWT) + role/ownership event scoping
7. (tech-task, P2) Tests: emission, scoping, auth

### Epic #6 — Menu item modifiers / options (`area:menu`, P0)

In scope: `ModifierGroup`/`Modifier` models linked to `MenuItem`;
required/optional groups with min/max rules; order creation validates and
prices selected modifiers server-side; selections snapshotted onto the
existing `OrderItem.modifiers` JSON column.

Sub-issues:
1. (user-story, P1) Define modifier groups and options per menu item
2. (user-story, P1) Required/optional groups with min/max rules
3. (user-story, P1) Select modifiers when adding an order line
4. (user-story, P1) Order line total includes modifier price deltas
5. (user-story, P2) Modifiers snapshotted for historical accuracy
6. (tech-task, P1) ModifierGroup + Modifier models + migration
7. (tech-task, P1) Validate selected modifiers against item's groups
8. (tech-task, P1) Fold modifier price deltas into line-total computation
9. (tech-task, P1) Snapshot selections onto OrderItem.modifiers
10. (tech-task, P2) Tests: group validation, pricing, snapshot correctness

## Out of scope

- Actually implementing any of this (that's a separate design+plan cycle per
  epic, to follow once the user picks which to build first)
- New area labels — reused existing ones per the cross-reference evidence

## Execution

Edit issues #9/#8/#6 in place (epic body + labels + milestone), create 25
sub-issues via GitHub REST API, link via the native sub-issues relationship.
All created/edited issues remain **open** — no code exists yet.
