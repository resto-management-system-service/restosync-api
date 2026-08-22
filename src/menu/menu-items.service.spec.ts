import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_RESTAURANT_ID } from '../common/constants/tenancy';
import { MenuItemsService } from './menu-items.service';

type MockPrisma = {
  menuItem: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  orderItem: {
    count: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createMockPrisma(): MockPrisma {
  return {
    menuItem: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    orderItem: {
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

function buildUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'admin@restosync.local',
    role: Role.ADMIN,
    restaurantId: 'restaurant-A',
    ...overrides,
  };
}

describe('MenuItemsService', () => {
  let service: MenuItemsService;
  let prisma: MockPrisma;
  const user = buildUser();

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
    service = new MenuItemsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('sets restaurantId from the caller, never from the client', async () => {
      prisma.menuItem.create.mockResolvedValue({});

      await service.create(
        {
          name: 'Cheeseburger',
          priceCents: 1200,
          categoryId: 'cat-1',
          // @ts-expect-error simulating a malicious/naive client payload
          restaurantId: 'restaurant-EVIL',
        },
        user,
      );

      const { data } = prisma.menuItem.create.mock.calls[0][0];
      expect(data.restaurantId).toBe(user.restaurantId);
    });
  });

  describe('findAll (public endpoint)', () => {
    it('scopes to the default restaurant (no authenticated caller for public browsing)', async () => {
      prisma.menuItem.findMany.mockResolvedValue([]);
      prisma.menuItem.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20 } as any);

      expect(prisma.menuItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            restaurantId: DEFAULT_RESTAURANT_ID,
          }),
        }),
      );
    });
  });

  describe('update / remove / deactivate', () => {
    it('throws NotFoundException (404, NOT 403) when updating an item belonging to another restaurant', async () => {
      prisma.menuItem.findUnique.mockResolvedValue({
        id: 'item-1',
        restaurantId: 'restaurant-B',
      });

      await expect(
        service.update('item-1', { name: 'New name' }, user),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.menuItem.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException (404, NOT 403) when removing an item belonging to another restaurant', async () => {
      prisma.menuItem.findUnique.mockResolvedValue({
        id: 'item-1',
        restaurantId: 'restaurant-B',
      });

      await expect(service.remove('item-1', user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException (404, NOT 403) when deactivating an item belonging to another restaurant', async () => {
      prisma.menuItem.findUnique.mockResolvedValue({
        id: 'item-1',
        restaurantId: 'restaurant-B',
      });

      await expect(service.deactivate('item-1', user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates successfully when the item belongs to the caller restaurant', async () => {
      prisma.menuItem.findUnique.mockResolvedValue({
        id: 'item-1',
        restaurantId: user.restaurantId,
      });
      prisma.menuItem.update.mockResolvedValue({ id: 'item-1', name: 'New' });

      const result = await service.update('item-1', { name: 'New' }, user);

      expect(result).toEqual({ id: 'item-1', name: 'New' });
    });
  });
});
