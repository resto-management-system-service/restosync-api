import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_RESTAURANT_ID } from '../common/constants/tenancy';
import { AuthService } from './auth.service';

type MockPrisma = {
  user: {
    create: jest.Mock;
    findUnique: jest.Mock;
  };
  session: {
    create: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

function createMockJwt() {
  return {
    signAsync: jest.fn().mockResolvedValue('signed-token'),
    verifyAsync: jest.fn(),
    decode: jest
      .fn()
      .mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  };
}

function createMockConfig() {
  const values: Record<string, string> = {
    'jwt.secret': 'access-secret',
    'jwt.refreshSecret': 'refresh-secret',
    'jwt.expiresIn': '15m',
    'jwt.refreshExpiresIn': '7d',
  };
  return { get: jest.fn((key: string) => values[key]) };
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'admin@restosync.local',
    passwordHash: 'irrelevant-in-most-tests',
    firstName: 'Resto',
    lastName: 'Admin',
    role: Role.ADMIN,
    active: true,
    restaurantId: 'restaurant-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: MockPrisma;
  let jwt: ReturnType<typeof createMockJwt>;
  let config: ReturnType<typeof createMockConfig>;

  beforeEach(() => {
    prisma = createMockPrisma();
    jwt = createMockJwt();
    config = createMockConfig();
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
    );
  });

  describe('register', () => {
    it('creates a new User with a valid restaurantId assigned', async () => {
      prisma.user.create.mockResolvedValue(
        buildUser({ role: Role.CUSTOMER, restaurantId: DEFAULT_RESTAURANT_ID }),
      );

      await service.register({
        email: 'new-customer@restosync.local',
        password: 'Secret123!',
      });

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      const { data } = prisma.user.create.mock.calls[0][0];
      expect(data.restaurantId).toBeDefined();
      expect(data.restaurantId).not.toBeNull();
      expect(data.restaurantId).toBe(DEFAULT_RESTAURANT_ID);
    });

    it('issues tokens for the newly created user', async () => {
      prisma.user.create.mockResolvedValue(
        buildUser({ role: Role.CUSTOMER, restaurantId: DEFAULT_RESTAURANT_ID }),
      );

      const tokens = await service.register({
        email: 'new-customer@restosync.local',
        password: 'Secret123!',
      });

      expect(tokens).toEqual({
        accessToken: 'signed-token',
        refreshToken: 'signed-token',
      });
      expect(prisma.session.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('login', () => {
    it('issues a JWT containing the correct restaurantId', async () => {
      const passwordHash = await bcrypt.hash('Secret123!', 10);
      const user = buildUser({ passwordHash, restaurantId: 'restaurant-abc' });
      prisma.user.findUnique.mockResolvedValue(user);

      await service.login({ email: user.email, password: 'Secret123!' });

      expect(jwt.signAsync).toHaveBeenCalledTimes(2);
      const [accessPayload] = jwt.signAsync.mock.calls[0];
      const [refreshPayload] = jwt.signAsync.mock.calls[1];

      expect(accessPayload).toEqual({
        sub: user.id,
        email: user.email,
        role: user.role,
        restaurantId: user.restaurantId,
      });
      expect(refreshPayload).toEqual({
        sub: user.id,
        email: user.email,
        role: user.role,
        restaurantId: user.restaurantId,
      });
    });

    it('rejects invalid credentials when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@restosync.local', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects invalid credentials when the password does not match', async () => {
      const passwordHash = await bcrypt.hash('CorrectPassword1!', 10);
      prisma.user.findUnique.mockResolvedValue(buildUser({ passwordHash }));

      await expect(
        service.login({
          email: 'admin@restosync.local',
          password: 'WrongPassword1!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
