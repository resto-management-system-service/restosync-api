import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { dayRangeInTimezone, DEFAULT_TIMEZONE } from '../common/utils/timezone';
import { PrismaService } from '../prisma/prisma.service';

const SALE_STATUSES: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CONFIRMED,
];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDailySummary(
    date: string,
    restaurantId?: string,
    timezone?: string,
  ) {
    void restaurantId;

    const { gte, lt } = this.dayRange(date, timezone);

    const result = await this.prisma.order.aggregate({
      where: {
        status: { in: SALE_STATUSES },
        createdAt: { gte, lt },
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

  async getPaymentMethodBreakdown(date: string, timezone?: string) {
    const { gte, lt } = this.dayRange(date, timezone);

    const grouped = await this.prisma.payment.groupBy({
      by: ['method'],
      where: {
        status: PaymentStatus.SUCCEEDED,
        createdAt: { gte, lt },
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

  async getBestSellingProducts(date: string, limit = 10, timezone?: string) {
    const { gte, lt } = this.dayRange(date, timezone);

    const grouped = await this.prisma.orderItem.groupBy({
      by: ['menuItemId', 'nameSnapshot'],
      where: {
        order: {
          status: { in: SALE_STATUSES },
          createdAt: { gte, lt },
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

  async getClosedTickets(
    startDate: string,
    endDate: string,
    timezone?: string,
  ) {
    const { gte } = this.dayRange(startDate, timezone);
    const { lt } = this.dayRange(endDate, timezone);

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: SALE_STATUSES },
        createdAt: { gte, lt },
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

  async getDailySummaryRange(
    startDate: string,
    endDate: string,
    timezone?: string,
  ) {
    const { gte } = this.dayRange(startDate, timezone);
    const { lt } = this.dayRange(endDate, timezone);

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: SALE_STATUSES },
        createdAt: { gte, lt },
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

  async getPaymentMethodBreakdownRange(
    startDate: string,
    endDate: string,
    timezone?: string,
  ) {
    const { gte } = this.dayRange(startDate, timezone);
    const { lt } = this.dayRange(endDate, timezone);

    const grouped = await this.prisma.payment.groupBy({
      by: ['method'],
      where: {
        status: PaymentStatus.SUCCEEDED,
        createdAt: { gte, lt },
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

  async getTicketCountByDay(
    startDate: string,
    endDate: string,
    timezone?: string,
  ) {
    const { gte } = this.dayRange(startDate, timezone);
    const { lt } = this.dayRange(endDate, timezone);

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: SALE_STATUSES },
        createdAt: { gte, lt },
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

  private dayRange(date: string, timezone?: string): { gte: Date; lt: Date } {
    return dayRangeInTimezone(date, timezone ?? DEFAULT_TIMEZONE);
  }
}
