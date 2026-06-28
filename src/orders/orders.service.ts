import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, Role } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  paginate,
  PaginationQueryDto,
} from '../common/dto/pagination-query.dto';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { canTransition } from './order-status';

const orderInclude = { items: true } satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrderDto, customerId?: string) {
    // Load all referenced menu items in one query.
    const itemIds = dto.items.map((i) => i.menuItemId);
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: itemIds } },
    });
    const byId = new Map(menuItems.map((m) => [m.id, m]));

    let subtotalCents = 0;
    const currency = menuItems[0]?.currency ?? 'usd';

    const orderItems = dto.items.map((line) => {
      const item = byId.get(line.menuItemId);
      if (!item) {
        throw new BadRequestException(
          `Menu item ${line.menuItemId} does not exist`,
        );
      }
      if (!item.available) {
        throw new BadRequestException(`"${item.name}" is not available`);
      }
      // Server is the source of truth for price — never trust the client.
      const lineTotalCents = item.priceCents * line.quantity;
      subtotalCents += lineTotalCents;
      return {
        menuItemId: item.id,
        nameSnapshot: item.name,
        priceCents: item.priceCents,
        quantity: line.quantity,
        modifiers: (line.modifiers ?? undefined) as Prisma.InputJsonValue,
        lineTotalCents,
      };
    });

    const taxCents = 0; // Tax strategy is out of scope for v1; wire a rate here later.
    const totalCents = subtotalCents + taxCents;

    return this.prisma.order.create({
      data: {
        number: this.generateOrderNumber(),
        customerId: customerId ?? null,
        status: OrderStatus.PENDING,
        subtotalCents,
        taxCents,
        totalCents,
        currency,
        notes: dto.notes,
        items: { create: orderItems },
      },
      include: orderInclude,
    });
  }

  async findAll(query: PaginationQueryDto, user: AuthUser) {
    // Customers only see their own orders; staff/admin see everything.
    const where: Prisma.OrderWhereInput =
      user.role === Role.CUSTOMER ? { customerId: user.id } : {};

    const [data, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string, user: AuthUser) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: orderInclude,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (user.role === Role.CUSTOMER && order.customerId !== user.id) {
      throw new ForbiddenException('You cannot access this order');
    }
    return order;
  }

  async updateStatus(id: string, next: OrderStatus) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (!canTransition(order.status, next)) {
      throw new BadRequestException(
        `Cannot transition order from ${order.status} to ${next}`,
      );
    }
    return this.prisma.order.update({
      where: { id },
      data: { status: next },
      include: orderInclude,
    });
  }

  // Used by the payments module once a payment succeeds.
  async markConfirmed(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order || !canTransition(order.status, OrderStatus.CONFIRMED)) {
      return;
    }
    await this.prisma.order.update({
      where: { id },
      data: { status: OrderStatus.CONFIRMED },
    });
  }

  private generateOrderNumber(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = randomBytes(2).toString('hex').toUpperCase();
    return `ORD-${ts}-${rand}`;
  }
}
