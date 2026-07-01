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
import { AddOrderItemDto } from './dto/add-order-item.dto';
import { UpdateOrderItemDto } from './dto/update-order-item.dto';
import { canTransition } from './order-status';

const EDITABLE_STATUSES: OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.PENDING,
];

const orderInclude = { items: true } satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  private readonly TAX_RATE = 0;

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrderDto, customerId?: string) {
    const itemIds = dto.items.map((i) => i.menuItemId);
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: itemIds } },
    });
    const byId = new Map(menuItems.map((m) => [m.id, m]));

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
      const lineTotalCents = item.priceCents * line.quantity;
      return {
        menuItemId: item.id,
        nameSnapshot: item.name,
        priceCents: item.priceCents,
        quantity: line.quantity,
        modifiers: (line.modifiers ?? undefined) as Prisma.InputJsonValue,
        lineTotalCents,
      };
    });

    const order = await this.prisma.order.create({
      data: {
        number: this.generateOrderNumber(),
        customerId: customerId ?? null,
        type: dto.type,
        table: dto.table,
        status: OrderStatus.DRAFT,
        subtotalCents: 0,
        taxCents: 0,
        totalCents: 0,
        currency,
        notes: dto.notes,
        items: { create: orderItems },
      },
      include: orderInclude,
    });

    return this.recalculateTotals(order.id);
  }

  async findAll(query: PaginationQueryDto, user: AuthUser) {
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

  async findOpen() {
    return this.prisma.order.findMany({
      where: { status: { in: [OrderStatus.DRAFT, OrderStatus.PENDING] } },
      include: orderInclude,
      orderBy: { createdAt: 'asc' },
    });
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

  async addItem(orderId: string, dto: AddOrderItemDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (!EDITABLE_STATUSES.includes(order.status)) {
      throw new BadRequestException(
        `Cannot modify items on an order with status ${order.status}`,
      );
    }

    const menuItem = await this.prisma.menuItem.findUnique({
      where: { id: dto.menuItemId },
    });
    if (!menuItem || !menuItem.available) {
      throw new NotFoundException('Menu item not found or not available');
    }

    const lineTotalCents = menuItem.priceCents * dto.quantity;

    await this.prisma.orderItem.create({
      data: {
        orderId,
        menuItemId: menuItem.id,
        nameSnapshot: menuItem.name,
        priceCents: menuItem.priceCents,
        quantity: dto.quantity,
        modifiers: (dto.modifiers ?? null) as Prisma.InputJsonValue,
        lineTotalCents,
      },
    });

    return this.recalculateTotals(orderId);
  }

  async updateItemQuantity(
    orderId: string,
    orderItemId: string,
    dto: UpdateOrderItemDto,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (!EDITABLE_STATUSES.includes(order.status)) {
      throw new BadRequestException(
        `Cannot modify items on an order with status ${order.status}`,
      );
    }

    const orderItem = await this.prisma.orderItem.findFirst({
      where: { id: orderItemId, orderId },
    });
    if (!orderItem) {
      throw new NotFoundException('Order item not found');
    }

    const lineTotalCents = orderItem.priceCents * dto.quantity;

    await this.prisma.orderItem.update({
      where: { id: orderItemId },
      data: { quantity: dto.quantity, lineTotalCents },
    });

    return this.recalculateTotals(orderId);
  }

  async removeItem(orderId: string, orderItemId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (!EDITABLE_STATUSES.includes(order.status)) {
      throw new BadRequestException(
        `Cannot modify items on an order with status ${order.status}`,
      );
    }

    const orderItem = await this.prisma.orderItem.findFirst({
      where: { id: orderItemId, orderId },
    });
    if (!orderItem) {
      throw new NotFoundException('Order item not found');
    }

    await this.prisma.orderItem.delete({ where: { id: orderItemId } });

    return this.recalculateTotals(orderId);
  }

  async confirmOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.items.length === 0) {
      throw new BadRequestException('Order must have at least one item');
    }
    if (!canTransition(order.status, OrderStatus.PENDING)) {
      throw new BadRequestException(
        `Cannot transition order from ${order.status} to ${OrderStatus.PENDING}`,
      );
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PENDING },
      include: orderInclude,
    });
  }

  private async recalculateTotals(orderId: string) {
    const items = await this.prisma.orderItem.findMany({ where: { orderId } });
    const subtotalCents = items.reduce(
      (sum, item) => sum + item.priceCents * item.quantity,
      0,
    );
    const taxCents = Math.round(subtotalCents * this.TAX_RATE);
    const totalCents = subtotalCents + taxCents;

    return this.prisma.order.update({
      where: { id: orderId },
      data: { subtotalCents, taxCents, totalCents },
      include: orderInclude,
    });
  }

  private generateOrderNumber(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = randomBytes(2).toString('hex').toUpperCase();
    return `ORD-${ts}-${rand}`;
  }
}
