import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
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
  inventoryItem: {
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
    inventoryItem: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: MockPrisma;
  let inventoryService: { adjust: jest.Mock };
  let txOrderUpdate: jest.Mock;
  let txPaymentCreate: jest.Mock;

  const orderId = 'order-1';
  const sessionId = 'session-1';
  const actorId = 'user-1';

  const baseOrder = {
    id: orderId,
    number: 'ORD-001',
    status: OrderStatus.PENDING,
    totalCents: 1200,
    currency: 'usd',
    items: [
      {
        id: 'item-1',
        orderId,
        menuItemId: 'menu-item-1',
        quantity: 2,
      },
    ],
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

    inventoryService = { adjust: jest.fn().mockResolvedValue({}) };

    service = new PaymentsService(
      prisma as unknown as PrismaService,
      {} as unknown as OrdersService,
      inventoryService as unknown as InventoryService,
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

    describe('inventory decrement hook (#51)', () => {
      it('decrements linked inventory by the correct quantity', async () => {
        prisma.order.findUnique.mockResolvedValue(baseOrder);
        prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
        prisma.payment.findFirst.mockResolvedValue(null);
        prisma.inventoryItem.findFirst.mockResolvedValue({
          id: 'inv-item-1',
          menuItemId: 'menu-item-1',
        });

        await service.checkout(
          { orderId, method: PaymentMethod.CASH, amountPaidCents: 1200 },
          actorId,
        );

        expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith({
          where: { menuItemId: 'menu-item-1' },
        });
        expect(inventoryService.adjust).toHaveBeenCalledWith(
          'inv-item-1',
          {
            type: 'SALE',
            quantityDelta: -2,
            reason: `Sale from order ${baseOrder.number}`,
          },
          actorId,
        );
      });

      it('does not fail when an OrderItem has no linked InventoryItem', async () => {
        prisma.order.findUnique.mockResolvedValue(baseOrder);
        prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
        prisma.payment.findFirst.mockResolvedValue(null);
        prisma.inventoryItem.findFirst.mockResolvedValue(null);

        await expect(
          service.checkout(
            { orderId, method: PaymentMethod.CASH, amountPaidCents: 1200 },
            actorId,
          ),
        ).resolves.toBeDefined();

        expect(inventoryService.adjust).not.toHaveBeenCalled();
      });

      it('does not fail even if the inventory decrement throws internally', async () => {
        prisma.order.findUnique.mockResolvedValue(baseOrder);
        prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
        prisma.payment.findFirst.mockResolvedValue(null);
        prisma.inventoryItem.findFirst.mockResolvedValue({
          id: 'inv-item-1',
          menuItemId: 'menu-item-1',
        });
        inventoryService.adjust.mockRejectedValue(new Error('boom'));

        const result = await service.checkout(
          { orderId, method: PaymentMethod.CASH, amountPaidCents: 1200 },
          actorId,
        );

        expect(result).toEqual({ id: 'payment-1' });
        expect(inventoryService.adjust).toHaveBeenCalled();
      });
    });
  });
});
