import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  TableStatus,
} from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { canTransition } from '../orders/order-status';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutDto } from './dto/checkout.dto';
import {
  GatewayEvent,
  PAYMENT_GATEWAY,
  PaymentGateway,
} from './gateway/payment-gateway.interface';

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly inventoryService: InventoryService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async createIntent(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        `Order is ${order.status} and cannot be paid`,
      );
    }

    // Amount comes from the order's server-computed total, never the client.
    const intent = await this.gateway.createPaymentIntent({
      amountCents: order.totalCents,
      currency: order.currency,
      metadata: { orderId: order.id, orderNumber: order.number },
    });

    await this.prisma.payment.upsert({
      where: { providerRef: intent.id },
      update: { amountCents: order.totalCents },
      create: {
        orderId: order.id,
        method: PaymentMethod.STRIPE,
        provider: 'stripe',
        providerRef: intent.id,
        amountCents: order.totalCents,
        currency: order.currency,
        status: PaymentStatus.REQUIRES_PAYMENT,
      },
    });

    return {
      paymentIntentId: intent.id,
      clientSecret: intent.clientSecret,
      amountCents: order.totalCents,
      currency: order.currency,
    };
  }

  // POS checkout: closes the order, records a payment, and attaches it to
  // the active cash register session — all in a single transaction.
  async checkout(dto: CheckoutDto, actorId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        `Order is ${order.status} and cannot be checked out`,
      );
    }

    const activeSession = await this.prisma.cashRegisterSession.findFirst({
      where: { closedAt: null },
      orderBy: { openedAt: 'desc' },
    });
    if (!activeSession) {
      throw new BadRequestException('No active cash register session');
    }

    // Idempotency: never double-charge an already-paid order.
    const existingPayment = await this.prisma.payment.findFirst({
      where: { orderId: order.id, status: PaymentStatus.SUCCEEDED },
      include: { order: true },
    });
    if (existingPayment) {
      return existingPayment;
    }

    // Amount comes from the order's server-computed total, never the client.
    if (
      dto.method === PaymentMethod.CASH &&
      dto.amountPaidCents < order.totalCents
    ) {
      throw new BadRequestException('Insufficient payment amount');
    }

    this.logger.debug(`Checkout for order ${order.id} by user ${actorId}`);

    const payment = await this.prisma.$transaction(async (tx) => {
      if (!canTransition(order.status, OrderStatus.CONFIRMED)) {
        throw new BadRequestException(
          `Cannot transition order from ${order.status} to ${OrderStatus.CONFIRMED}`,
        );
      }
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CONFIRMED },
      });

      // Releasing the table is a core correctness concern (part of the
      // critical payment path), not an optional side effect like the
      // inventory hook below — it must NOT be swallowed on failure.
      if (order.tableId) {
        await tx.table.update({
          where: { id: order.tableId },
          data: { status: TableStatus.AVAILABLE },
        });
      }

      return tx.payment.create({
        data: {
          orderId: order.id,
          method: dto.method,
          provider: 'pos',
          providerRef: null,
          amountCents: order.totalCents,
          paidCents: dto.amountPaidCents,
          changeCents: Math.max(0, dto.amountPaidCents - order.totalCents),
          currency: order.currency,
          status: PaymentStatus.SUCCEEDED,
          sessionId: activeSession.id,
        },
        include: { order: true },
      });
    });

    // Best-effort, non-blocking: the sale is already confirmed and paid,
    // so an inventory hiccup must never fail or roll back the checkout.
    await this.decrementInventoryForOrder(order, actorId);

    return payment;
  }

  // Optional hook (#51): decrements stock for any OrderItem linked to an
  // InventoryItem via menuItemId. Items without a linked InventoryItem are
  // silently skipped — that's the normal case, not an error. Any failure
  // here is logged and swallowed so it never surfaces to the caller; this
  // is an intentional exception to the "no try/catch for Prisma errors"
  // rule, isolating a non-critical side effect from the critical payment
  // flow.
  private async decrementInventoryForOrder(
    order: OrderWithItems,
    actorId: string,
  ) {
    for (const item of order.items) {
      try {
        const inventoryItem = await this.prisma.inventoryItem.findFirst({
          where: { menuItemId: item.menuItemId },
        });
        if (!inventoryItem) {
          continue;
        }

        await this.inventoryService.adjust(
          inventoryItem.id,
          {
            type: 'SALE',
            quantityDelta: -item.quantity,
            reason: `Sale from order ${order.number}`,
          },
          actorId,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to decrement inventory for menuItemId ${item.menuItemId} on order ${order.number}: ${err}`,
        );
      }
    }
  }

  async handleWebhook(payload: Buffer, signature: string) {
    const event = this.gateway.constructEvent(payload, signature);

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.onPaymentSucceeded(event);
        break;
      case 'payment_intent.payment_failed':
        await this.onPaymentFailed(event);
        break;
      default:
        this.logger.debug(`Unhandled webhook event: ${event.type}`);
    }
    return { received: true };
  }

  private async onPaymentSucceeded(event: GatewayEvent) {
    const payment = await this.findPaymentForEvent(event);
    if (!payment) {
      return;
    }
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCEEDED,
        lastEventId: event.id,
        rawEvent: event.raw as Prisma.InputJsonValue,
      },
    });
    // Webhook is the source of truth — confirm the order here, not on the client.
    await this.orders.markConfirmed(payment.orderId);
  }

  private async onPaymentFailed(event: GatewayEvent) {
    const payment = await this.findPaymentForEvent(event);
    if (!payment) {
      return;
    }
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        lastEventId: event.id,
        rawEvent: event.raw as Prisma.InputJsonValue,
      },
    });
  }

  // Looks up the local payment record and enforces idempotency on event id.
  private async findPaymentForEvent(event: GatewayEvent) {
    if (!event.paymentIntentId) {
      return null;
    }
    const payment = await this.prisma.payment.findUnique({
      where: { providerRef: event.paymentIntentId },
    });
    if (!payment) {
      this.logger.warn(`No payment found for intent ${event.paymentIntentId}`);
      return null;
    }
    if (payment.lastEventId === event.id) {
      this.logger.debug(`Duplicate webhook event ${event.id} ignored`);
      return null;
    }
    return payment;
  }
}
