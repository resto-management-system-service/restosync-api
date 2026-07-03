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
});
