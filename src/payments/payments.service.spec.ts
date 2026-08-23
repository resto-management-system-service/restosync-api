import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Role,
  TableStatus,
} from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
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
    upsert: jest.Mock;
  };
  inventoryItem: {
    findFirst: jest.Mock;
  };
  table: {
    update: jest.Mock;
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
      upsert: jest.fn(),
    },
    inventoryItem: {
      findFirst: jest.fn(),
    },
    table: {
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

function buildUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'staff@restosync.local',
    role: Role.STAFF,
    restaurantId: 'restaurant-A',
    ...overrides,
  };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: MockPrisma;
  let inventoryService: { adjust: jest.Mock };
  let txOrderUpdate: jest.Mock;
  let txPaymentCreate: jest.Mock;
  let txTableUpdate: jest.Mock;

  const orderId = 'order-1';
  const sessionId = 'session-1';
  const user = buildUser();

  const baseOrder = {
    id: orderId,
    number: 'ORD-001',
    status: OrderStatus.PENDING,
    totalCents: 1200,
    currency: 'usd',
    restaurantId: user.restaurantId,
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
    txTableUpdate = jest.fn().mockResolvedValue({});

    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        order: { update: txOrderUpdate },
        payment: { create: txPaymentCreate },
        table: { update: txTableUpdate },
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

  describe('createIntent', () => {
    it('throws NotFoundException (not the order) for an order belonging to another restaurant', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        restaurantId: 'restaurant-B',
      });

      await expect(service.createIntent(orderId, user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('sets restaurantId from the caller, never from the client, on the created payment', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      const gateway: PaymentGateway = {
        createPaymentIntent: jest
          .fn()
          .mockResolvedValue({ id: 'pi_123', clientSecret: 'secret' }),
      } as unknown as PaymentGateway;
      service = new PaymentsService(
        prisma as unknown as PrismaService,
        {} as unknown as OrdersService,
        inventoryService as unknown as InventoryService,
        gateway,
      );

      await service.createIntent(orderId, user);

      const { create } = prisma.payment.upsert.mock.calls[0][0];
      expect(create.restaurantId).toBe(user.restaurantId);
    });
  });

  describe('checkout', () => {
    it('creates a CASH payment with correct method and amountCents, scoped to the caller restaurant', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
      prisma.payment.findFirst.mockResolvedValue(null);

      await service.checkout(
        {
          orderId,
          method: PaymentMethod.CASH,
          amountPaidCents: 1200,
        },
        user,
      );

      expect(prisma.cashRegisterSession.findFirst).toHaveBeenCalledWith({
        where: { closedAt: null, restaurantId: user.restaurantId },
        orderBy: { openedAt: 'desc' },
      });
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
            restaurantId: user.restaurantId,
          }),
        }),
      );
    });

    it("ignores a client-supplied restaurantId and always uses the caller's own", async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
      prisma.payment.findFirst.mockResolvedValue(null);

      await service.checkout(
        {
          orderId,
          method: PaymentMethod.CASH,
          amountPaidCents: 1200,
          // @ts-expect-error simulating a malicious/naive client payload
          restaurantId: 'restaurant-EVIL',
        },
        user,
      );

      const { data } = txPaymentCreate.mock.calls[0][0];
      expect(data.restaurantId).toBe(user.restaurantId);
    });

    it('sets the table back to AVAILABLE after successful payment', async () => {
      const orderWithTable = { ...baseOrder, tableId: 'table-1' };
      prisma.order.findUnique.mockResolvedValue(orderWithTable);
      prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
      prisma.payment.findFirst.mockResolvedValue(null);

      await service.checkout(
        {
          orderId,
          method: PaymentMethod.CASH,
          amountPaidCents: 1200,
        },
        user,
      );

      expect(txTableUpdate).toHaveBeenCalledWith({
        where: { id: 'table-1' },
        data: { status: TableStatus.AVAILABLE },
      });
    });

    it('does not attempt to release a table for orders without a tableId', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
      prisma.payment.findFirst.mockResolvedValue(null);

      await service.checkout(
        {
          orderId,
          method: PaymentMethod.CASH,
          amountPaidCents: 1200,
        },
        user,
      );

      expect(txTableUpdate).not.toHaveBeenCalled();
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
        user,
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
          user,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.checkout(
          { orderId, method: PaymentMethod.CASH, amountPaidCents: 1200 },
          user,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException (not the order, not 403) for an order belonging to another restaurant', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        restaurantId: 'restaurant-B',
      });

      await expect(
        service.checkout(
          { orderId, method: PaymentMethod.CASH, amountPaidCents: 1200 },
          user,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.cashRegisterSession.findFirst).not.toHaveBeenCalled();
    });

    it('throws BadRequestException if no active session', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);

      await expect(
        service.checkout(
          { orderId, method: PaymentMethod.CASH, amountPaidCents: 1200 },
          user,
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
          user,
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
        user,
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
          user,
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
      it('decrements linked inventory by the correct quantity, scoped by the order restaurantId', async () => {
        prisma.order.findUnique.mockResolvedValue(baseOrder);
        prisma.cashRegisterSession.findFirst.mockResolvedValue(activeSession);
        prisma.payment.findFirst.mockResolvedValue(null);
        prisma.inventoryItem.findFirst.mockResolvedValue({
          id: 'inv-item-1',
          menuItemId: 'menu-item-1',
        });

        await service.checkout(
          { orderId, method: PaymentMethod.CASH, amountPaidCents: 1200 },
          user,
        );

        expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith({
          where: {
            menuItemId: 'menu-item-1',
            restaurantId: baseOrder.restaurantId,
          },
        });
        expect(inventoryService.adjust).toHaveBeenCalledWith(
          'inv-item-1',
          {
            type: 'SALE',
            quantityDelta: -2,
            reason: `Sale from order ${baseOrder.number}`,
          },
          user.id,
          baseOrder.restaurantId,
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
            user,
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
          user,
        );

        expect(result).toEqual({ id: 'payment-1' });
        expect(inventoryService.adjust).toHaveBeenCalled();
      });
    });
  });
});
