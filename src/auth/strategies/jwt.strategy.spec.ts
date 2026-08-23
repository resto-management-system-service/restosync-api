import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

type MockPrisma = {
  user: { findUnique: jest.Mock };
};

function createMockPrisma(): MockPrisma {
  return { user: { findUnique: jest.fn() } };
}

function createMockConfig(): ConfigService {
  return {
    get: jest.fn().mockReturnValue('access-secret'),
  } as unknown as ConfigService;
}

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    strategy = new JwtStrategy(
      createMockConfig(),
      prisma as unknown as PrismaService,
    );
  });

  describe('validate', () => {
    it('correctly extracts restaurantId from a valid token payload', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'admin@restosync.local',
        role: Role.ADMIN,
        active: true,
        restaurantId: 'restaurant-123',
      });

      const result = await strategy.validate({
        sub: 'user-1',
        email: 'admin@restosync.local',
        role: Role.ADMIN,
        restaurantId: 'restaurant-123',
      });

      expect(result).toEqual({
        id: 'user-1',
        email: 'admin@restosync.local',
        role: Role.ADMIN,
        restaurantId: 'restaurant-123',
      });
    });

    it('throws when the user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        strategy.validate({
          sub: 'ghost',
          email: 'ghost@restosync.local',
          role: Role.CUSTOMER,
          restaurantId: 'restaurant-123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws when the user is deactivated', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-2',
        email: 'inactive@restosync.local',
        role: Role.STAFF,
        active: false,
        restaurantId: 'restaurant-123',
      });

      await expect(
        strategy.validate({
          sub: 'user-2',
          email: 'inactive@restosync.local',
          role: Role.STAFF,
          restaurantId: 'restaurant-123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
