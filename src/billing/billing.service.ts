import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

// SaaS subscription billing: the restaurant (as RestoSync's customer) pays
// RestoSync via Stripe. Fully decoupled from src/payments/ (POS checkout).
// See src/billing/README.md for the boundary between the two concerns.
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    // Reuses the same Stripe account/secret key already configured for the
    // POS payments gateway (STRIPE_SECRET_KEY) — no duplicated SDK setup.
    // The webhook signing secret, however, is intentionally separate
    // (STRIPE_BILLING_WEBHOOK_SECRET): this is a distinct Stripe webhook
    // endpoint (/api/billing/webhook) with its own signing secret, not to
    // be confused with the POS payments webhook secret.
    this.stripe = new Stripe(config.get<string>('stripe.secretKey') || '', {
      apiVersion: '2024-06-20',
    });
    this.webhookSecret =
      config.get<string>('stripe.billingWebhookSecret') || '';
  }

  async createSubscription(
    stripeCustomerId: string,
    stripeSubscriptionId: string,
    planName: string,
  ) {
    return this.prisma.subscription.create({
      data: {
        stripeCustomerId,
        stripeSubscriptionId,
        planName,
        status: 'active',
      },
    });
  }

  async updateSubscriptionStatus(
    stripeSubscriptionId: string,
    status: string,
    currentPeriodEnd?: Date,
  ) {
    // Guard against out-of-order webhook delivery (e.g. an update/deleted
    // event arriving before the local record exists) rather than letting
    // Prisma throw P2025 for a record we simply haven't seen yet.
    const existing = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
    });
    if (!existing) {
      this.logger.warn(
        `No subscription found for stripeSubscriptionId ${stripeSubscriptionId}`,
      );
      return null;
    }

    return this.prisma.subscription.update({
      where: { stripeSubscriptionId },
      data: {
        status,
        ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
      },
    });
  }

  async findByStripeCustomerId(stripeCustomerId: string) {
    return this.prisma.subscription.findUnique({
      where: { stripeCustomerId },
    });
  }

  // Verifies the Stripe signature (same pattern as StripeGateway.constructEvent
  // in src/payments/) and syncs the minimal subscription status fields.
  async handleWebhook(payload: Buffer, signature: string) {
    const event = this.constructEvent(payload, signature);

    switch (event.type) {
      case 'customer.subscription.created':
        await this.onSubscriptionCreated(event);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event);
        break;
      case 'invoice.payment_failed':
        await this.onInvoicePaymentFailed(event);
        break;
      default:
        this.logger.debug(`Unhandled billing webhook event: ${event.type}`);
    }
    return { received: true };
  }

  private constructEvent(payload: Buffer, signature: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.webhookSecret,
      );
    } catch (err) {
      this.logger.warn(`Webhook signature verification failed: ${err}`);
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  private async onSubscriptionCreated(event: Stripe.Event) {
    const subscription = event.data.object as Stripe.Subscription;
    const existing = await this.findByStripeCustomerId(
      subscription.customer as string,
    );
    if (existing) {
      return;
    }
    await this.createSubscription(
      subscription.customer as string,
      subscription.id,
      subscription.items.data[0]?.price?.nickname || 'default',
    );
  }

  private async onSubscriptionUpdated(event: Stripe.Event) {
    const subscription = event.data.object as Stripe.Subscription;
    await this.updateSubscriptionStatus(
      subscription.id,
      subscription.status,
      subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : undefined,
    );
  }

  private async onSubscriptionDeleted(event: Stripe.Event) {
    const subscription = event.data.object as Stripe.Subscription;
    await this.updateSubscriptionStatus(subscription.id, 'canceled');
  }

  private async onInvoicePaymentFailed(event: Stripe.Event) {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = invoice.subscription as string | null;
    if (!subscriptionId) {
      return;
    }
    await this.updateSubscriptionStatus(subscriptionId, 'past_due');
  }
}
