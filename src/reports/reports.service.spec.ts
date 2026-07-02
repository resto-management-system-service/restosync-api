import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

type MockPrisma = {
  order: {
    aggregate: jest.Mock;
    findMany: jest.Mock;
  };
  payment: {
    groupBy: jest.Mock;
  };
  orderItem: {
    groupBy: jest.Mock;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    order: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
    payment: {
      groupBy: jest.fn(),
    },
    orderItem: {
      groupBy: jest.fn(),
    },
  };
}

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: MockPrisma;

  const date = '2025-06-30';
  const startDate = '2025-06-01';
  const endDate = '2025-06-30';

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ReportsService(prisma as unknown as PrismaService);
  });

  describe('getDailySummary', () => {
    it('returns correct totalSalesCents and ticketCount with averageTicketCents computed', async () => {
      prisma.order.aggregate.mockResolvedValue({
        _sum: { totalCents: 5000 },
        _count: 4,
      });

      const result = await service.getDailySummary(date);

      expect(prisma.order.aggregate).toHaveBeenCalledWith({
        where: {
          status: { in: [OrderStatus.COMPLETED, OrderStatus.CONFIRMED] },
          createdAt: expect.objectContaining({
            gte: expect.any(Date),
            lt: expect.any(Date),
          }),
        },
        _sum: { totalCents: true },
        _count: true,
      });
      expect(result.totalSalesCents).toBe(5000);
      expect(result.ticketCount).toBe(4);
      expect(result.averageTicketCents).toBe(1250);
    });

    it('returns zeros when no orders exist for the day', async () => {
      prisma.order.aggregate.mockResolvedValue({
        _sum: { totalCents: null },
        _count: 0,
      });

      const result = await service.getDailySummary(date);

      expect(result.totalSalesCents).toBe(0);
      expect(result.ticketCount).toBe(0);
      expect(result.averageTicketCents).toBe(0);
    });
  });

  describe('getPaymentMethodBreakdown', () => {
    it('returns correct amounts per method and excludes methods with 0 amount', async () => {
      prisma.payment.groupBy.mockResolvedValue([
        { method: PaymentMethod.CASH, _sum: { amountCents: 3000 } },
        { method: PaymentMethod.CARD, _sum: { amountCents: 0 } },
      ]);

      const result = await service.getPaymentMethodBreakdown(date);

      expect(prisma.payment.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['method'],
          where: expect.objectContaining({
            status: PaymentStatus.SUCCEEDED,
          }),
        }),
      );
      expect(result).toEqual({ CASH: 3000 });
      expect(result.CARD).toBeUndefined();
      expect(result.TRANSFER).toBeUndefined();
      expect(result.STRIPE).toBeUndefined();
    });
  });

  describe('getBestSellingProducts', () => {
    it('returns a ranked list by quantitySold DESC with revenueCents', async () => {
      prisma.orderItem.groupBy.mockResolvedValue([
        {
          menuItemId: 'item-a',
          nameSnapshot: 'Burger',
          _sum: { quantity: 5, lineTotalCents: 6000 },
        },
        {
          menuItemId: 'item-b',
          nameSnapshot: 'Fries',
          _sum: { quantity: 2, lineTotalCents: 1000 },
        },
      ]);

      const result = await service.getBestSellingProducts(date, 10);

      expect(result).toEqual([
        {
          menuItemId: 'item-a',
          name: 'Burger',
          quantitySold: 5,
          revenueCents: 6000,
        },
        {
          menuItemId: 'item-b',
          name: 'Fries',
          quantitySold: 2,
          revenueCents: 1000,
        },
      ]);
    });

    it('respects the limit param by passing it to take', async () => {
      prisma.orderItem.groupBy.mockResolvedValue([]);

      await service.getBestSellingProducts(date, 3);

      expect(prisma.orderItem.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
    });

    it('defaults the limit to 10 when not provided', async () => {
      prisma.orderItem.groupBy.mockResolvedValue([]);

      await service.getBestSellingProducts(date);

      expect(prisma.orderItem.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  describe('getClosedTickets', () => {
    it('returns orders in the date range with itemCount', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'order-1',
          number: 'ORD-1',
          totalCents: 1200,
          status: OrderStatus.CONFIRMED,
          createdAt: new Date('2025-06-15T10:00:00Z'),
          _count: { items: 2 },
        },
      ]);

      const result = await service.getClosedTickets(startDate, endDate);

      expect(result).toEqual([
        {
          id: 'order-1',
          number: 'ORD-1',
          totalCents: 1200,
          status: OrderStatus.CONFIRMED,
          createdAt: new Date('2025-06-15T10:00:00Z'),
          itemCount: 2,
        },
      ]);
    });

    it('filters by COMPLETED/CONFIRMED status only', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await service.getClosedTickets(startDate, endDate);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: [OrderStatus.COMPLETED, OrderStatus.CONFIRMED] },
          }),
        }),
      );
    });
  });

  describe('getTicketCountByDay', () => {
    it('groups orders by day and returns a sorted array', async () => {
      prisma.order.findMany.mockResolvedValue([
        { createdAt: new Date('2025-06-02T08:00:00Z') },
        { createdAt: new Date('2025-06-01T09:00:00Z') },
        { createdAt: new Date('2025-06-01T20:00:00Z') },
      ]);

      const result = await service.getTicketCountByDay(startDate, endDate);

      expect(result).toEqual([
        { date: '2025-06-01', ticketCount: 2 },
        { date: '2025-06-02', ticketCount: 1 },
      ]);
    });

    it('returns an empty array when there are no orders', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.getTicketCountByDay(startDate, endDate);

      expect(result).toEqual([]);
    });
  });
});
