import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  CreateIntentParams,
  GatewayEvent,
  PaymentGateway,
  PaymentIntentResult,
} from './payment-gateway.interface';

@Injectable()
export class StripeGateway implements PaymentGateway {
  private readonly logger = new Logger(StripeGateway.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(config: ConfigService) {
    this.stripe = new Stripe(config.get<string>('stripe.secretKey') || '', {
      apiVersion: '2024-06-20',
    });
    this.webhookSecret = config.get<string>('stripe.webhookSecret') || '';
  }

  async createPaymentIntent(
    params: CreateIntentParams,
  ): Promise<PaymentIntentResult> {
    const intent = await this.stripe.paymentIntents.create({
      amount: params.amountCents,
      currency: params.currency,
      metadata: params.metadata,
      automatic_payment_methods: { enabled: true },
    });
    return {
      id: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status,
    };
  }

  constructEvent(payload: Buffer, signature: string): GatewayEvent {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.webhookSecret,
      );
    } catch (err) {
      this.logger.warn(`Webhook signature verification failed: ${err}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    const paymentIntentId = (event.data.object as Stripe.PaymentIntent)?.id;
    return {
      id: event.id,
      type: event.type,
      paymentIntentId,
      raw: event,
    };
  }
}
