import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGateway } from './gateway/payment-gateway.interface';
import { PaymentsService } from './payments.service';

type MockPrisma = {
  order: {
    findUnique: jest.Mock;
  };
  cashRegisterSession: {
    findFirst: jest.Mock;
  };
  payment: {
    findFirst: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createMockPrisma(): MockPrisma {
  return {
    order: {
      findUnique: jest.fn(),
    },
    cashRegisterSession: {
      findFirst: jest.fn(),
    },
    payment: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: MockPrisma;
  let txOrderUpdate: jest.Mock;
  let txPaymentCreate: jest.Mock;

  const orderId = 'order-1';
  const sessionId = 'session-1';
  const actorId = 'user-1';

  const baseOrder = {
    id: orderId,
    status: OrderStatus.PENDING,
    totalCents: 1200,
    currency: 'usd',
  };

  const activeSession = {
    id: sessionId,
    closedAt: null,
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    txOrderUpdate = jest.fn().mockResolvedValue({});
    txPaymentCreate = jest.fn().mockResolvedValue({ id: 'payment-1' });

    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        order: { update: txOrderUpdate },
        payment: { create: txPaymentCreate },
      }),
    );

    service = new PaymentsService(
      prisma as unknown as PrismaService,
      {} as unknown as OrdersService,
      {} as unknown as PaymentGateway,
    );
  });

  describe('checkout', () => {
    it('creates a CASH payment with correct method and amountCents', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
      prisma.payment.findFirst.mockResolvedValue(null);

      await service.checkout(
        {
          orderId,
          method: PaymentMethod.CASH,
          amountPaidCents: 1200,
        },
        actorId,
      );

      expect(txOrderUpdate).toHaveBeenCalledWith({
        where: { id: orderId },
        data: { status: OrderStatus.CONFIRMED },
      });
      expect(txPaymentCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId,
            method: PaymentMethod.CASH,
            amountCents: 1200,
            paidCents: 1200,
            changeCents: 0,
            status: PaymentStatus.SUCCEEDED,
            sessionId: activeSession.id,
            providerRef: null,
          }),
        }),
      );
    });

    it('computes changeCents correctly (amountPaid - total)', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
      prisma.payment.findFirst.mockResolvedValue(null);

      await service.checkout(
        {
          orderId,
          method: PaymentMethod.CASH,
          amountPaidCents: 1500,
        },
        actorId,
      );

      expect(txPaymentCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paidCents: 1500,
            changeCents: 300,
          }),
        }),
      );
    });

    it('throws BadRequestException if order not PENDING', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.CONFIRMED,
      });

      await expect(
        service.checkout(
          { orderId, method: PaymentMethod.CASH, amountPaidCents: 1200 },
          actorId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.checkout(
          { orderId, method: PaymentMethod.CASH, amountPaidCents: 1200 },
          actorId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if no active session', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);

      await expect(
        service.checkout(
          { orderId, method: PaymentMethod.CASH, amountPaidCents: 1200 },
          actorId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if amountPaidCents < totalCents (CASH)', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(
        service.checkout(
          { orderId, method: PaymentMethod.CASH, amountPaidCents: 1000 },
          actorId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns existing payment if already SUCCEEDED (idempotency)', async () => {
      const existingPayment = {
        id: 'payment-existing',
        orderId,
        status: PaymentStatus.SUCCEEDED,
        order: baseOrder,
      };
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
      prisma.payment.findFirst.mockResolvedValue(existingPayment);

      const result = await service.checkout(
        { orderId, method: PaymentMethod.CASH, amountPaidCents: 1200 },
        actorId,
      );

      expect(result).toBe(existingPayment);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does NOT validate amountPaidCents for CARD/TRANSFER methods', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(
        service.checkout(
          { orderId, method: PaymentMethod.CARD, amountPaidCents: 0 },
          actorId,
        ),
      ).resolves.toBeDefined();

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(txPaymentCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            method: PaymentMethod.CARD,
            paidCents: 0,
          }),
        }),
      );
    });
  });
});
