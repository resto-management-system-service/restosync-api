import { tenantGuardOperation } from './prisma-tenant-guard.extension';

describe('tenantGuardOperation', () => {
  it('throws when a guarded operation on a tenant-owned model is missing restaurantId in where', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await expect(
      tenantGuardOperation({
        model: 'Order',
        operation: 'findMany',
        args: { where: { status: 'PENDING' } },
        query,
      }),
    ).rejects.toThrow(/Tenant guard: Order\.findMany\(\)/);

    expect(query).not.toHaveBeenCalled();
  });

  it('throws when the where clause is entirely absent', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await expect(
      tenantGuardOperation({
        model: 'Payment',
        operation: 'count',
        args: {},
        query,
      }),
    ).rejects.toThrow(/Tenant guard: Payment\.count\(\)/);

    expect(query).not.toHaveBeenCalled();
  });

  it('passes through when restaurantId is present at the top level of where', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'order-1' }]);

    const result = await tenantGuardOperation({
      model: 'Order',
      operation: 'findMany',
      args: { where: { restaurantId: 'restaurant-1' } },
      query,
    });

    expect(result).toEqual([{ id: 'order-1' }]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('passes through when restaurantId is nested inside an AND clause', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await tenantGuardOperation({
      model: 'Order',
      operation: 'findMany',
      args: {
        where: {
          AND: [{ restaurantId: 'restaurant-1' }, { status: 'PENDING' }],
        },
      },
      query,
    });

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('passes through unguarded operations (e.g. findUnique) even without restaurantId', async () => {
    const query = jest.fn().mockResolvedValue({ id: 'order-1' });

    const result = await tenantGuardOperation({
      model: 'Order',
      operation: 'findUnique',
      args: { where: { id: 'order-1' } },
      query,
    });

    expect(result).toEqual({ id: 'order-1' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('passes through operations on non-tenant-owned models (e.g. Subscription) without restaurantId', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await tenantGuardOperation({
      model: 'Subscription',
      operation: 'findMany',
      args: { where: {} },
      query,
    });

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('passes through create (no where clause to validate)', async () => {
    const query = jest.fn().mockResolvedValue({ id: 'order-1' });

    const result = await tenantGuardOperation({
      model: 'Order',
      operation: 'create',
      args: { data: { restaurantId: 'restaurant-1' } },
      query,
    });

    expect(result).toEqual({ id: 'order-1' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('throws for updateMany missing restaurantId', async () => {
    const query = jest.fn().mockResolvedValue({ count: 0 });

    await expect(
      tenantGuardOperation({
        model: 'Table',
        operation: 'updateMany',
        args: { where: { status: 'AVAILABLE' }, data: {} },
        query,
      }),
    ).rejects.toThrow(/Tenant guard: Table\.updateMany\(\)/);
  });
});
