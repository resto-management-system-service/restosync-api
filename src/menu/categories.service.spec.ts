import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_RESTAURANT_ID } from '../common/constants/tenancy';
import { CategoriesService } from './categories.service';

type MockPrisma = {
  category: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    category: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
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

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: MockPrisma;
  const user = buildUser();

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new CategoriesService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('sets restaurantId from the caller, never from the client', async () => {
      prisma.category.create.mockResolvedValue({});

      await service.create(
        {
          name: 'Burgers',
          // Simulates a malicious/naive client payload.
          // @ts-expect-error not part of CreateCategoryDto
          restaurantId: 'restaurant-EVIL',
        },
        user,
      );

      const { data } = prisma.category.create.mock.calls[0][0];
      expect(data.restaurantId).toBe(user.restaurantId);
    });
  });

  describe('findAll (public endpoint)', () => {
    it('scopes to the default restaurant (no authenticated caller for public browsing)', async () => {
      prisma.category.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            restaurantId: DEFAULT_RESTAURANT_ID,
          }),
        }),
      );
    });
  });

  describe('update / remove', () => {
    it('throws NotFoundException (404, NOT 403) when updating a category belonging to another restaurant', async () => {
      prisma.category.findUnique.mockResolvedValue({
        id: 'cat-1',
        restaurantId: 'restaurant-B',
      });

      await expect(
        service.update('cat-1', { name: 'New name' }, user),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException (404, NOT 403) when removing a category belonging to another restaurant', async () => {
      prisma.category.findUnique.mockResolvedValue({
        id: 'cat-1',
        restaurantId: 'restaurant-B',
      });

      await expect(service.remove('cat-1', user)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('updates successfully when the category belongs to the caller restaurant', async () => {
      prisma.category.findUnique.mockResolvedValue({
        id: 'cat-1',
        restaurantId: user.restaurantId,
      });
      prisma.category.update.mockResolvedValue({ id: 'cat-1', name: 'New' });

      const result = await service.update('cat-1', { name: 'New' }, user);

      expect(result).toEqual({ id: 'cat-1', name: 'New' });
    });
  });
});
