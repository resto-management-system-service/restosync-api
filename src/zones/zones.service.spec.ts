import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role, TableStatus } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ZonesService } from './zones.service';

type MockPrisma = {
  zone: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  table: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createMockPrisma(): MockPrisma {
  return {
    zone: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    table: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

function buildUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'manager@restosync.local',
    role: Role.MANAGER,
    restaurantId: 'restaurant-A',
    ...overrides,
  };
}

describe('ZonesService', () => {
  let service: ZonesService;
  let prisma: MockPrisma;
  const user = buildUser();

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ZonesService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('sets restaurantId from the caller, never from the client', async () => {
      prisma.zone.findMany.mockResolvedValue([]);
      prisma.zone.create.mockResolvedValue({});

      await service.create(
        {
          name: 'Piso 1',
          code: '1',
          // @ts-expect-error simulating a malicious/naive client payload
          restaurantId: 'restaurant-EVIL',
        },
        user,
      );

      const { data } = prisma.zone.create.mock.calls[0][0];
      expect(data.restaurantId).toBe(user.restaurantId);
    });

    it('stores the zone code as-is', async () => {
      prisma.zone.findMany.mockResolvedValue([]);
      prisma.zone.create.mockResolvedValue({});

      await service.create({ name: 'Terraza', code: 'T' }, user);

      const { data } = prisma.zone.create.mock.calls[0][0];
      expect(data.code).toBe('T');
    });

    it('defaults sortOrder to 0 when omitted', async () => {
      prisma.zone.findMany.mockResolvedValue([]);
      prisma.zone.create.mockResolvedValue({});

      await service.create({ name: 'Terraza', code: 'T' }, user);

      const { data } = prisma.zone.create.mock.calls[0][0];
      expect(data.sortOrder).toBe(0);
    });

    it('rejects a duplicate code with a 400 (case-insensitive)', async () => {
      prisma.zone.findMany.mockResolvedValue([{ id: 'z-other', code: 't' }]);

      await expect(
        service.create({ name: 'Terraza', code: 'T' }, user),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.zone.create).not.toHaveBeenCalled();
    });

    it('allows the same code in a different restaurant', async () => {
      prisma.zone.findMany.mockResolvedValue([]);
      prisma.zone.create.mockResolvedValue({});

      await service.create({ name: 'Piso 1', code: '1' }, user);

      expect(prisma.zone.create).toHaveBeenCalled();
    });

    it('scopes the uniqueness check to the caller restaurant', async () => {
      prisma.zone.findMany.mockResolvedValue([]);
      prisma.zone.create.mockResolvedValue({});

      await service.create({ name: 'Piso 1', code: '1' }, user);

      expect(prisma.zone.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ restaurantId: user.restaurantId }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes the query to the caller restaurantId and orders by sortOrder', async () => {
      prisma.zone.findMany.mockResolvedValue([]);

      await service.findAll(user);

      expect(prisma.zone.findMany).toHaveBeenCalledWith({
        where: { restaurantId: user.restaurantId },
        orderBy: { sortOrder: 'asc' },
      });
    });
  });

  describe('update', () => {
    it('throws NotFoundException (404, NOT 403) for a zone belonging to another restaurant', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: 'restaurant-B',
      });

      await expect(
        service.update('z1', { name: 'New name' }, user),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.zone.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the zone does not exist', async () => {
      prisma.zone.findUnique.mockResolvedValue(null);

      await expect(
        service.update('z1', { name: 'New name' }, user),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.zone.update).not.toHaveBeenCalled();
    });

    it('renames a zone regardless of its tables statuses (no table check)', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
      });
      prisma.zone.update.mockResolvedValue({ id: 'z1', name: 'New name' });

      await service.update('z1', { name: 'New name' }, user);

      expect(prisma.zone.update).toHaveBeenCalledWith({
        where: { id: 'z1' },
        data: { name: 'New name', code: undefined, sortOrder: undefined },
      });
      // Renaming must not be gated on table status — no table query at all.
      expect(prisma.table.findFirst).not.toHaveBeenCalled();
    });

    it('updates the code when provided', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
      });
      prisma.zone.findMany.mockResolvedValue([]);
      prisma.zone.update.mockResolvedValue({ id: 'z1', code: 'VIP' });

      await service.update('z1', { code: 'VIP' }, user);

      expect(prisma.zone.update).toHaveBeenCalledWith({
        where: { id: 'z1' },
        data: { name: undefined, code: 'VIP', sortOrder: undefined },
      });
    });

    it('rejects a code collision on update with a 400 (excluding itself)', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
      });
      prisma.zone.findMany.mockResolvedValue([{ id: 'z-other', code: '2' }]);

      await expect(service.update('z1', { code: '2' }, user)).rejects.toThrow(
        BadRequestException,
      );

      expect(prisma.zone.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'z1' } }),
        }),
      );
      expect(prisma.zone.update).not.toHaveBeenCalled();
    });

    it('allows a zone to keep its own code on update (self excluded)', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
      });
      prisma.zone.findMany.mockResolvedValue([]);
      prisma.zone.update.mockResolvedValue({ id: 'z1', code: '1' });

      await service.update('z1', { code: '1' }, user);

      expect(prisma.zone.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws NotFoundException (404, NOT 403) for a zone belonging to another restaurant', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: 'restaurant-B',
      });

      await expect(service.remove('z1', user)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.table.findFirst).not.toHaveBeenCalled();
      expect(prisma.zone.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the zone has a RESERVED table', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
      });
      prisma.table.findFirst.mockResolvedValue({ id: 't1' });

      await expect(service.remove('z1', user)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.table.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            zoneId: 'z1',
            restaurantId: user.restaurantId,
            status: { in: [TableStatus.RESERVED, TableStatus.OCCUPIED] },
          }),
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the zone has an OCCUPIED table', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
      });
      prisma.table.findFirst.mockResolvedValue({ id: 't1' });

      await expect(service.remove('z1', user)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deletes a zone with no tables', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
      });
      prisma.table.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          table: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          zone: { delete: jest.fn().mockResolvedValue({ id: 'z1' }) },
        }),
      );

      const result = await service.remove('z1', user);

      expect(result).toEqual({ id: 'z1' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('unassigns the zone AVAILABLE tables (zoneId -> null) and deletes the zone atomically', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
      });
      prisma.table.findFirst.mockResolvedValue(null);

      const txTableUpdateMany = jest.fn().mockResolvedValue({ count: 3 });
      const txZoneDelete = jest.fn().mockResolvedValue({ id: 'z1' });
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          table: { updateMany: txTableUpdateMany },
          zone: { delete: txZoneDelete },
        }),
      );

      await service.remove('z1', user);

      expect(txTableUpdateMany).toHaveBeenCalledWith({
        where: { zoneId: 'z1', restaurantId: user.restaurantId },
        data: { zoneId: null },
      });
      expect(txZoneDelete).toHaveBeenCalledWith({ where: { id: 'z1' } });
    });
  });

  describe('getNextTableName', () => {
    it('suggests "01" as the first suffix for an empty zone', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
        code: '1',
      });
      prisma.table.findMany.mockResolvedValue([]);

      const result = await service.getNextTableName('z1', user);

      expect(result).toEqual({ suggestedName: '101' });
      expect(prisma.table.findMany).toHaveBeenCalledWith({
        where: { zoneId: 'z1', restaurantId: user.restaurantId },
        select: { name: true },
      });
    });

    it('returns the next sequential number when suffixes are taken', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
        code: '1',
      });
      prisma.table.findMany.mockResolvedValue([
        { name: '101' },
        { name: '102' },
      ]);

      const result = await service.getNextTableName('z1', user);

      expect(result).toEqual({ suggestedName: '103' });
    });

    it('reuses a gap left by a deleted table (101/103 -> 102)', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
        code: '1',
      });
      prisma.table.findMany.mockResolvedValue([
        { name: '101' },
        { name: '103' },
      ]);

      const result = await service.getNextTableName('z1', user);

      expect(result).toEqual({ suggestedName: '102' });
    });

    it('ignores names that do not match the "{code}NN" pattern', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
        code: '1',
      });
      prisma.table.findMany.mockResolvedValue([
        { name: 'Mesa 1' },
        { name: '1A1' },
        { name: '1' },
        { name: '101' },
      ]);

      const result = await service.getNextTableName('z1', user);

      // Only "101" (suffix 01) is recognized; "Mesa 1", "1A1" and "1" are not.
      expect(result).toEqual({ suggestedName: '102' });
    });

    it('works with a non-numeric code prefix', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
        code: 'VIP',
      });
      prisma.table.findMany.mockResolvedValue([{ name: 'VIP01' }]);

      const result = await service.getNextTableName('z1', user);

      expect(result).toEqual({ suggestedName: 'VIP02' });
    });

    it('throws NotFoundException (404) for a zone in another restaurant', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: 'restaurant-B',
        code: '1',
      });

      await expect(service.getNextTableName('z1', user)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.table.findMany).not.toHaveBeenCalled();
    });
  });
});
