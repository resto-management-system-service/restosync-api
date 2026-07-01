import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderStatus, OrderType } from '@prisma/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';

type MockPrisma = {
  order: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  orderItem: {
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  menuItem: {
    findUnique: jest.Mock;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    orderItem: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    menuItem: {
      findUnique: jest.fn(),
    },
  };
}

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: MockPrisma;

  const orderId = 'order-1';
  const menuItemId = 'menu-item-1';

  const baseOrder = {
    id: orderId,
    status: OrderStatus.DRAFT,
    type: OrderType.DINE_IN,
  };

  const availableMenuItem = {
    id: menuItemId,
    name: 'Classic Cheeseburger',
    priceCents: 1200,
    available: true,
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new OrdersService(prisma as unknown as PrismaService);
  });

  describe('addItem', () => {
    it('adds an item with the correct price/name snapshot and recalculates totals', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.menuItem.findUnique.mockResolvedValue(availableMenuItem);
      prisma.orderItem.create.mockResolvedValue({});
      prisma.orderItem.findMany.mockResolvedValue([
        {
          priceCents: 1200,
          quantity: 2,
        },
      ]);
      prisma.order.update.mockResolvedValue({
        ...baseOrder,
        subtotalCents: 2400,
        taxCents: 0,
        totalCents: 2400,
      });

      const result = await service.addItem(orderId, {
        menuItemId,
        quantity: 2,
      });

      expect(prisma.orderItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId,
          menuItemId: availableMenuItem.id,
          nameSnapshot: availableMenuItem.name,
          priceCents: availableMenuItem.priceCents,
          quantity: 2,
          lineTotalCents: 2400,
        }),
      });
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: orderId },
          data: { subtotalCents: 2400, taxCents: 0, totalCents: 2400 },
        }),
      );
      expect(result.totalCents).toBe(2400);
    });

    it('throws NotFoundException if the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.addItem(orderId, { menuItemId, quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if the order is not DRAFT/PENDING', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.CONFIRMED,
      });

      await expect(
        service.addItem(orderId, { menuItemId, quantity: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if the menu item does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.menuItem.findUnique.mockResolvedValue(null);

      await expect(
        service.addItem(orderId, { menuItemId, quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if the menu item is not available', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.menuItem.findUnique.mockResolvedValue({
        ...availableMenuItem,
        available: false,
      });

      await expect(
        service.addItem(orderId, { menuItemId, quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateItemQuantity', () => {
    const orderItemId = 'order-item-1';

    it('updates the quantity and recalculates totals', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.orderItem.findFirst.mockResolvedValue({
        id: orderItemId,
        orderId,
        priceCents: 1200,
        quantity: 1,
      });
      prisma.orderItem.update.mockResolvedValue({});
      prisma.orderItem.findMany.mockResolvedValue([
        { priceCents: 1200, quantity: 3 },
      ]);
      prisma.order.update.mockResolvedValue({
        ...baseOrder,
        subtotalCents: 3600,
        taxCents: 0,
        totalCents: 3600,
      });

      const result = await service.updateItemQuantity(orderId, orderItemId, {
        quantity: 3,
      });

      expect(prisma.orderItem.update).toHaveBeenCalledWith({
        where: { id: orderItemId },
        data: { quantity: 3, lineTotalCents: 3600 },
      });
      expect(result.totalCents).toBe(3600);
    });

    it('throws BadRequestException if the order is not DRAFT/PENDING', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.PREPARING,
      });

      await expect(
        service.updateItemQuantity(orderId, orderItemId, { quantity: 2 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if the order item does not belong to the order', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.orderItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateItemQuantity(orderId, orderItemId, { quantity: 2 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeItem', () => {
    const orderItemId = 'order-item-1';

    it('removes the item and recalculates totals', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.orderItem.findFirst.mockResolvedValue({
        id: orderItemId,
        orderId,
        priceCents: 1200,
        quantity: 1,
      });
      prisma.orderItem.delete.mockResolvedValue({});
      prisma.orderItem.findMany.mockResolvedValue([]);
      prisma.order.update.mockResolvedValue({
        ...baseOrder,
        subtotalCents: 0,
        taxCents: 0,
        totalCents: 0,
      });

      const result = await service.removeItem(orderId, orderItemId);

      expect(prisma.orderItem.delete).toHaveBeenCalledWith({
        where: { id: orderItemId },
      });
      expect(result.totalCents).toBe(0);
    });

    it('throws BadRequestException if the order is not DRAFT/PENDING', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.CANCELLED,
      });

      await expect(service.removeItem(orderId, orderItemId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException if the order item is not found', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.orderItem.findFirst.mockResolvedValue(null);

      await expect(service.removeItem(orderId, orderItemId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('confirmOrder', () => {
    it('transitions DRAFT -> PENDING when the order has items', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.DRAFT,
        items: [{ id: 'item-1' }],
      });
      prisma.order.update.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.PENDING,
      });

      const result = await service.confirmOrder(orderId);

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: orderId },
          data: { status: OrderStatus.PENDING },
        }),
      );
      expect(result.status).toBe(OrderStatus.PENDING);
    });

    it('throws BadRequestException if the order has no items', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.DRAFT,
        items: [],
      });

      await expect(service.confirmOrder(orderId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException if the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.confirmOrder(orderId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('recalculateTotals', () => {
    it('computes subtotalCents/taxCents/totalCents from the order items', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { priceCents: 1200, quantity: 2 },
        { priceCents: 500, quantity: 1 },
      ]);
      prisma.order.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseOrder, ...data }),
      );

      const result = await (service as any).recalculateTotals(orderId);

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: { subtotalCents: 2900, taxCents: 0, totalCents: 2900 },
        include: { items: true },
      });
      expect(result.subtotalCents).toBe(2900);
      expect(result.totalCents).toBe(2900);
    });

    it('returns 0 totals for an order with no items', async () => {
      prisma.orderItem.findMany.mockResolvedValue([]);
      prisma.order.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseOrder, ...data }),
      );

      const result = await (service as any).recalculateTotals(orderId);

      expect(result.subtotalCents).toBe(0);
      expect(result.taxCents).toBe(0);
      expect(result.totalCents).toBe(0);
    });
  });
});
