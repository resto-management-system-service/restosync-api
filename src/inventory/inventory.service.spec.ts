import { NotFoundException } from '@nestjs/common';
import { AdjustmentType, Role } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from './inventory.service';

type MockPrisma = {
  inventoryItem: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  stockAdjustment: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createMockPrisma(): MockPrisma {
  return {
    inventoryItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    stockAdjustment: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

function buildUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'manager@restosync.local',
    role: Role.MANAGER,
    restaurantId: 'restaurant-A',
    ...overrides,
  };
}

describe('InventoryService', () => {
  let service: InventoryService;
  let prisma: MockPrisma;
  let txStockAdjustmentCreate: jest.Mock;
  let txInventoryItemUpdate: jest.Mock;

  const itemId = 'item-1';
  const user = buildUser();

  beforeEach(() => {
    prisma = createMockPrisma();
    txStockAdjustmentCreate = jest.fn().mockResolvedValue({});
    txInventoryItemUpdate = jest.fn().mockResolvedValue({});

    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        stockAdjustment: { create: txStockAdjustmentCreate },
        inventoryItem: { update: txInventoryItemUpdate },
      }),
    );

    service = new InventoryService(prisma as unknown as PrismaService);
  });

  describe('findAll', () => {
    it('scopes the query to the caller restaurantId', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);

      await service.findAll(user);

      expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith({
        where: { restaurantId: user.restaurantId },
        include: { menuItem: true },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('create', () => {
    it('creates an item with the correct fields, using the caller restaurantId', async () => {
      prisma.inventoryItem.create.mockResolvedValue({
        id: itemId,
        name: 'Tomato',
        unit: 'kg',
        quantityOnHand: 10,
        lowStockThreshold: 3,
        menuItemId: null,
        restaurantId: user.restaurantId,
      });

      await service.create(
        {
          name: 'Tomato',
          unit: 'kg',
          quantityOnHand: 10,
          lowStockThreshold: 3,
        },
        user,
      );

      expect(prisma.inventoryItem.create).toHaveBeenCalledWith({
        data: {
          name: 'Tomato',
          unit: 'kg',
          quantityOnHand: 10,
          lowStockThreshold: 3,
          menuItemId: null,
          restaurantId: user.restaurantId,
        },
      });
    });

    it('applies defaults when optional fields are omitted', async () => {
      prisma.inventoryItem.create.mockResolvedValue({});

      await service.create({ name: 'Salt' }, user);

      expect(prisma.inventoryItem.create).toHaveBeenCalledWith({
        data: {
          name: 'Salt',
          unit: 'unit',
          quantityOnHand: 0,
          lowStockThreshold: 0,
          menuItemId: null,
          restaurantId: user.restaurantId,
        },
      });
    });

    it("ignores a client-supplied restaurantId and always uses the caller's own", async () => {
      prisma.inventoryItem.create.mockResolvedValue({});

      await service.create(
        {
          name: 'Salt',
          // @ts-expect-error simulating a malicious/naive client payload
          restaurantId: 'restaurant-EVIL',
        },
        user,
      );

      const { data } = prisma.inventoryItem.create.mock.calls[0][0];
      expect(data.restaurantId).toBe(user.restaurantId);
    });
  });

  describe('findOne', () => {
    it('returns the item with its relations when it belongs to the caller restaurant', async () => {
      const item = {
        id: itemId,
        name: 'Tomato',
        restaurantId: user.restaurantId,
        menuItem: null,
        adjustments: [],
      };
      prisma.inventoryItem.findUnique.mockResolvedValue(item);

      const result = await service.findOne(itemId, user);

      expect(prisma.inventoryItem.findUnique).toHaveBeenCalledWith({
        where: { id: itemId },
        include: { menuItem: true, adjustments: true },
      });
      expect(result).toBe(item);
    });

    it('throws NotFoundException if the item does not exist', async () => {
      prisma.inventoryItem.findUnique.mockResolvedValue(null);

      await expect(service.findOne(itemId, user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException (not the item) for an item belonging to another restaurant', async () => {
      prisma.inventoryItem.findUnique.mockResolvedValue({
        id: itemId,
        name: 'Secret Sauce',
        restaurantId: 'restaurant-B',
      });

      await expect(service.findOne(itemId, user)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('adjust', () => {
    it('increases quantityOnHand for a RESTOCK adjustment', async () => {
      prisma.inventoryItem.findUnique.mockResolvedValue({
        id: itemId,
        quantityOnHand: 10,
        restaurantId: user.restaurantId,
      });

      await service.adjust(
        itemId,
        { type: AdjustmentType.RESTOCK, quantityDelta: 5 },
        user.id,
        user.restaurantId,
      );

      expect(txInventoryItemUpdate).toHaveBeenCalledWith({
        where: { id: itemId },
        data: { quantityOnHand: 15 },
        include: { adjustments: true, menuItem: true },
      });
    });

    it('decreases quantityOnHand for a WASTE adjustment', async () => {
      prisma.inventoryItem.findUnique.mockResolvedValue({
        id: itemId,
        quantityOnHand: 15,
        restaurantId: user.restaurantId,
      });

      await service.adjust(
        itemId,
        { type: AdjustmentType.WASTE, quantityDelta: -13 },
        user.id,
        user.restaurantId,
      );

      expect(txInventoryItemUpdate).toHaveBeenCalledWith({
        where: { id: itemId },
        data: { quantityOnHand: 2 },
        include: { adjustments: true, menuItem: true },
      });
    });

    it('clamps quantityOnHand at 0 and never goes negative', async () => {
      prisma.inventoryItem.findUnique.mockResolvedValue({
        id: itemId,
        quantityOnHand: 2,
        restaurantId: user.restaurantId,
      });

      await service.adjust(
        itemId,
        { type: AdjustmentType.WASTE, quantityDelta: -99 },
        user.id,
        user.restaurantId,
      );

      expect(txInventoryItemUpdate).toHaveBeenCalledWith({
        where: { id: itemId },
        data: { quantityOnHand: 0 },
        include: { adjustments: true, menuItem: true },
      });
    });

    it('clamps quantityOnHand at 0 for a SALE adjustment exceeding stock', async () => {
      prisma.inventoryItem.findUnique.mockResolvedValue({
        id: itemId,
        quantityOnHand: 3,
        restaurantId: user.restaurantId,
      });

      await service.adjust(
        itemId,
        { type: AdjustmentType.SALE, quantityDelta: -5 },
        user.id,
        user.restaurantId,
      );

      expect(txInventoryItemUpdate).toHaveBeenCalledWith({
        where: { id: itemId },
        data: { quantityOnHand: 0 },
        include: { adjustments: true, menuItem: true },
      });
      expect(txStockAdjustmentCreate).toHaveBeenCalledWith({
        data: {
          inventoryItemId: itemId,
          type: AdjustmentType.SALE,
          quantityDelta: -5,
          reason: null,
          performedById: user.id,
          restaurantId: user.restaurantId,
        },
      });
    });

    it('creates a StockAdjustment record with type, delta, reason and actor', async () => {
      prisma.inventoryItem.findUnique.mockResolvedValue({
        id: itemId,
        quantityOnHand: 10,
        restaurantId: user.restaurantId,
      });

      await service.adjust(
        itemId,
        {
          type: AdjustmentType.CORRECTION,
          quantityDelta: -1,
          reason: 'Recount',
        },
        user.id,
        user.restaurantId,
      );

      expect(txStockAdjustmentCreate).toHaveBeenCalledWith({
        data: {
          inventoryItemId: itemId,
          type: AdjustmentType.CORRECTION,
          quantityDelta: -1,
          reason: 'Recount',
          performedById: user.id,
          restaurantId: user.restaurantId,
        },
      });
    });

    it('throws NotFoundException if the item does not exist', async () => {
      prisma.inventoryItem.findUnique.mockResolvedValue(null);

      await expect(
        service.adjust(
          itemId,
          { type: AdjustmentType.RESTOCK, quantityDelta: 5 },
          user.id,
          user.restaurantId,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException (not the item) for an item belonging to another restaurant', async () => {
      prisma.inventoryItem.findUnique.mockResolvedValue({
        id: itemId,
        quantityOnHand: 10,
        restaurantId: 'restaurant-B',
      });

      await expect(
        service.adjust(
          itemId,
          { type: AdjustmentType.RESTOCK, quantityDelta: 5 },
          user.id,
          user.restaurantId,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('findLowStock', () => {
    it('returns items where quantityOnHand <= lowStockThreshold', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: '1', quantityOnHand: 2, lowStockThreshold: 3 },
        { id: '2', quantityOnHand: 10, lowStockThreshold: 3 },
      ]);

      const result = await service.findLowStock(user);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('excludes items with lowStockThreshold = 0 via the where filter, scoped by restaurantId', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);

      await service.findLowStock(user);

      expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            restaurantId: user.restaurantId,
            lowStockThreshold: { gt: 0 },
          },
        }),
      );
    });

    it('sets alertLevel to CRITICAL when quantityOnHand is 0', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: '1', quantityOnHand: 0, lowStockThreshold: 3 },
      ]);

      const result = await service.findLowStock(user);

      expect(result[0].alertLevel).toBe('CRITICAL');
    });

    it('sets alertLevel to LOW when quantityOnHand > 0 and <= threshold', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: '1', quantityOnHand: 2, lowStockThreshold: 3 },
      ]);

      const result = await service.findLowStock(user);

      expect(result[0].alertLevel).toBe('LOW');
    });

    it('returns an empty array when there are no low-stock items', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: '1', quantityOnHand: 10, lowStockThreshold: 3 },
      ]);

      const result = await service.findLowStock(user);

      expect(result).toEqual([]);
    });
  });
});
