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

  async getDailySummaryRange(startDate: string, endDate: string) {
    const { start } = this.dayRange(startDate);
    const { end } = this.dayRange(endDate);

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: SALE_STATUSES },
        createdAt: { gte: start, lt: end },
      },
      select: { createdAt: true, totalCents: true },
    });

    const byDay = new Map<string, { totalCents: number; count: number }>();

    for (const order of orders) {
      const day = order.createdAt.toISOString().slice(0, 10);
      const entry = byDay.get(day) ?? { totalCents: 0, count: 0 };
      entry.totalCents += order.totalCents;
      entry.count += 1;
      byDay.set(day, entry);
    }

    const result: {
      date: string;
      totalSalesCents: number;
      ticketCount: number;
      averageTicketCents: number;
    }[] = [];

    for (const [date, data] of byDay) {
      result.push({
        date,
        totalSalesCents: data.totalCents,
        ticketCount: data.count,
        averageTicketCents: Math.round(data.totalCents / data.count),
      });
    }

    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }

  async getPaymentMethodBreakdownRange(startDate: string, endDate: string) {
    const { start } = this.dayRange(startDate);
    const { end } = this.dayRange(endDate);

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

  async getTicketCountByDay(startDate: string, endDate: string) {
    const { start } = this.dayRange(startDate);
    const { end } = this.dayRange(endDate);

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: SALE_STATUSES },
        createdAt: { gte: start, lt: end },
      },
      select: { createdAt: true },
    });

    const byDay = new Map<string, number>();

    for (const order of orders) {
      const day = order.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }

    const result: { date: string; ticketCount: number }[] = [];

    for (const [date, count] of byDay) {
      result.push({ date, ticketCount: count });
    }

    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
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
