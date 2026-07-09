import { NotFoundException } from '@nestjs/common';
import { AdjustmentType } from '@prisma/client';
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

describe('InventoryService', () => {
  let service: InventoryService;
  let prisma: MockPrisma;
  let txStockAdjustmentCreate: jest.Mock;
  let txInventoryItemUpdate: jest.Mock;

  const itemId = 'item-1';
  const actorId = 'user-1';

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

  describe('create', () => {
    it('creates an item with the correct fields', async () => {
      prisma.inventoryItem.create.mockResolvedValue({
        id: itemId,
        name: 'Tomato',
        unit: 'kg',
        quantityOnHand: 10,
        lowStockThreshold: 3,
        menuItemId: null,
      });

      await service.create({
        name: 'Tomato',
        unit: 'kg',
        quantityOnHand: 10,
        lowStockThreshold: 3,
      });

      expect(prisma.inventoryItem.create).toHaveBeenCalledWith({
        data: {
          name: 'Tomato',
          unit: 'kg',
          quantityOnHand: 10,
          lowStockThreshold: 3,
          menuItemId: null,
        },
      });
    });

    it('applies defaults when optional fields are omitted', async () => {
      prisma.inventoryItem.create.mockResolvedValue({});

      await service.create({ name: 'Salt' });

      expect(prisma.inventoryItem.create).toHaveBeenCalledWith({
        data: {
          name: 'Salt',
          unit: 'unit',
          quantityOnHand: 0,
          lowStockThreshold: 0,
          menuItemId: null,
        },
      });
    });
  });

  describe('findOne', () => {
    it('returns the item with its relations', async () => {
      const item = {
        id: itemId,
        name: 'Tomato',
        menuItem: null,
        adjustments: [],
      };
      prisma.inventoryItem.findUnique.mockResolvedValue(item);

      const result = await service.findOne(itemId);

      expect(prisma.inventoryItem.findUnique).toHaveBeenCalledWith({
        where: { id: itemId },
        include: { menuItem: true, adjustments: true },
      });
      expect(result).toBe(item);
    });

    it('throws NotFoundException if the item does not exist', async () => {
      prisma.inventoryItem.findUnique.mockResolvedValue(null);

      await expect(service.findOne(itemId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('adjust', () => {
    it('increases quantityOnHand for a RESTOCK adjustment', async () => {
      prisma.inventoryItem.findUnique.mockResolvedValue({
        id: itemId,
        quantityOnHand: 10,
      });

      await service.adjust(
        itemId,
        { type: AdjustmentType.RESTOCK, quantityDelta: 5 },
        actorId,
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
      });

      await service.adjust(
        itemId,
        { type: AdjustmentType.WASTE, quantityDelta: -13 },
        actorId,
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
      });

      await service.adjust(
        itemId,
        { type: AdjustmentType.WASTE, quantityDelta: -99 },
        actorId,
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
      });

      await service.adjust(
        itemId,
        { type: AdjustmentType.SALE, quantityDelta: -5 },
        actorId,
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
          performedById: actorId,
        },
      });
    });

    it('creates a StockAdjustment record with type, delta, reason and actor', async () => {
      prisma.inventoryItem.findUnique.mockResolvedValue({
        id: itemId,
        quantityOnHand: 10,
      });

      await service.adjust(
        itemId,
        {
          type: AdjustmentType.CORRECTION,
          quantityDelta: -1,
          reason: 'Recount',
        },
        actorId,
      );

      expect(txStockAdjustmentCreate).toHaveBeenCalledWith({
        data: {
          inventoryItemId: itemId,
          type: AdjustmentType.CORRECTION,
          quantityDelta: -1,
          reason: 'Recount',
          performedById: actorId,
        },
      });
    });

    it('throws NotFoundException if the item does not exist', async () => {
      prisma.inventoryItem.findUnique.mockResolvedValue(null);

      await expect(
        service.adjust(
          itemId,
          { type: AdjustmentType.RESTOCK, quantityDelta: 5 },
          actorId,
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

      const result = await service.findLowStock();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('excludes items with lowStockThreshold = 0 via the where filter', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);

      await service.findLowStock();

      expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { lowStockThreshold: { gt: 0 } },
        }),
      );
    });

    it('sets alertLevel to CRITICAL when quantityOnHand is 0', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: '1', quantityOnHand: 0, lowStockThreshold: 3 },
      ]);

      const result = await service.findLowStock();

      expect(result[0].alertLevel).toBe('CRITICAL');
    });

    it('sets alertLevel to LOW when quantityOnHand > 0 and <= threshold', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: '1', quantityOnHand: 2, lowStockThreshold: 3 },
      ]);

      const result = await service.findLowStock();

      expect(result[0].alertLevel).toBe('LOW');
    });

    it('returns an empty array when there are no low-stock items', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: '1', quantityOnHand: 10, lowStockThreshold: 3 },
      ]);

      const result = await service.findLowStock();

      expect(result).toEqual([]);
    });
  });
});
