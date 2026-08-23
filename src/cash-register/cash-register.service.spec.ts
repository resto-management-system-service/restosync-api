import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod, PaymentStatus, Role } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CashRegisterService } from './cash-register.service';

type MockPrisma = {
  cashRegisterSession: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  payment: {
    aggregate: jest.Mock;
    findMany: jest.Mock;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    cashRegisterSession: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

function buildUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'cashier@restosync.local',
    role: Role.CASHIER,
    restaurantId: 'restaurant-A',
    ...overrides,
  };
}

describe('CashRegisterService', () => {
  let service: CashRegisterService;
  let prisma: MockPrisma;

  const user = buildUser();
  const sessionId = 'session-1';

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new CashRegisterService(prisma as unknown as PrismaService);
  });

  describe('openSession', () => {
    it('creates a session with openingFloatCents, openedById and the caller restaurantId', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);
      const created = {
        id: sessionId,
        openedById: user.id,
        openingFloatCents: 10000,
        notes: null,
        closedAt: null,
        restaurantId: user.restaurantId,
      };
      prisma.cashRegisterSession.create.mockResolvedValue(created);

      const result = await service.openSession(
        { openingFloatCents: 10000 },
        user,
      );

      expect(prisma.cashRegisterSession.findFirst).toHaveBeenCalledWith({
        where: { closedAt: null, restaurantId: user.restaurantId },
      });
      expect(prisma.cashRegisterSession.create).toHaveBeenCalledWith({
        data: {
          openedById: user.id,
          openingFloatCents: 10000,
          notes: null,
          restaurantId: user.restaurantId,
        },
      });
      expect(result).toBe(created);
    });

    it("ignores a client-supplied restaurantId and always uses the caller's own", async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);
      prisma.cashRegisterSession.create.mockResolvedValue({});

      await service.openSession(
        {
          openingFloatCents: 10000,
          // @ts-expect-error simulating a malicious/naive client payload
          restaurantId: 'restaurant-EVIL',
        },
        user,
      );

      const { data } = prisma.cashRegisterSession.create.mock.calls[0][0];
      expect(data.restaurantId).toBe(user.restaurantId);
    });

    it('an open session in another restaurant does not block opening one here', async () => {
      // findFirst is itself scoped by restaurantId, so a session open in
      // a different restaurant is invisible to this check.
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);
      prisma.cashRegisterSession.create.mockResolvedValue({});

      await service.openSession({ openingFloatCents: 10000 }, user);

      expect(prisma.cashRegisterSession.findFirst).toHaveBeenCalledWith({
        where: { closedAt: null, restaurantId: 'restaurant-A' },
      });
    });

    it('throws BadRequestException if a session is already open in the caller restaurant', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue({
        id: sessionId,
        closedAt: null,
      });

      await expect(
        service.openSession({ openingFloatCents: 10000 }, user),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.cashRegisterSession.create).not.toHaveBeenCalled();
    });
  });

  describe('closeSession', () => {
    const activeSession = {
      id: sessionId,
      closedAt: null,
      notes: null,
    };

    it('computes expectedCents from SUCCEEDED payments and differenceCents, scoped by restaurantId', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
      prisma.payment.aggregate.mockResolvedValue({
        _sum: { amountCents: 5000 },
      });
      const updated = {
        ...activeSession,
        closedById: user.id,
        closedAt: new Date(),
        expectedCents: 5000,
        countedCents: 5200,
        differenceCents: 200,
      };
      prisma.cashRegisterSession.update.mockResolvedValue(updated);

      const result = await service.closeSession({ countedCents: 5200 }, user);

      expect(prisma.payment.aggregate).toHaveBeenCalledWith({
        _sum: { amountCents: true },
        where: {
          sessionId,
          status: PaymentStatus.SUCCEEDED,
          restaurantId: user.restaurantId,
        },
      });
      expect(prisma.cashRegisterSession.update).toHaveBeenCalledWith({
        where: { id: sessionId },
        data: expect.objectContaining({
          closedById: user.id,
          closedAt: expect.any(Date),
          expectedCents: 5000,
          countedCents: 5200,
          differenceCents: 200,
        }),
      });
      expect(result).toBe(updated);
    });

    it('records closedById and closedAt on the update payload', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
      prisma.cashRegisterSession.update.mockResolvedValue({});

      await service.closeSession({ countedCents: 0 }, user);

      const updateCall = prisma.cashRegisterSession.update.mock.calls[0][0];
      expect(updateCall.data.closedById).toBe(user.id);
      expect(updateCall.data.closedAt).toBeInstanceOf(Date);
    });

    it('throws if no active session exists in the caller restaurant', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);

      await expect(
        service.closeSession({ countedCents: 0 }, user),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.cashRegisterSession.update).not.toHaveBeenCalled();
    });
  });

  describe('getSessionSummary', () => {
    it('returns correct totalSalesCents and ticketCount when the session belongs to the caller restaurant', async () => {
      prisma.cashRegisterSession.findUnique.mockResolvedValue({
        id: sessionId,
        restaurantId: user.restaurantId,
      });
      prisma.payment.findMany.mockResolvedValue([
        { method: PaymentMethod.CASH, amountCents: 1000 },
        { method: PaymentMethod.CARD, amountCents: 2000 },
        { method: PaymentMethod.CASH, amountCents: 500 },
      ]);

      const result = await service.getSessionSummary(sessionId, user);

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: {
          sessionId,
          status: PaymentStatus.SUCCEEDED,
          restaurantId: user.restaurantId,
        },
      });
      expect(result.summary.totalSalesCents).toBe(3500);
      expect(result.summary.ticketCount).toBe(3);
      expect(result.summary.byMethod).toEqual({
        CASH: 1500,
        CARD: 2000,
      });
    });

    it('byMethod breakdown only includes methods with amount > 0', async () => {
      prisma.cashRegisterSession.findUnique.mockResolvedValue({
        id: sessionId,
        restaurantId: user.restaurantId,
      });
      prisma.payment.findMany.mockResolvedValue([]);

      const result = await service.getSessionSummary(sessionId, user);

      expect(result.summary.totalSalesCents).toBe(0);
      expect(result.summary.ticketCount).toBe(0);
      expect(result.summary.byMethod).toEqual({});
    });

    it('throws NotFoundException if the session does not exist', async () => {
      prisma.cashRegisterSession.findUnique.mockResolvedValue(null);

      await expect(service.getSessionSummary(sessionId, user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException (not the session) for a session belonging to another restaurant', async () => {
      prisma.cashRegisterSession.findUnique.mockResolvedValue({
        id: sessionId,
        restaurantId: 'restaurant-B',
      });

      await expect(service.getSessionSummary(sessionId, user)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.payment.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentSummary', () => {
    it('scopes the active-session lookup by the caller restaurantId', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue({
        id: sessionId,
        restaurantId: user.restaurantId,
      });
      prisma.cashRegisterSession.findUnique.mockResolvedValue({
        id: sessionId,
        restaurantId: user.restaurantId,
      });
      prisma.payment.findMany.mockResolvedValue([]);

      await service.getCurrentSummary(user);

      expect(prisma.cashRegisterSession.findFirst).toHaveBeenCalledWith({
        where: { closedAt: null, restaurantId: user.restaurantId },
        orderBy: { openedAt: 'desc' },
      });
    });

    it('throws NotFoundException when no active session exists for the caller restaurant', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);

      await expect(service.getCurrentSummary(user)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
