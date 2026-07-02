import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('RestoSync API (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  const email = `customer_${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /api/auth/register issues tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'Secret123!', firstName: 'Test' })
      .expect(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    accessToken = res.body.accessToken;
  });

  it('GET /api/auth/me returns the current user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.email).toBe(email);
    expect(res.body.role).toBe('CUSTOMER');
  });

  it('GET /api/auth/me is rejected without a token', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('GET /api/menu/items is public', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/menu/items')
      .expect(200);
    expect(res.body.meta).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('rejects menu writes from a customer', async () => {
    await request(app.getHttpServer())
      .post('/api/menu/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Should Fail' })
      .expect(403);
  });

  describe('order lifecycle: open -> edit -> close', () => {
    let adminToken: string;
    let categoryId: string;
    let burgerId: string;
    let friesId: string;
    let orderId: string;
    let orderItemId: string;

    beforeAll(async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@restosync.local', password: 'Admin123!' })
        .expect(200);
      adminToken = login.body.accessToken;

      const category = await request(app.getHttpServer())
        .post('/api/menu/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Lifecycle_${Date.now()}` })
        .expect(201);
      categoryId = category.body.id;

      const burger = await request(app.getHttpServer())
        .post('/api/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Lifecycle Burger',
          priceCents: 1200,
          categoryId,
        })
        .expect(201);
      burgerId = burger.body.id;

      const fries = await request(app.getHttpServer())
        .post('/api/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Lifecycle Fries',
          priceCents: 500,
          categoryId,
        })
        .expect(201);
      friesId = fries.body.id;
    });

    it('POST /api/orders creates an order in DRAFT status', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DINE_IN',
          table: 'T1',
          items: [{ menuItemId: burgerId, quantity: 1 }],
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      expect(res.body.totalCents).toBe(1200);
      orderId = res.body.id;
    });

    it('POST /api/orders/:id/items adds an item and updates the total', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ menuItemId: friesId, quantity: 1 })
        .expect(201);

      expect(res.body.totalCents).toBe(1700);
      const friesItem = res.body.items.find(
        (item: { menuItemId: string }) => item.menuItemId === friesId,
      );
      expect(friesItem).toBeDefined();
      orderItemId = friesItem.id;
    });

    it('POST /api/orders/:id/items adds a second unit and updates the total again', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ menuItemId: burgerId, quantity: 1 })
        .expect(201);

      expect(res.body.totalCents).toBe(2900);
    });

    it('PATCH /api/orders/:id/items/:itemId updates the quantity and total', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/orders/${orderId}/items/${orderItemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 3 })
        .expect(200);

      // 2 burgers (1200*2) + 3 fries (500*3) = 2400 + 1500
      expect(res.body.totalCents).toBe(3900);
    });

    it('DELETE /api/orders/:id/items/:itemId removes the item and updates the total', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/orders/${orderId}/items/${orderItemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Only the 2 burgers remain: 1200*2
      expect(res.body.totalCents).toBe(2400);
    });

    it('POST /api/orders/:id/confirm confirms the order (DRAFT -> PENDING)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/orders/${orderId}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body.status).toBe('PENDING');
    });

    it('still allows adding items while the order is PENDING', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ menuItemId: friesId, quantity: 1 })
        .expect(201);

      expect(res.body.totalCents).toBe(2900);
    });

    it('rejects adding items once the order is CONFIRMED', async () => {
      await request(app.getHttpServer())
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'CONFIRMED' })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ menuItemId: burgerId, quantity: 1 })
        .expect(400);
    });
  });

  describe('cashier flow: cash register + checkout', () => {
    const ORDER_TOTAL_CENTS = 1200;
    const OPENING_FLOAT_CENTS = 10000;

    let cashierToken: string;
    let adminToken: string;
    let categoryId: string;
    let burgerId: string;
    let orderId: string;
    let sessionId: string;

    beforeAll(async () => {
      const cashierLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'cashier@restosync.local', password: 'Cashier123!' })
        .expect(200);
      cashierToken = cashierLogin.body.accessToken;

      const adminLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@restosync.local', password: 'Admin123!' })
        .expect(200);
      adminToken = adminLogin.body.accessToken;

      // Clean up any register session left open by a previous test run.
      await request(app.getHttpServer())
        .post('/api/cash-register/close')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ countedCents: 0 });

      const category = await request(app.getHttpServer())
        .post('/api/menu/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Cashier_${Date.now()}` })
        .expect(201);
      categoryId = category.body.id;

      const burger = await request(app.getHttpServer())
        .post('/api/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Cashier Burger',
          priceCents: ORDER_TOTAL_CENTS,
          categoryId,
        })
        .expect(201);
      burgerId = burger.body.id;
    });

    it('POST /api/cash-register/open opens a session with the float', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/cash-register/open')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ openingFloatCents: OPENING_FLOAT_CENTS })
        .expect(201);

      expect(res.body.openingFloatCents).toBe(OPENING_FLOAT_CENTS);
      expect(res.body.closedAt).toBeNull();
      sessionId = res.body.id;
    });

    it('rejects opening a second session while one is already open', async () => {
      await request(app.getHttpServer())
        .post('/api/cash-register/open')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ openingFloatCents: 5000 })
        .expect(400);
    });

    it('creates and confirms an order for checkout', async () => {
      const order = await request(app.getHttpServer())
        .post('/api/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DINE_IN',
          table: 'C1',
          items: [{ menuItemId: burgerId, quantity: 1 }],
        })
        .expect(201);
      orderId = order.body.id;
      expect(order.body.totalCents).toBe(ORDER_TOTAL_CENTS);

      const confirmed = await request(app.getHttpServer())
        .post(`/api/orders/${orderId}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect(confirmed.body.status).toBe('PENDING');
    });

    it('rejects checkout with insufficient CASH amount', async () => {
      await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          orderId,
          method: 'CASH',
          amountPaidCents: ORDER_TOTAL_CENTS - 100,
        })
        .expect(400);
    });

    it('POST /api/payments/checkout with CASH records the payment and change', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          orderId,
          method: 'CASH',
          amountPaidCents: ORDER_TOTAL_CENTS + 300,
        })
        .expect(201);

      expect(res.body.method).toBe('CASH');
      expect(res.body.status).toBe('SUCCEEDED');
      expect(res.body.amountCents).toBe(ORDER_TOTAL_CENTS);
      expect(res.body.paidCents).toBe(ORDER_TOTAL_CENTS + 300);
      expect(res.body.changeCents).toBe(300);
      expect(res.body.order.status).toBe('CONFIRMED');
      expect(res.body.id).toBeDefined();
    });

    // NOTE: checkout() validates `order.status === PENDING` before checking
    // for an existing SUCCEEDED payment. Since the first checkout already
    // moved the order to CONFIRMED, a second sequential call is rejected by
    // that guard rather than returning the idempotent payment. True
    // idempotency only protects concurrent double-submits that race before
    // the order status update commits, not sequential retries against an
    // already-confirmed order. This documents the current (unchanged)
    // service behavior — flagged as a follow-up, not fixed here per the
    // "do not modify service files" constraint of this test-only issue.
    it('rejects a second sequential checkout of the same (now CONFIRMED) order', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          orderId,
          method: 'CASH',
          amountPaidCents: ORDER_TOTAL_CENTS + 300,
        })
        .expect(400);

      expect(res.body.message).toMatch(/cannot be checked out/i);
    });

    it('GET /api/cash-register/current/summary reflects the sale', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/cash-register/current/summary')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);

      expect(res.body.summary.totalSalesCents).toBe(ORDER_TOTAL_CENTS);
      expect(res.body.summary.ticketCount).toBe(1);
      expect(res.body.summary.byMethod.CASH).toBe(ORDER_TOTAL_CENTS);
      expect(res.body.summary.byMethod.CARD).toBeUndefined();
    });

    it('POST /api/cash-register/close reconciles counted vs expected', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/cash-register/close')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ countedCents: ORDER_TOTAL_CENTS })
        .expect(200);

      expect(res.body.expectedCents).toBe(ORDER_TOTAL_CENTS);
      expect(res.body.countedCents).toBe(ORDER_TOTAL_CENTS);
      expect(res.body.differenceCents).toBe(0);
      expect(res.body.closedAt).not.toBeNull();
    });

    it('rejects closing when no active session exists', async () => {
      await request(app.getHttpServer())
        .post('/api/cash-register/close')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ countedCents: 0 })
        .expect(400);
    });

    it('GET /api/cash-register/sessions/:id/summary returns the closed session summary', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/cash-register/sessions/${sessionId}/summary`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);

      expect(res.body.session.id).toBe(sessionId);
      expect(res.body.summary.totalSalesCents).toBe(ORDER_TOTAL_CENTS);
      expect(res.body.summary.ticketCount).toBe(1);
    });
  });
});
