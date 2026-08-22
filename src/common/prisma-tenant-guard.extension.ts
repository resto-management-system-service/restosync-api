import { Prisma } from '@prisma/client';

// #152: a validating backstop, not an auto-injector. This extension NEVER
// adds or fixes a missing restaurantId filter — every service must still
// explicitly write it. It only throws when a query against a tenant-owned
// model is missing that filter, catching an omission before it can leak or
// mutate another restaurant's data.
//
// Models: the same 12 tenant-owned models from #149 (User, Category,
// MenuItem, Order, OrderItem, Table, InventoryItem, StockAdjustment,
// Reservation, CashRegisterSession, Payment, AuditLog). User IS included:
// its only unscoped lookups (login/JWT validation, by email or by id) use
// findUnique, which is structurally exempt from this guard (see below), so
// including User here adds real protection for UsersService.findAll/count
// with no impact on auth flows. Subscription is explicitly out of scope
// per #9's epic description.
export const TENANT_GUARDED_MODELS = new Set<string>([
  'User',
  'Category',
  'MenuItem',
  'Order',
  'OrderItem',
  'Table',
  'InventoryItem',
  'StockAdjustment',
  'Reservation',
  'CashRegisterSession',
  'Payment',
  'AuditLog',
]);

// Operations guarded: every read/bulk-write operation whose `where` clause
// is a general WhereInput, i.e. CAN legally carry a restaurantId filter.
//
// Deliberately EXCLUDED, for a structural (not a laziness) reason:
// - findUnique, update, delete: Prisma types these operations' `where` as
//   a *WhereUniqueInput*, which only accepts fields that are part of a
//   unique index (id, or an explicit @@unique). None of our 12 models has
//   a compound unique including restaurantId, so a bare
//   findUnique/update/delete({ where: { id } }) by the global UUID primary
//   key CANNOT carry restaurantId in its where clause at all — that isn't
//   a missing filter, it's how a single global-id lookup/mutation is
//   expressed in Prisma. This is exactly why every findOne/update/remove
//   in this codebase follows the established fetch-by-id-then-verify
//   pattern (see OrdersService.findOne): fetch/mutate via the unique id,
//   then compare the row's restaurantId to the caller's and throw
//   NotFoundException on mismatch *before* trusting or returning it. The
//   extension cannot see or enforce that downstream check — that
//   responsibility stays with each service, exactly as decision 2
//   requires. Guarding these operations would make every single
//   by-id lookup in the app throw, which is not the bug this guard exists
//   to catch.
// - create, upsert: no `where` clause to validate; restaurantId on create
//   is enforced by each service setting it explicitly from the caller's
//   AuthUser (decision 4), not by this guard.
//
// ADDED beyond decision 1's literal list, for the same defense-in-depth
// reasoning applied consistently: count, aggregate, groupBy. These accept
// a general WhereInput exactly like findMany/findFirst and are exactly the
// operations ReportsService (explicitly in scope for this prompt) and
// pagination `count()` calls elsewhere use — omitting them would leave a
// real gap in the safety net for aggregate reporting queries.
const GUARDED_OPERATIONS = new Set<string>([
  'findMany',
  'findFirst',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

function hasRestaurantIdFilter(where: unknown): boolean {
  if (!where || typeof where !== 'object') {
    return false;
  }
  const clause = where as Record<string, unknown>;
  if ('restaurantId' in clause && clause.restaurantId !== undefined) {
    return true;
  }
  for (const key of ['AND', 'OR'] as const) {
    const nested = clause[key];
    if (Array.isArray(nested) && nested.some(hasRestaurantIdFilter)) {
      return true;
    }
    if (nested && typeof nested === 'object' && hasRestaurantIdFilter(nested)) {
      return true;
    }
  }
  return false;
}

// Exported standalone so it can be unit-tested directly, without needing a
// real PrismaClient/$extends instance or a live database connection (the
// guard throws BEFORE calling `query`, so the underlying query never runs
// for the failing case; for the passing case, tests supply a stub `query`).
export async function tenantGuardOperation(params: {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}): Promise<unknown> {
  const { model, operation, args, query } = params;

  if (
    model &&
    TENANT_GUARDED_MODELS.has(model) &&
    GUARDED_OPERATIONS.has(operation)
  ) {
    const where = (args as { where?: unknown } | undefined)?.where;
    if (!hasRestaurantIdFilter(where)) {
      throw new Error(
        `Tenant guard: ${model}.${operation}() is missing a restaurantId filter in its where clause. ` +
          `Every query against a tenant-owned model must explicitly scope by the caller's restaurantId.`,
      );
    }
  }

  return query(args);
}

export const tenantGuardExtension = Prisma.defineExtension({
  name: 'tenant-guard',
  query: {
    $allModels: {
      $allOperations: tenantGuardOperation,
    },
  },
});
