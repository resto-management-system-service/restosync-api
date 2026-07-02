import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
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

describe('CashRegisterService', () => {
  let service: CashRegisterService;
  let prisma: MockPrisma;

  const actorId = 'user-1';
  const sessionId = 'session-1';

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new CashRegisterService(prisma as unknown as PrismaService);
  });

  describe('openSession', () => {
    it('creates a session with openingFloatCents and openedById', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);
      const created = {
        id: sessionId,
        openedById: actorId,
        openingFloatCents: 10000,
        notes: null,
        closedAt: null,
      };
      prisma.cashRegisterSession.create.mockResolvedValue(created);

      const result = await service.openSession(
        { openingFloatCents: 10000 },
        actorId,
      );

      expect(prisma.cashRegisterSession.create).toHaveBeenCalledWith({
        data: {
          openedById: actorId,
          openingFloatCents: 10000,
          notes: null,
        },
      });
      expect(result).toBe(created);
    });

    it('throws BadRequestException if a session is already open', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue({
        id: sessionId,
        closedAt: null,
      });

      await expect(
        service.openSession({ openingFloatCents: 10000 }, actorId),
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

    it('computes expectedCents from SUCCEEDED payments and differenceCents', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
      prisma.payment.aggregate.mockResolvedValue({
        _sum: { amountCents: 5000 },
      });
      const updated = {
        ...activeSession,
        closedById: actorId,
        closedAt: new Date(),
        expectedCents: 5000,
        countedCents: 5200,
        differenceCents: 200,
      };
      prisma.cashRegisterSession.update.mockResolvedValue(updated);

      const result = await service.closeSession(
        { countedCents: 5200 },
        actorId,
      );

      expect(prisma.payment.aggregate).toHaveBeenCalledWith({
        _sum: { amountCents: true },
        where: { sessionId, status: PaymentStatus.SUCCEEDED },
      });
      expect(prisma.cashRegisterSession.update).toHaveBeenCalledWith({
        where: { id: sessionId },
        data: expect.objectContaining({
          closedById: actorId,
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

      await service.closeSession({ countedCents: 0 }, actorId);

      const updateCall = prisma.cashRegisterSession.update.mock.calls[0][0];
      expect(updateCall.data.closedById).toBe(actorId);
      expect(updateCall.data.closedAt).toBeInstanceOf(Date);
    });

    it('throws if no active session exists', async () => {
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);

      await expect(
        service.closeSession({ countedCents: 0 }, actorId),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.cashRegisterSession.update).not.toHaveBeenCalled();
    });
  });

  describe('getSessionSummary', () => {
    it('returns correct totalSalesCents and ticketCount', async () => {
      prisma.cashRegisterSession.findUnique.mockResolvedValue({
        id: sessionId,
      });
      prisma.payment.findMany.mockResolvedValue([
        { method: PaymentMethod.CASH, amountCents: 1000 },
        { method: PaymentMethod.CARD, amountCents: 2000 },
        { method: PaymentMethod.CASH, amountCents: 500 },
      ]);

      const result = await service.getSessionSummary(sessionId);

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
      });
      prisma.payment.findMany.mockResolvedValue([]);

      const result = await service.getSessionSummary(sessionId);

      expect(result.summary.totalSalesCents).toBe(0);
      expect(result.summary.ticketCount).toBe(0);
      expect(result.summary.byMethod).toEqual({});
    });

    it('throws NotFoundException if the session does not exist', async () => {
      prisma.cashRegisterSession.findUnique.mockResolvedValue(null);

      await expect(service.getSessionSummary(sessionId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
