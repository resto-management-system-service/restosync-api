import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

type MockPrisma = {
  auditLog: {
    create: jest.Mock;
    findMany: jest.Mock;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('AuditService', () => {
  let service: AuditService;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new AuditService(prisma as unknown as PrismaService);
  });

  describe('log', () => {
    it('creates the audit record with the provided fields', async () => {
      prisma.auditLog.create.mockResolvedValue({});

      await service.log({
        entityType: 'Order',
        entityId: 'order-1',
        action: 'DISCOUNT_APPLIED',
        userId: 'user-1',
        metadata: { discountCents: 100 },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'Order',
          entityId: 'order-1',
          action: 'DISCOUNT_APPLIED',
          userId: 'user-1',
          metadata: { discountCents: 100 },
        },
      });
    });

    it('creates the audit record when metadata is omitted', async () => {
      prisma.auditLog.create.mockResolvedValue({});

      await service.log({
        entityType: 'InventoryItem',
        entityId: 'item-1',
        action: 'STOCK_ADJUSTED',
        userId: 'user-2',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'InventoryItem',
          entityId: 'item-1',
          action: 'STOCK_ADJUSTED',
          userId: 'user-2',
          metadata: undefined,
        },
      });
    });
  });

  describe('findByEntity', () => {
    it('queries by entityType/entityId ordered by createdAt desc', async () => {
      const newest = {
        id: 'log-2',
        entityType: 'Order',
        entityId: 'order-1',
        action: 'DISCOUNT_APPLIED',
        userId: 'user-1',
        metadata: null,
        createdAt: new Date('2026-01-02'),
      };
      const oldest = {
        id: 'log-1',
        entityType: 'Order',
        entityId: 'order-1',
        action: 'DISCOUNT_APPLIED',
        userId: 'user-1',
        metadata: null,
        createdAt: new Date('2026-01-01'),
      };
      // Simulate the DB already returning rows ordered by the requested
      // `orderBy` clause (newest first).
      prisma.auditLog.findMany.mockResolvedValue([newest, oldest]);

      const result = await service.findByEntity('Order', 'order-1');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { entityType: 'Order', entityId: 'order-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([newest, oldest]);
      expect(result[0].createdAt.getTime()).toBeGreaterThan(
        result[1].createdAt.getTime(),
      );
    });
  });
});
