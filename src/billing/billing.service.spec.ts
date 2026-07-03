import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

// Mock the Stripe SDK so we can control webhooks.constructEvent() without
// needing real Stripe credentials or a real signed payload.
const constructEventMock = jest.fn();
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: constructEventMock },
  }));
});

type MockPrisma = {
  subscription: {
    create: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    subscription: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  };
}

function createMockConfig(): ConfigService {
  return {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        'stripe.secretKey': 'sk_test_123',
        'stripe.billingWebhookSecret': 'whsec_billing_test_123',
      };
      return values[key];
    }),
  } as unknown as ConfigService;
}

describe('BillingService', () => {
  let service: BillingService;
  let prisma: MockPrisma;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    service = new BillingService(
      prisma as unknown as PrismaService,
      createMockConfig(),
    );
  });

  describe('createSubscription', () => {
    it('creates the subscription record with status active', async () => {
      prisma.subscription.create.mockResolvedValue({
        id: 'sub-row-1',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
        planName: 'starter',
        status: 'active',
      });

      const result = await service.createSubscription(
        'cus_123',
        'sub_123',
        'starter',
      );

      expect(prisma.subscription.create).toHaveBeenCalledWith({
        data: {
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_123',
          planName: 'starter',
          status: 'active',
        },
      });
      expect(result.status).toBe('active');
    });
  });

  describe('updateSubscriptionStatus', () => {
    it('updates status when the subscription exists', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-row-1',
        stripeSubscriptionId: 'sub_123',
        status: 'active',
      });
      prisma.subscription.update.mockResolvedValue({
        id: 'sub-row-1',
        stripeSubscriptionId: 'sub_123',
        status: 'past_due',
      });

      const result = await service.updateSubscriptionStatus(
        'sub_123',
        'past_due',
      );

      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: 'sub_123' },
      });
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: 'sub_123' },
        data: { status: 'past_due' },
      });
      expect(result?.status).toBe('past_due');
    });

    it('includes currentPeriodEnd in the update data when provided', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-row-1',
        stripeSubscriptionId: 'sub_123',
      });
      prisma.subscription.update.mockResolvedValue({});
      const periodEnd = new Date('2026-08-01');

      await service.updateSubscriptionStatus('sub_123', 'active', periodEnd);

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: 'sub_123' },
        data: { status: 'active', currentPeriodEnd: periodEnd },
      });
    });

    it('does not throw and returns null when the subscription does not exist', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      const result = await service.updateSubscriptionStatus(
        'sub_nonexistent',
        'canceled',
      );

      expect(result).toBeNull();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  describe('findByStripeCustomerId', () => {
    it('returns the subscription when found', async () => {
      const subscription = {
        id: 'sub-row-1',
        stripeCustomerId: 'cus_123',
        status: 'active',
      };
      prisma.subscription.findUnique.mockResolvedValue(subscription);

      const result = await service.findByStripeCustomerId('cus_123');

      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { stripeCustomerId: 'cus_123' },
      });
      expect(result).toEqual(subscription);
    });

    it('returns null when not found', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      const result = await service.findByStripeCustomerId('cus_missing');

      expect(result).toBeNull();
    });
  });

  describe('handleWebhook', () => {
    it('throws BadRequestException when the signature is invalid', async () => {
      constructEventMock.mockImplementation(() => {
        throw new Error('signature mismatch');
      });

      await expect(
        service.handleWebhook(Buffer.from('payload'), 'bad-signature'),
      ).rejects.toThrow(BadRequestException);
    });

    it('dispatches customer.subscription.created to createSubscription', async () => {
      constructEventMock.mockReturnValue({
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            items: { data: [{ price: { nickname: 'starter' } }] },
          },
        },
      });
      prisma.subscription.findUnique.mockResolvedValue(null); // no existing sub yet
      prisma.subscription.create.mockResolvedValue({});

      await service.handleWebhook(Buffer.from('payload'), 'sig');

      expect(prisma.subscription.create).toHaveBeenCalledWith({
        data: {
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_123',
          planName: 'starter',
          status: 'active',
        },
      });
    });

    it('dispatches customer.subscription.updated to updateSubscriptionStatus', async () => {
      constructEventMock.mockReturnValue({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_123',
            status: 'past_due',
            current_period_end: 1780000000,
          },
        },
      });
      prisma.subscription.findUnique.mockResolvedValue({
        stripeSubscriptionId: 'sub_123',
      });
      prisma.subscription.update.mockResolvedValue({});

      await service.handleWebhook(Buffer.from('payload'), 'sig');

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: 'sub_123' },
        data: {
          status: 'past_due',
          currentPeriodEnd: new Date(1780000000 * 1000),
        },
      });
    });

    it('dispatches customer.subscription.deleted to updateSubscriptionStatus(canceled)', async () => {
      constructEventMock.mockReturnValue({
        type: 'customer.subscription.deleted',
        data: {
          object: { id: 'sub_123' },
        },
      });
      prisma.subscription.findUnique.mockResolvedValue({
        stripeSubscriptionId: 'sub_123',
      });
      prisma.subscription.update.mockResolvedValue({});

      await service.handleWebhook(Buffer.from('payload'), 'sig');

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: 'sub_123' },
        data: { status: 'canceled' },
      });
    });

    it('dispatches invoice.payment_failed to updateSubscriptionStatus(past_due)', async () => {
      constructEventMock.mockReturnValue({
        type: 'invoice.payment_failed',
        data: {
          object: { subscription: 'sub_123' },
        },
      });
      prisma.subscription.findUnique.mockResolvedValue({
        stripeSubscriptionId: 'sub_123',
      });
      prisma.subscription.update.mockResolvedValue({});

      await service.handleWebhook(Buffer.from('payload'), 'sig');

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: 'sub_123' },
        data: { status: 'past_due' },
      });
    });

    it('ignores invoice.payment_failed when there is no subscription on the invoice', async () => {
      constructEventMock.mockReturnValue({
        type: 'invoice.payment_failed',
        data: {
          object: { subscription: null },
        },
      });

      await service.handleWebhook(Buffer.from('payload'), 'sig');

      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('does nothing for unhandled event types', async () => {
      constructEventMock.mockReturnValue({
        type: 'customer.updated',
        data: { object: {} },
      });

      const result = await service.handleWebhook(Buffer.from('payload'), 'sig');

      expect(result).toEqual({ received: true });
      expect(prisma.subscription.create).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });
});
