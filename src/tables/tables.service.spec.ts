import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role, TableStatus } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { TablesService } from './tables.service';

type MockPrisma = {
  table: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  order: {
    findFirst: jest.Mock;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    table: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    order: {
      findFirst: jest.fn(),
    },
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

describe('TablesService', () => {
  let service: TablesService;
  let prisma: MockPrisma;
  const user = buildUser();

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new TablesService(prisma as unknown as PrismaService);
  });

  describe('findAll', () => {
    it('scopes the query to the caller restaurantId', async () => {
      prisma.table.findMany.mockResolvedValue([
        { id: 't1', status: TableStatus.AVAILABLE },
      ]);

      await service.findAll(user);

      expect(prisma.table.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { restaurantId: user.restaurantId },
        }),
      );
    });

    it("scopes each OCCUPIED table's activeOrder lookup by the caller restaurantId too", async () => {
      prisma.table.findMany.mockResolvedValue([
        { id: 't1', status: TableStatus.OCCUPIED },
      ]);
      prisma.order.findFirst.mockResolvedValue(null);

      await service.findAll(user);

      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ restaurantId: user.restaurantId }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException if the table does not exist', async () => {
      prisma.table.findUnique.mockResolvedValue(null);

      await expect(service.findOne('t1', user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException (404, NOT 403) for a table belonging to another restaurant', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        status: TableStatus.AVAILABLE,
        restaurantId: 'restaurant-B',
      });

      await expect(service.findOne('t1', user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the table when it belongs to the caller restaurant', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        status: TableStatus.AVAILABLE,
        restaurantId: user.restaurantId,
      });

      const result = await service.findOne('t1', user);

      expect(result.id).toBe('t1');
    });
  });

  describe('create', () => {
    it('sets restaurantId from the caller, never from the client', async () => {
      prisma.table.create.mockResolvedValue({});

      await service.create(
        {
          name: 'Mesa 1',
          // @ts-expect-error simulating a malicious/naive client payload
          restaurantId: 'restaurant-EVIL',
        },
        user,
      );

      const { data } = prisma.table.create.mock.calls[0][0];
      expect(data.restaurantId).toBe(user.restaurantId);
    });
  });

  describe('update / remove', () => {
    it('throws NotFoundException (404, NOT 403) when updating a table belonging to another restaurant', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        restaurantId: 'restaurant-B',
      });

      await expect(
        service.update('t1', { name: 'New name' }, user),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.table.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException (404, NOT 403) when removing a table belonging to another restaurant', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        status: TableStatus.AVAILABLE,
        restaurantId: 'restaurant-B',
      });

      await expect(service.remove('t1', user)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.table.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when removing an OCCUPIED table belonging to the caller restaurant', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        status: TableStatus.OCCUPIED,
        restaurantId: user.restaurantId,
      });

      await expect(service.remove('t1', user)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
