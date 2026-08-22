// One-time migration script for #149 (Restaurant model + restaurantId FK).
//
// This is NOT part of the regular seed flow (prisma/seed.ts). It exists to
// backfill restaurantId on pre-existing rows created before multi-tenancy was
// introduced, between migration Step A (nullable restaurantId columns) and
// Step B (NOT NULL constraint). Run manually:
//
//   npx ts-node prisma/backfill-restaurant.ts
//
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_RESTAURANT = {
  name: 'El Buen Filo',
  timezone: 'America/Lima',
};

// Every model that received a nullable restaurantId column in Step A.
// Subscription is explicitly out of scope.
const TENANT_TABLES = [
  'user',
  'category',
  'menuItem',
  'order',
  'orderItem',
  'table',
  'inventoryItem',
  'stockAdjustment',
  'reservation',
  'cashRegisterSession',
  'payment',
  'auditLog',
] as const;

async function main() {
  const restaurant = await prisma.restaurant.upsert({
    where: { id: await getOrCreateDefaultRestaurantId() },
    update: {},
    create: DEFAULT_RESTAURANT,
  });

  console.log(`Using restaurant: ${restaurant.name} (${restaurant.id})`);

  const updatedCounts: Record<string, number> = {};

  for (const model of TENANT_TABLES) {
    const delegate = (prisma as any)[model];
    const result = await delegate.updateMany({
      where: { restaurantId: null },
      data: { restaurantId: restaurant.id },
    });
    updatedCounts[model] = result.count;
    console.log(`Backfilled ${result.count} row(s) in "${model}"`);
  }

  console.log('\nBackfill summary:');
  console.table(updatedCounts);

  // Explicit verification: zero rows with NULL restaurantId across all
  // tenant-owned tables before Step B (NOT NULL constraint) is applied.
  const remainingNulls: Record<string, number> = {};
  let totalRemaining = 0;

  for (const model of TENANT_TABLES) {
    const delegate = (prisma as any)[model];
    const count = await delegate.count({ where: { restaurantId: null } });
    remainingNulls[model] = count;
    totalRemaining += count;
  }

  console.log('\nVerification — remaining NULL restaurantId rows per table:');
  console.table(remainingNulls);

  if (totalRemaining > 0) {
    throw new Error(
      `Backfill incomplete: ${totalRemaining} row(s) still have a NULL restaurantId. ` +
        'Do NOT proceed to migration Step B (require_tenant_ids) until this is zero.',
    );
  }

  console.log(
    '\nVerification passed: 0 rows with NULL restaurantId across all 12 tenant-owned tables.',
  );
}

// The Restaurant row itself has no restaurantId to backfill against — this
// helper just finds (or lazily prepares to create) the single default
// restaurant used for all pre-multi-tenancy data.
async function getOrCreateDefaultRestaurantId(): Promise<string> {
  const existing = await prisma.restaurant.findFirst({
    where: { name: DEFAULT_RESTAURANT.name },
  });
  return existing?.id ?? '00000000-0000-4000-8000-000000000001';
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
