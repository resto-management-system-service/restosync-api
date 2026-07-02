import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Orders in either of these statuses count as completed sales.
const SALE_STATUSES: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CONFIRMED,
];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDailySummary(date: string, restaurantId?: string) {
    // NOTE: the schema is currently single-tenant — Order has no
    // restaurantId column. This param is accepted for forward-compatibility
    // with future multi-tenant support but is not yet filterable.
    void restaurantId;

    const { start, end } = this.dayRange(date);

    const result = await this.prisma.order.aggregate({
      where: {
        status: { in: SALE_STATUSES },
        createdAt: { gte: start, lt: end },
      },
      _sum: { totalCents: true },
      _count: true,
    });

    const totalSalesCents = result._sum.totalCents ?? 0;
    const ticketCount = result._count;
    const averageTicketCents =
      ticketCount > 0 ? Math.round(totalSalesCents / ticketCount) : 0;

    return { totalSalesCents, ticketCount, averageTicketCents };
  }

  async getPaymentMethodBreakdown(date: string) {
    const { start, end } = this.dayRange(date);

    const grouped = await this.prisma.payment.groupBy({
      by: ['method'],
      where: {
        status: PaymentStatus.SUCCEEDED,
        createdAt: { gte: start, lt: end },
      },
      _sum: { amountCents: true },
    });

    const byMethod: Record<string, number> = {};
    for (const method of Object.values(PaymentMethod)) {
      const row = grouped.find((g) => g.method === method);
      const amount = row?._sum.amountCents ?? 0;
      if (amount > 0) {
        byMethod[method] = amount;
      }
    }

    return byMethod;
  }

  async getBestSellingProducts(date: string, limit = 10) {
    const { start, end } = this.dayRange(date);

    const grouped = await this.prisma.orderItem.groupBy({
      by: ['menuItemId', 'nameSnapshot'],
      where: {
        order: {
          status: { in: SALE_STATUSES },
          createdAt: { gte: start, lt: end },
        },
      },
      _sum: { quantity: true, lineTotalCents: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: limit,
    });

    return grouped.map((row) => ({
      menuItemId: row.menuItemId,
      name: row.nameSnapshot,
      quantitySold: row._sum.quantity ?? 0,
      revenueCents: row._sum.lineTotalCents ?? 0,
    }));
  }

  async getClosedTickets(startDate: string, endDate: string) {
    const { start } = this.dayRange(startDate);
    const { end } = this.dayRange(endDate);

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: SALE_STATUSES },
        createdAt: { gte: start, lt: end },
      },
      select: {
        id: true,
        number: true,
        totalCents: true,
        status: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return orders.map((order) => ({
      id: order.id,
      number: order.number,
      totalCents: order.totalCents,
      status: order.status,
      createdAt: order.createdAt,
      itemCount: order._count.items,
    }));
  }

  // Converts a 'YYYY-MM-DD' date string into a [start, end) UTC range
  // covering that whole calendar day.
  private dayRange(date: string): { start: Date; end: Date } {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }
}
