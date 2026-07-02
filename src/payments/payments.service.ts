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
} from '@prisma/client';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  GatewayEvent,
  PAYMENT_GATEWAY,
  PaymentGateway,
} from './gateway/payment-gateway.interface';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
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
