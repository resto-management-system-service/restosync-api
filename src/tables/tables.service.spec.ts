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
  zone: {
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
    zone: {
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
      prisma.table.findMany.mockResolvedValue([]);
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

    it('rejects a duplicate name (whitespace/casing variation) with a 400', async () => {
      prisma.table.findMany.mockResolvedValue([
        { id: 't-other', name: 'Mesa 1' },
      ]);

      await expect(
        service.create({ name: ' mesa   1 ' }, user),
      ).rejects.toThrow(BadRequestException);
      await expect(service.create({ name: 'MESA 1' }, user)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.table.create).not.toHaveBeenCalled();
    });

    it('allows a name that differs only by a removed space ("mesa1" vs "Mesa 1")', async () => {
      prisma.table.findMany.mockResolvedValue([
        { id: 't-other', name: 'Mesa 1' },
      ]);
      prisma.table.create.mockResolvedValue({});

      await service.create({ name: 'mesa1' }, user);

      expect(prisma.table.create).toHaveBeenCalled();
    });

    it('scopes the uniqueness check to the caller restaurant', async () => {
      prisma.table.findMany.mockResolvedValue([]);
      prisma.table.create.mockResolvedValue({});

      await service.create({ name: 'Mesa 1' }, user);

      expect(prisma.table.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ restaurantId: user.restaurantId }),
        }),
      );
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

    it('edits an AVAILABLE table', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        status: TableStatus.AVAILABLE,
        restaurantId: user.restaurantId,
      });
      prisma.table.update.mockResolvedValue({ id: 't1' });

      await service.update('t1', { capacity: 6 }, user);

      expect(prisma.table.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { name: undefined, capacity: 6 },
      });
    });

    it('rejects renaming to a name that already exists (normalized, excluding itself)', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        status: TableStatus.AVAILABLE,
        restaurantId: user.restaurantId,
      });
      prisma.table.findMany.mockResolvedValue([
        { id: 't-other', name: 'Mesa 2' },
      ]);

      await expect(
        service.update('t1', { name: ' MESA  2 ' }, user),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.table.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 't1' } }),
        }),
      );
      expect(prisma.table.update).not.toHaveBeenCalled();
    });

    it('allows a table to keep its own name on update (self excluded)', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        status: TableStatus.AVAILABLE,
        restaurantId: user.restaurantId,
      });
      prisma.table.findMany.mockResolvedValue([]);
      prisma.table.update.mockResolvedValue({ id: 't1' });

      await service.update('t1', { name: 'Mesa 1' }, user);

      expect(prisma.table.update).toHaveBeenCalled();
    });

    it('throws BadRequestException when editing a RESERVED table', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        status: TableStatus.RESERVED,
        restaurantId: user.restaurantId,
      });

      await expect(service.update('t1', { capacity: 6 }, user)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.table.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when editing an OCCUPIED table', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        status: TableStatus.OCCUPIED,
        restaurantId: user.restaurantId,
      });

      await expect(
        service.update('t1', { name: 'New name' }, user),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.table.update).not.toHaveBeenCalled();
    });

    it('deletes an AVAILABLE table', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        status: TableStatus.AVAILABLE,
        restaurantId: user.restaurantId,
      });
      prisma.table.delete.mockResolvedValue({ id: 't1' });

      await service.remove('t1', user);

      expect(prisma.table.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });

    it('throws BadRequestException when removing a RESERVED table', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        status: TableStatus.RESERVED,
        restaurantId: user.restaurantId,
      });

      await expect(service.remove('t1', user)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.table.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when removing an OCCUPIED table', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        status: TableStatus.OCCUPIED,
        restaurantId: user.restaurantId,
      });

      await expect(service.remove('t1', user)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.table.delete).not.toHaveBeenCalled();
    });
  });

  describe('updateLayout', () => {
    const layoutDto = {
      positionX: 0.5,
      positionY: 0.25,
      width: 0.1,
      height: 0.1,
      shape: 'circle',
    };

    beforeEach(() => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        restaurantId: user.restaurantId,
        status: TableStatus.AVAILABLE,
      });
      prisma.table.update.mockResolvedValue({});
    });

    it('updates only layout/visual fields, never status/capacity/name', async () => {
      await service.updateLayout('t1', layoutDto, user);

      const { data } = prisma.table.update.mock.calls[0][0];
      expect(data).toEqual({
        zoneId: undefined,
        positionX: 0.5,
        positionY: 0.25,
        width: 0.1,
        height: 0.1,
        shape: 'circle',
      });
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('capacity');
      expect(data).not.toHaveProperty('name');
    });

    it('assigns the zone when the zone belongs to the caller restaurant', async () => {
      prisma.zone.findFirst.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
      });

      await service.updateLayout('t1', { zoneId: 'z1' }, user);

      expect(prisma.zone.findFirst).toHaveBeenCalledWith({
        where: { id: 'z1', restaurantId: user.restaurantId },
      });
      expect(prisma.table.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ zoneId: 'z1' }),
        }),
      );
    });

    it('throws NotFoundException (404, NOT 403) when the zone belongs to another restaurant', async () => {
      prisma.zone.findFirst.mockResolvedValue(null);

      await expect(
        service.updateLayout('t1', { zoneId: 'z1' }, user),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.table.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException (404, NOT 403) when updating the layout of a table belonging to another restaurant', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        restaurantId: 'restaurant-B',
      });

      await expect(service.updateLayout('t1', layoutDto, user)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.table.update).not.toHaveBeenCalled();
    });

    it('still updates the layout of an OCCUPIED table (layout edits are not status-restricted)', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: 't1',
        status: TableStatus.OCCUPIED,
        restaurantId: user.restaurantId,
      });

      await service.updateLayout('t1', layoutDto, user);

      expect(prisma.table.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ positionX: 0.5 }),
        }),
      );
    });
  });
});
