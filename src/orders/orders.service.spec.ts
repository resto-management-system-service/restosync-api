import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, OrderType, Role, TableStatus } from '@prisma/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ModifiersService } from '../menu/modifiers.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuthUser } from '../auth/decorators/current-user.decorator';

type MockPrisma = {
  order: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
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
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  table: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createMockPrisma(): MockPrisma {
  return {
    order: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
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
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    table: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
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

type MockModifiersService = { resolveSelections: jest.Mock };

function createMockModifiersService(): MockModifiersService {
  return {
    resolveSelections: jest
      .fn()
      .mockResolvedValue({ selections: [], deltaCentsPerUnit: 0 }),
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

function buildUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'staff@restosync.local',
    role: Role.WAITER,
    restaurantId: 'restaurant-A',
    ...overrides,
  };
}

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: MockPrisma;
  let auditService: MockAuditService;
  let config: MockConfigService;
  let realtimeGateway: MockRealtimeGateway;
  let modifiersService: MockModifiersService;

  const orderId = 'order-1';
  const menuItemId = 'menu-item-1';
  const user = buildUser();

  const baseOrder = {
    id: orderId,
    status: OrderStatus.DRAFT,
    type: OrderType.DINE_IN,
    restaurantId: user.restaurantId,
  };

  const availableMenuItem = {
    id: menuItemId,
    name: 'Classic Cheeseburger',
    priceCents: 1200,
    available: true,
    restaurantId: user.restaurantId,
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    auditService = createMockAuditService();
    config = createMockConfigService();
    realtimeGateway = createMockRealtimeGateway();
    modifiersService = createMockModifiersService();
    service = new OrdersService(
      prisma as unknown as PrismaService,
      auditService as unknown as AuditService,
      config as unknown as ConfigService,
      realtimeGateway as unknown as RealtimeGateway,
      modifiersService as unknown as ModifiersService,
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

    it('rejects the order when a line has an invalid modifier selection', async () => {
      prisma.table.findFirst.mockResolvedValue({
        id: tableId,
        status: TableStatus.AVAILABLE,
      });
      modifiersService.resolveSelections.mockRejectedValue(
        new BadRequestException('Modifier group "Size" is required'),
      );

      await expect(
        service.create(
          {
            ...dto,
            items: [{ menuItemId, quantity: 1, modifierIds: ['x'] }],
          } as any,
          user.restaurantId,
          user.id,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('folds the per-unit modifier delta into the stored line total and snapshot', async () => {
      prisma.table.findFirst.mockResolvedValue({
        id: tableId,
        status: TableStatus.AVAILABLE,
      });
      modifiersService.resolveSelections.mockResolvedValue({
        selections: [
          {
            id: 'lg',
            groupId: 'size',
            groupName: 'Size',
            name: 'Large',
            priceDeltaCents: 300,
          },
        ],
        deltaCentsPerUnit: 300,
      });

      await service.create(
        {
          ...dto,
          items: [{ menuItemId, quantity: 2, modifierIds: ['lg'] }],
        } as any,
        user.restaurantId,
        user.id,
      );

      const created = txOrderCreate.mock.calls[0][0].data.items.create[0];
      expect(created.modifierDeltaCents).toBe(300);
      expect(created.lineTotalCents).toBe((1200 + 300) * 2);
      expect(created.modifiers).toEqual([
        {
          id: 'lg',
          groupId: 'size',
          groupName: 'Size',
          name: 'Large',
          priceDeltaCents: 300,
        },
      ]);
    });

    it('stores undefined modifiers + zero delta when nothing is selected', async () => {
      prisma.table.findFirst.mockResolvedValue({
        id: tableId,
        status: TableStatus.AVAILABLE,
      });

      await service.create(dto as any, user.restaurantId, user.id);

      const created = txOrderCreate.mock.calls[0][0].data.items.create[0];
      expect(created.modifiers ?? null).toBeNull();
      expect(created.modifierDeltaCents).toBe(0);
    });

    it('creates a new order and sets the table OCCUPIED when the table is AVAILABLE', async () => {
      prisma.table.findFirst.mockResolvedValue({
        id: tableId,
        status: TableStatus.AVAILABLE,
      });

      const result = await service.create(
        dto as any,
        user.restaurantId,
        user.id,
      );

      expect(prisma.table.findFirst).toHaveBeenCalledWith({
        where: { id: tableId, restaurantId: user.restaurantId },
      });
      expect(prisma.menuItem.findMany).toHaveBeenCalledWith({
        where: { id: { in: [menuItemId] }, restaurantId: user.restaurantId },
      });
      expect(txOrderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tableId,
            restaurantId: user.restaurantId,
          }),
        }),
      );
      expect(txTableUpdate).toHaveBeenCalledWith({
        where: { id: tableId },
        data: { status: TableStatus.OCCUPIED },
      });
      expect(result.totalCents).toBe(1200);
    });

    it('returns the existing active order instead of creating a duplicate when the table is OCCUPIED', async () => {
      prisma.table.findFirst.mockResolvedValue({
        id: tableId,
        status: TableStatus.OCCUPIED,
      });
      const existingOrder = {
        id: 'existing-order',
        status: OrderStatus.PENDING,
        tableId,
      };
      prisma.order.findFirst.mockResolvedValue(existingOrder);

      const result = await service.create(
        dto as any,
        user.restaurantId,
        user.id,
      );

      expect(result).toBe(existingOrder);
      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ restaurantId: user.restaurantId }),
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(txOrderCreate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a nonexistent tableId', async () => {
      prisma.table.findFirst.mockResolvedValue(null);

      await expect(
        service.create(dto as any, user.restaurantId, user.id),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException (not the table) for a tableId belonging to another restaurant', async () => {
      // findFirst is itself scoped by restaurantId, so a table owned by a
      // different restaurant is invisible here — same as a nonexistent id.
      prisma.table.findFirst.mockResolvedValue(null);

      await expect(
        service.create(dto as any, user.restaurantId, user.id),
      ).rejects.toThrow(NotFoundException);
    });

    it("always uses the restaurantId passed by the controller (the caller's own), never a client-suppliable value", async () => {
      prisma.table.findFirst.mockResolvedValue({
        id: tableId,
        status: TableStatus.AVAILABLE,
      });

      await service.create(dto as any, 'restaurant-B', user.id);

      const { data } = txOrderCreate.mock.calls[0][0];
      expect(data.restaurantId).toBe('restaurant-B');
      expect(data.items.create[0].restaurantId).toBe('restaurant-B');
    });
  });

  describe('findAll', () => {
    it('scopes results to the caller restaurantId', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({ page: 1, limit: 20 } as any, user);

      const [[findManyArgs], countArgs] = [
        prisma.order.findMany.mock.calls,
        undefined,
      ];
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ restaurantId: user.restaurantId }),
        }),
      );
      void findManyArgs;
      void countArgs;
    });

    it('CUSTOMER role additionally scopes by customerId, ON TOP OF restaurantId', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);
      const customer = buildUser({ id: 'customer-1', role: Role.CUSTOMER });

      await service.findAll({ page: 1, limit: 20 } as any, customer);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            restaurantId: customer.restaurantId,
            customerId: customer.id,
          },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the order when it belongs to the caller restaurant', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        customerId: null,
      });

      const result = await service.findOne(orderId, user);

      expect(result.id).toBe(orderId);
    });

    it('throws NotFoundException if the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.findOne(orderId, user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException (404, NOT 403) for an order belonging to another restaurant', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        restaurantId: 'restaurant-B',
        customerId: null,
      });

      await expect(service.findOne(orderId, user)).rejects.toThrow(
        NotFoundException,
      );
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

      await service.updateStatus(orderId, OrderStatus.CONFIRMED, user);

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

      const result = await service.updateStatus(
        orderId,
        OrderStatus.CONFIRMED,
        user,
      );

      expect(result.status).toBe(OrderStatus.CONFIRMED);
      expect(realtimeGateway.emitStatusChanged).toHaveBeenCalled();
    });

    it('throws BadRequestException for an invalid transition and does not emit', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.COMPLETED,
      });

      await expect(
        service.updateStatus(orderId, OrderStatus.CONFIRMED, user),
      ).rejects.toThrow(BadRequestException);
      expect(realtimeGateway.emitStatusChanged).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus(orderId, OrderStatus.CONFIRMED, user),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException (404, NOT 403) for an order belonging to another restaurant', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        restaurantId: 'restaurant-B',
        status: OrderStatus.PENDING,
      });

      await expect(
        service.updateStatus(orderId, OrderStatus.CONFIRMED, user),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('addItem', () => {
    it('rejects adding an item with an invalid modifier selection', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.menuItem.findFirst.mockResolvedValue(availableMenuItem);
      modifiersService.resolveSelections.mockRejectedValue(
        new BadRequestException('"Truffle" is not available'),
      );

      await expect(
        service.addItem(
          orderId,
          { menuItemId, quantity: 1, modifierIds: ['gone'] },
          user,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.orderItem.create).not.toHaveBeenCalled();
    });

    it('folds the delta into lineTotalCents and writes the modifier snapshot', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.menuItem.findFirst.mockResolvedValue(availableMenuItem);
      prisma.orderItem.create.mockResolvedValue({});
      prisma.orderItem.findMany.mockResolvedValue([
        { priceCents: 1200, quantity: 1, lineTotalCents: 1350 },
      ]);
      prisma.order.update.mockResolvedValue({
        ...baseOrder,
        subtotalCents: 1350,
        taxCents: 0,
        totalCents: 1350,
      });
      modifiersService.resolveSelections.mockResolvedValue({
        selections: [
          {
            id: 'bacon',
            groupId: 'extras',
            groupName: 'Extras',
            name: 'Bacon',
            priceDeltaCents: 150,
          },
        ],
        deltaCentsPerUnit: 150,
      });

      await service.addItem(
        orderId,
        { menuItemId, quantity: 1, modifierIds: ['bacon'] },
        user,
      );

      expect(prisma.orderItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          lineTotalCents: 1350,
          modifierDeltaCents: 150,
          modifiers: [
            {
              id: 'bacon',
              groupId: 'extras',
              groupName: 'Extras',
              name: 'Bacon',
              priceDeltaCents: 150,
            },
          ],
        }),
      });
    });

    it('adds an item with the correct price/name snapshot and recalculates totals', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.menuItem.findFirst.mockResolvedValue(availableMenuItem);
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

      const result = await service.addItem(
        orderId,
        { menuItemId, quantity: 2 },
        user,
      );

      expect(prisma.menuItem.findFirst).toHaveBeenCalledWith({
        where: { id: menuItemId, restaurantId: user.restaurantId },
      });
      expect(prisma.orderItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId,
          menuItemId: availableMenuItem.id,
          nameSnapshot: availableMenuItem.name,
          priceCents: availableMenuItem.priceCents,
          quantity: 2,
          lineTotalCents: 2400,
          restaurantId: user.restaurantId,
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
      prisma.menuItem.findFirst.mockResolvedValue(availableMenuItem);
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

      await service.addItem(orderId, { menuItemId, quantity: 2 }, user);

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
      prisma.menuItem.findFirst.mockResolvedValue(availableMenuItem);
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

      const result = await service.addItem(
        orderId,
        { menuItemId, quantity: 2 },
        user,
      );

      expect(result.totalCents).toBe(2400);
      expect(realtimeGateway.emitTotalsChanged).toHaveBeenCalled();
    });

    it('throws NotFoundException if the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.addItem(orderId, { menuItemId, quantity: 1 }, user),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException (404, NOT 403) if the order belongs to another restaurant', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        restaurantId: 'restaurant-B',
      });

      await expect(
        service.addItem(orderId, { menuItemId, quantity: 1 }, user),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if the order is not DRAFT/PENDING', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        status: OrderStatus.CONFIRMED,
      });

      await expect(
        service.addItem(orderId, { menuItemId, quantity: 1 }, user),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if the menu item does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.menuItem.findFirst.mockResolvedValue(null);

      await expect(
        service.addItem(orderId, { menuItemId, quantity: 1 }, user),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if the menu item is not available', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.menuItem.findFirst.mockResolvedValue({
        ...availableMenuItem,
        available: false,
      });

      await expect(
        service.addItem(orderId, { menuItemId, quantity: 1 }, user),
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

      const result = await service.updateItemQuantity(
        orderId,
        orderItemId,
        { quantity: 3 },
        user,
      );

      expect(prisma.orderItem.findFirst).toHaveBeenCalledWith({
        where: {
          id: orderItemId,
          orderId,
          restaurantId: user.restaurantId,
        },
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
        service.updateItemQuantity(orderId, orderItemId, { quantity: 2 }, user),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if the order item does not belong to the order', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.orderItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateItemQuantity(orderId, orderItemId, { quantity: 2 }, user),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException (404, NOT 403) if the order belongs to another restaurant', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        restaurantId: 'restaurant-B',
      });

      await expect(
        service.updateItemQuantity(orderId, orderItemId, { quantity: 2 }, user),
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

      const result = await service.removeItem(orderId, orderItemId, user);

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

      await expect(
        service.removeItem(orderId, orderItemId, user),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if the order item is not found', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.orderItem.findFirst.mockResolvedValue(null);

      await expect(
        service.removeItem(orderId, orderItemId, user),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException (404, NOT 403) if the order belongs to another restaurant', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        restaurantId: 'restaurant-B',
      });

      await expect(
        service.removeItem(orderId, orderItemId, user),
      ).rejects.toThrow(NotFoundException);
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

      const result = await service.confirmOrder(orderId, user);

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

      await expect(service.confirmOrder(orderId, user)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException if the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.confirmOrder(orderId, user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException (404, NOT 403) if the order belongs to another restaurant', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        restaurantId: 'restaurant-B',
        status: OrderStatus.DRAFT,
        items: [{ id: 'item-1' }],
      });

      await expect(service.confirmOrder(orderId, user)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('applyDiscount', () => {
    it('applies the discount and records the audit log with the caller restaurantId', async () => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
      prisma.orderItem.findMany.mockResolvedValue([
        { priceCents: 1000, quantity: 1 },
      ]);
      prisma.order.update.mockResolvedValue({
        ...baseOrder,
        subtotalCents: 1000,
        taxCents: 0,
        totalCents: 900,
        discountCents: 100,
      });

      await service.applyDiscount(
        orderId,
        { discountType: 'FIXED' as any, discountCents: 100 },
        user,
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Order',
          entityId: orderId,
          userId: user.id,
          restaurantId: user.restaurantId,
        }),
      );
    });

    it('throws NotFoundException (404, NOT 403) if the order belongs to another restaurant', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...baseOrder,
        restaurantId: 'restaurant-B',
      });

      await expect(
        service.applyDiscount(
          orderId,
          { discountType: 'FIXED' as any, discountCents: 100 },
          user,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('recalculateTotals', () => {
    it('computes subtotalCents/taxCents/totalCents from the order items, scoped by restaurantId', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { priceCents: 1200, quantity: 2 },
        { priceCents: 500, quantity: 1 },
      ]);
      prisma.order.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseOrder, ...data }),
      );

      const result = await (service as any).recalculateTotals(
        orderId,
        user.restaurantId,
      );

      expect(prisma.orderItem.findMany).toHaveBeenCalledWith({
        where: { orderId, restaurantId: user.restaurantId },
      });
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

      const result = await (service as any).recalculateTotals(
        orderId,
        user.restaurantId,
      );

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

      const result = await (service as any).recalculateTotals(
        orderId,
        user.restaurantId,
      );

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

      const result = await (service as any).recalculateTotals(
        orderId,
        user.restaurantId,
      );

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

      const result = await (service as any).recalculateTotals(
        orderId,
        user.restaurantId,
      );

      expect(result.subtotalCents + result.taxCents).toBe(result.totalCents);
    });
  });
});
