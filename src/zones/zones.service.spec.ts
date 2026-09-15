import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
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
    count: jest.Mock;
  };
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
      count: jest.fn(),
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
      prisma.zone.create.mockResolvedValue({});

      await service.create(
        {
          name: 'Piso 1',
          // @ts-expect-error simulating a malicious/naive client payload
          restaurantId: 'restaurant-EVIL',
        },
        user,
      );

      const { data } = prisma.zone.create.mock.calls[0][0];
      expect(data.restaurantId).toBe(user.restaurantId);
    });

    it('defaults sortOrder to 0 when omitted', async () => {
      prisma.zone.create.mockResolvedValue({});

      await service.create({ name: 'Terraza' }, user);

      const { data } = prisma.zone.create.mock.calls[0][0];
      expect(data.sortOrder).toBe(0);
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

    it('updates the zone when it belongs to the caller restaurant', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
      });
      prisma.zone.update.mockResolvedValue({ id: 'z1', name: 'New name' });

      await service.update('z1', { name: 'New name' }, user);

      expect(prisma.zone.update).toHaveBeenCalledWith({
        where: { id: 'z1' },
        data: { name: 'New name', sortOrder: undefined },
      });
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
      expect(prisma.table.count).not.toHaveBeenCalled();
      expect(prisma.zone.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the zone still has tables assigned', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
      });
      prisma.table.count.mockResolvedValue(3);

      await expect(service.remove('z1', user)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.zone.delete).not.toHaveBeenCalled();
    });

    it('deletes the zone when it has no tables assigned', async () => {
      prisma.zone.findUnique.mockResolvedValue({
        id: 'z1',
        restaurantId: user.restaurantId,
      });
      prisma.table.count.mockResolvedValue(0);
      prisma.zone.delete.mockResolvedValue({ id: 'z1' });

      await service.remove('z1', user);

      expect(prisma.table.count).toHaveBeenCalledWith({
        where: { zoneId: 'z1', restaurantId: user.restaurantId },
      });
      expect(prisma.zone.delete).toHaveBeenCalledWith({ where: { id: 'z1' } });
    });
  });
});
