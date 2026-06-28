export interface CreateIntentParams {
  amountCents: number;
  currency: string;
  metadata?: Record<string, string>;
}

export interface PaymentIntentResult {
  id: string;
  clientSecret: string | null;
  status: string;
}

export interface GatewayEvent {
  id: string;
  type: string;
  paymentIntentId?: string;
  raw: unknown;
}

// Provider-agnostic seam — Stripe today, another provider tomorrow without
// touching PaymentsService.
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface PaymentGateway {
  createPaymentIntent(params: CreateIntentParams): Promise<PaymentIntentResult>;
  // Verifies the webhook signature and returns a normalized event.
  constructEvent(payload: Buffer, signature: string): GatewayEvent;
}
