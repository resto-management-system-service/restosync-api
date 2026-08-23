// TEMPORARY placeholder for #149. Prisma now requires `restaurantId` on
// every tenant-owned model (see prisma/schema.prisma), but nothing yet
// resolves the caller's actual restaurant — that requires #151 (restaurantId
// on the JWT payload) and #152 (services scoping every query/create by the
// authenticated caller's restaurantId, with a Prisma Client Extension as a
// backstop). Until those land, every row is minimally satisfied with this
// single default restaurant (matches prisma/seed.ts and
// prisma/backfill-restaurant.ts) so existing code keeps compiling and
// behaving exactly as before multi-tenancy was introduced.
//
// Do NOT build new features on top of this constant — it is scaffolding for
// #149 only, not a substitute for #152's real per-request scoping.
export const DEFAULT_RESTAURANT_ID = '00000000-0000-4000-8000-000000000001';
