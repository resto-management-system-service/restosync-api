import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

type MockPrisma = {
  user: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createMockPrisma(): MockPrisma {
  return {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

function buildUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'admin-1',
    email: 'admin@restosync.local',
    role: Role.ADMIN,
    restaurantId: 'restaurant-A',
    ...overrides,
  };
}

describe('UsersService', () => {
  let service: UsersService;
  let prisma: MockPrisma;
  const user = buildUser();

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
    service = new UsersService(prisma as unknown as PrismaService);
  });

  describe('findAll', () => {
    it('scopes the query to the caller restaurantId', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20 } as any, user);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { restaurantId: user.restaurantId },
        }),
      );
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { restaurantId: user.restaurantId },
      });
    });
  });

  describe('findOne', () => {
    it('returns the user (without restaurantId) when they belong to the caller restaurant', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'target-1',
        email: 'staff@restosync.local',
        firstName: null,
        lastName: null,
        role: Role.WAITER,
        active: true,
        createdAt: new Date('2026-01-01'),
        restaurantId: user.restaurantId,
      });

      const result = await service.findOne('target-1', user);

      expect(result).not.toHaveProperty('restaurantId');
      expect(result.id).toBe('target-1');
    });

    it('throws NotFoundException if the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne('target-1', user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException (404, NOT 403) for a user belonging to another restaurant', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'target-1',
        email: 'staff@other.local',
        firstName: null,
        lastName: null,
        role: Role.WAITER,
        active: true,
        createdAt: new Date('2026-01-01'),
        restaurantId: 'restaurant-B',
      });

      await expect(service.findOne('target-1', user)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
