import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DiscountType,
  OrderStatus,
  OrderType,
  Prisma,
  Role,
  TableStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  paginate,
  PaginationQueryDto,
} from '../common/dto/pagination-query.dto';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateOrderDto } from './dto/create-order.dto';
import { AddOrderItemDto } from './dto/add-order-item.dto';
import { ApplyDiscountDto } from './dto/apply-discount.dto';
import { UpdateOrderItemDto } from './dto/update-order-item.dto';
import { canTransition } from './order-status';

const EDITABLE_STATUSES: OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.PENDING,
];

const orderInclude = { items: true } satisfies Prisma.OrderInclude;

const ACTIVE_ORDER_STATUSES: OrderStatus[] = Object.values(OrderStatus).filter(
  (status) =>
    status !== OrderStatus.COMPLETED && status !== OrderStatus.CANCELLED,
);

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async create(dto: CreateOrderDto, customerId?: string) {
    let table: { id: string; status: TableStatus } | null = null;
    if (dto.type === OrderType.DINE_IN) {
      table = await this.prisma.table.findUnique({
        where: { id: dto.tableId },
      });
      if (!table) {
        throw new NotFoundException('Table not found');
      }
      if (table.status === TableStatus.OCCUPIED) {
        const activeOrder = await this.prisma.order.findFirst({
          where: { tableId: table.id, status: { in: ACTIVE_ORDER_STATUSES } },
          include: orderInclude,
          orderBy: { createdAt: 'desc' },
        });
        if (activeOrder) {
          return activeOrder;
        }
      }
    }

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
        notes: line.notes,
        lineTotalCents,
      };
    });

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          number: this.generateOrderNumber(),
          customerId: customerId ?? null,
          type: dto.type,
          tableId: table?.id ?? null,
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

      if (table) {
        await tx.table.update({
          where: { id: table.id },
          data: { status: TableStatus.OCCUPIED },
        });
      }

      return created;
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
    const previousStatus = order.status;
    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: next },
      include: orderInclude,
    });

    this.emitRealtimeEvent('order.status_changed', id, () =>
      this.realtimeGateway.emitStatusChanged({
        orderId: id,
        status: next,
        previousStatus,
      }),
    );

    return updated;
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
        notes: dto.notes,
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

    const effectiveQuantity = dto.quantity ?? orderItem.quantity;
    const lineTotalCents = orderItem.priceCents * effectiveQuantity;

    const updateData: Prisma.OrderItemUpdateInput = {
      quantity: effectiveQuantity,
      lineTotalCents,
    };
    if (dto.notes !== undefined) {
      updateData.notes = dto.notes;
    }

    await this.prisma.orderItem.update({
      where: { id: orderItemId },
      data: updateData,
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
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { discountCents: true },
    });
    const items = await this.prisma.orderItem.findMany({ where: { orderId } });
    const subtotalCents = items.reduce(
      (sum, item) => sum + item.priceCents * item.quantity,
      0,
    );
    const taxRate = this.config.get<number>('tax.rate') ?? 0;
    const taxCents = Math.round(subtotalCents * taxRate);
    const totalCents = Math.max(
      0,
      subtotalCents + taxCents - (order?.discountCents ?? 0),
    );

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { subtotalCents, taxCents, totalCents },
      include: orderInclude,
    });

    this.emitRealtimeEvent('order.totals_changed', orderId, () =>
      this.realtimeGateway.emitTotalsChanged({
        orderId,
        subtotalCents,
        taxCents,
        discountCents: order?.discountCents ?? 0,
        totalCents,
      }),
    );

    return updated;
  }

  async applyDiscount(
    orderId: string,
    dto: ApplyDiscountDto,
    appliedByUserId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (!EDITABLE_STATUSES.includes(order.status)) {
      throw new BadRequestException(
        `Cannot apply discount to an order with status ${order.status}`,
      );
    }

    const items = await this.prisma.orderItem.findMany({
      where: { orderId },
    });
    const subtotalCents = items.reduce(
      (sum, item) => sum + item.priceCents * item.quantity,
      0,
    );

    const resolvedDiscountCents =
      dto.discountType === DiscountType.PERCENTAGE
        ? Math.floor((subtotalCents * (dto.discountPercent ?? 0)) / 100)
        : (dto.discountCents ?? 0);

    if (resolvedDiscountCents > subtotalCents) {
      throw new BadRequestException('Discount cannot exceed order subtotal');
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        discountCents: resolvedDiscountCents,
        discountType: dto.discountType,
        discountPercent:
          dto.discountType === DiscountType.PERCENTAGE
            ? dto.discountPercent
            : null,
        discountAppliedBy: appliedByUserId,
        discountAppliedAt: new Date(),
        discountReason: dto.reason ?? null,
      },
    });

    await this.auditService.log({
      entityType: 'Order',
      entityId: orderId,
      action: 'DISCOUNT_APPLIED',
      userId: appliedByUserId,
      metadata: {
        discountType: dto.discountType,
        discountCents: resolvedDiscountCents,
        discountPercent:
          dto.discountType === DiscountType.PERCENTAGE
            ? dto.discountPercent
            : undefined,
        reason: dto.reason,
      },
    });

    return this.recalculateTotals(orderId);
  }

  private generateOrderNumber(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = randomBytes(2).toString('hex').toUpperCase();
    return `ORD-${ts}-${rand}`;
  }

  // Real-time notification is best-effort: a failure to emit must never
  // break the underlying order/payment operation, but — unlike #51's
  // silent inventory hook — it must always leave a trace via warn-level
  // logging with enough context (orderId, event type) to debug.
  private emitRealtimeEvent(
    eventType: 'order.status_changed' | 'order.totals_changed',
    orderId: string,
    emit: () => void,
  ): void {
    try {
      emit();
    } catch (err) {
      this.logger.warn(
        `Failed to emit realtime event ${eventType} for order ${orderId}: ${err}`,
      );
    }
  }
}
