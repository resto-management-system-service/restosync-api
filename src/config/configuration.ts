export default () => ({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.APP_PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api',
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    // POS checkout webhook (src/payments/) — diner-facing PaymentIntents.
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    currency: process.env.STRIPE_CURRENCY || 'usd',
    // SaaS billing webhook (src/billing/) — restaurant pays RestoSync.
    // Deliberately separate from webhookSecret above: this is a distinct
    // Stripe webhook endpoint with its own signing secret.
    billingWebhookSecret: process.env.STRIPE_BILLING_WEBHOOK_SECRET || '',
  },
  tax: {
    // Decimal tax rate (e.g. 0.18 = 18%). Validated in env.validation.ts:
    // required + range-checked (0-1) in production, optional (defaults to
    // 0) in development/test.
    rate: parseFloat(process.env.TAX_RATE || '0'),
  },
  reservations: {
    // Fixed deposit amount (in cents) for DEPOSIT_ONLY reservations.
    // Unlike TAX_RATE, an unconfigured deposit has low risk (no legal
    // consequences), so this is optional with a sensible default rather
    // than fail-fast-in-production — see env.validation.ts.
    depositCents: parseInt(process.env.RESERVATION_DEPOSIT_CENTS || '1000', 10),
  },
});
