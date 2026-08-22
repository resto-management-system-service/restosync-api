import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, OrderType, TableStatus } from '@prisma/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

type MockPrisma = {
  order: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
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
    findMany: jest.Mock;
  };
  table: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createMockPrisma(): MockPrisma {
  return {
    order: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
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
      findMany: jest.fn(),
    },
    table: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

type MockAuditService = {
  log: jest.Mock;
  findByEntity: jest.Mock;
};

function createMockAuditService(): MockAuditService {
  return {
    log: jest.fn().mockResolvedValue(undefined),
    findByEntity: jest.fn(),
  };
}

type MockConfigService = {
  get: jest.Mock;
};

type MockRealtimeGateway = {
  emitStatusChanged: jest.Mock;
  emitTotalsChanged: jest.Mock;
};

function createMockRealtimeGateway(): MockRealtimeGateway {
  return {
    emitStatusChanged: jest.fn().mockResolvedValue(undefined),
    emitTotalsChanged: jest.fn().mockResolvedValue(undefined),
  };
}

// Defaults tax.rate to 0 so pre-existing tests (written before #7 added
// configurable tax) keep asserting the same totals. Individual tests can
// override via `config.get.mockImplementation(...)` to exercise non-zero
// tax rates.
function createMockConfigService(): MockConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'tax.rate') {
        return 0;
      }
      return undefined;
    }),
  };
}

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: MockPrisma;
  let auditService: MockAuditService;
  let config: MockConfigService;
  let realtimeGateway: MockRealtimeGateway;

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
    auditService = createMockAuditService();
    config = createMockConfigService();
    realtimeGateway = createMockRealtimeGateway();
    service = new OrdersService(
      prisma as unknown as PrismaService,
      auditService as unknown as AuditService,
      config as unknown as ConfigService,
      realtimeGateway as unknown as RealtimeGateway,
    );
  });

  describe('create', () => {
    const tableId = 'table-1';
    let txOrderCreate: jest.Mock;
    let txTableUpdate: jest.Mock;

    beforeEach(() => {
      txOrderCreate = jest.fn().mockResolvedValue({
        id: orderId,
        status: OrderStatus.DRAFT,
      });
      txTableUpdate = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation(async (callback) =>
        callback({
          order: { create: txOrderCreate },
          table: { update: txTableUpdate },
        }),
      );
      prisma.menuItem.findMany.mockResolvedValue([availableMenuItem]);
      prisma.orderItem.findMany.mockResolvedValue([
        { priceCents: 1200, quantity: 1 },
      ]);
      prisma.order.update.mockResolvedValue({
        ...baseOrder,
        subtotalCents: 1200,
        taxCents: 0,
        totalCents: 1200,
      });
    });

    const dto = {
      type: OrderType.DINE_IN,
      tableId: 'table-1',
      items: [{ menuItemId, quantity: 1 }],
    };

    it('creates a new order and sets the table OCCUPIED when the table is AVAILABLE', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: tableId,
        status: TableStatus.AVAILABLE,
      });

      const result = await service.create(dto as any, 'user-1');

      expect(prisma.table.findUnique).toHaveBeenCalledWith({
        where: { id: tableId },
      });
      expect(txOrderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tableId }),
        }),
      );
      expect(txTableUpdate).toHaveBeenCalledWith({
        where: { id: tableId },
        data: { status: TableStatus.OCCUPIED },
      });
      expect(result.totalCents).toBe(1200);
    });

    it('returns the existing active order instead of creating a duplicate when the table is OCCUPIED', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: tableId,
        status: TableStatus.OCCUPIED,
      });
      const existingOrder = {
        id: 'existing-order',
        status: OrderStatus.PENDING,
        tableId,
      };
      prisma.order.findFirst.mockResolvedValue(existingOrder);

      const result = await service.create(dto as any, 'user-1');

      expect(result).toBe(existingOrder);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(txOrderCreate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a nonexistent tableId', async () => {
      prisma.table.findUnique.mockResolvedValue(null);

      await expect(service.create(dto as any, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('emits order.status_changed with the correct payload after a successful transition', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.PENDING,
      });
      prisma.order.update.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.CONFIRMED,
      });

      await service.updateStatus(orderId, OrderStatus.CONFIRMED);

      expect(realtimeGateway.emitStatusChanged).toHaveBeenCalledWith({
        orderId,
        status: OrderStatus.CONFIRMED,
        previousStatus: OrderStatus.PENDING,
      });
    });

    it('still completes the status update when the gateway emit throws', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.PENDING,
      });
      prisma.order.update.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.CONFIRMED,
      });
      realtimeGateway.emitStatusChanged.mockImplementation(() => {
        throw new Error('socket server unavailable');
      });

      const result = await service.updateStatus(orderId, OrderStatus.CONFIRMED);

      expect(result.status).toBe(OrderStatus.CONFIRMED);
      expect(realtimeGateway.emitStatusChanged).toHaveBeenCalled();
    });

    it('throws BadRequestException for an invalid transition and does not emit', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.COMPLETED,
      });

      await expect(
        service.updateStatus(orderId, OrderStatus.CONFIRMED),
      ).rejects.toThrow(BadRequestException);
      expect(realtimeGateway.emitStatusChanged).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus(orderId, OrderStatus.CONFIRMED),
      ).rejects.toThrow(NotFoundException);
    });
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

    it('emits order.totals_changed with the correct payload via recalculateTotals', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.menuItem.findUnique.mockResolvedValue(availableMenuItem);
      prisma.orderItem.create.mockResolvedValue({});
      prisma.orderItem.findMany.mockResolvedValue([
        { priceCents: 1200, quantity: 2 },
      ]);
      prisma.order.update.mockResolvedValue({
        ...baseOrder,
        subtotalCents: 2400,
        taxCents: 0,
        totalCents: 2400,
      });

      await service.addItem(orderId, { menuItemId, quantity: 2 });

      expect(realtimeGateway.emitTotalsChanged).toHaveBeenCalledWith({
        orderId,
        subtotalCents: 2400,
        taxCents: 0,
        discountCents: 0,
        totalCents: 2400,
      });
    });

    it('still completes the operation when the gateway emit throws', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.menuItem.findUnique.mockResolvedValue(availableMenuItem);
      prisma.orderItem.create.mockResolvedValue({});
      prisma.orderItem.findMany.mockResolvedValue([
        { priceCents: 1200, quantity: 2 },
      ]);
      prisma.order.update.mockResolvedValue({
        ...baseOrder,
        subtotalCents: 2400,
        taxCents: 0,
        totalCents: 2400,
      });
      realtimeGateway.emitTotalsChanged.mockImplementation(() => {
        throw new Error('socket server unavailable');
      });

      const result = await service.addItem(orderId, {
        menuItemId,
        quantity: 2,
      });

      expect(result.totalCents).toBe(2400);
      expect(realtimeGateway.emitTotalsChanged).toHaveBeenCalled();
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

    it('computes a non-zero taxCents when config("tax.rate") returns a non-zero rate', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'tax.rate' ? 0.18 : undefined,
      );
      prisma.orderItem.findMany.mockResolvedValue([
        { priceCents: 1000, quantity: 1 },
      ]);
      prisma.order.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseOrder, ...data }),
      );

      const result = await (service as any).recalculateTotals(orderId);

      expect(config.get).toHaveBeenCalledWith('tax.rate');
      // 1000 * 0.18 = 180
      expect(result.taxCents).toBe(180);
      expect(result.subtotalCents).toBe(1000);
      expect(result.totalCents).toBe(1180);
    });

    it('still produces taxCents = 0 when config("tax.rate") returns 0 (default/dev behavior)', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'tax.rate' ? 0 : undefined,
      );
      prisma.orderItem.findMany.mockResolvedValue([
        { priceCents: 1000, quantity: 1 },
      ]);
      prisma.order.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseOrder, ...data }),
      );

      const result = await (service as any).recalculateTotals(orderId);

      expect(result.taxCents).toBe(0);
      expect(result.totalCents).toBe(1000);
    });

    it('subtotalCents + taxCents === totalCents when discountCents is 0', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'tax.rate' ? 0.21 : undefined,
      );
      prisma.order.findUnique.mockResolvedValue({ discountCents: 0 });
      prisma.orderItem.findMany.mockResolvedValue([
        { priceCents: 1200, quantity: 2 },
        { priceCents: 500, quantity: 1 },
      ]);
      prisma.order.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseOrder, ...data }),
      );

      const result = await (service as any).recalculateTotals(orderId);

      expect(result.subtotalCents + result.taxCents).toBe(result.totalCents);
    });
  });
});
