import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Covers the Reservations feature end-to-end: DEPOSIT_ONLY (the most
// complete case — deposit confirmation, table commitment, discount
// application, checkout release) and INFORMAL (no table/deposit until
// the customer actually arrives).
describe('Reservations (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@restosync.local', password: 'Admin123!' })
      .expect(200);
    adminToken = adminLogin.body.accessToken;

    const cashierLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'cashier@restosync.local', password: 'Cashier123!' })
      .expect(200);
    cashierToken = cashierLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('DEPOSIT_ONLY: create -> confirm -> seat -> checkout -> table released', () => {
    let tableId: string;
    let reservationId: string;
    let orderId: string;
    let burgerId: string;
    const DEPOSIT_CENTS = 1000; // default RESERVATION_DEPOSIT_CENTS

    beforeAll(async () => {
      const table = await request(app.getHttpServer())
        .post('/api/tables')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Deposit_${Date.now()}` })
        .expect(201);
      tableId = table.body.id;

      const category = await request(app.getHttpServer())
        .post('/api/menu/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `ReservationDeposit_${Date.now()}` })
        .expect(201);

      const burger = await request(app.getHttpServer())
        .post('/api/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Reservation Deposit Burger',
          priceCents: 5000,
          categoryId: category.body.id,
        })
        .expect(201);
      burgerId = burger.body.id;

      // Clean up any register session left open by a previous test run.
      await request(app.getHttpServer())
        .post('/api/cash-register/close')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ countedCents: 0 });

      await request(app.getHttpServer())
        .post('/api/cash-register/open')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ openingFloatCents: 0 })
        .expect(201);
    });

    it('rejects reservation creation from a WAITER-equivalent/non-cashier role', async () => {
      // CUSTOMER role definitely lacks CASHIER/MANAGER/ADMIN — used here as
      // a stand-in for "not staff allowed to take reservations".
      const email = `resv_customer_${Date.now()}@example.com`;
      const register = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email, password: 'Secret123!', firstName: 'Test' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/reservations')
        .set('Authorization', `Bearer ${register.body.accessToken}`)
        .send({
          customerName: 'Jane Doe',
          customerPhone: '+51999999999',
          partySize: 2,
          reservedFor: '2026-08-01T14:00:00',
          reservationType: 'DEPOSIT_ONLY',
          tableId,
        })
        .expect(403);
    });

    it('POST /api/reservations rejects a reservedFor value with a UTC (Z) suffix', async () => {
      await request(app.getHttpServer())
        .post('/api/reservations')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          customerName: 'Jane Doe',
          customerPhone: '+51999999999',
          partySize: 2,
          reservedFor: '2026-08-01T14:00:00.000Z',
          reservationType: 'DEPOSIT_ONLY',
          tableId,
        })
        .expect(400);
    });

    it('POST /api/reservations creates a PENDING DEPOSIT_ONLY reservation with the configured fixed deposit', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reservations')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          customerName: 'Jane Doe',
          customerPhone: '+51999999999',
          partySize: 2,
          reservedFor: '2026-08-01T14:00:00',
          reservationType: 'DEPOSIT_ONLY',
          tableId,
        })
        .expect(201);

      expect(res.body.status).toBe('PENDING');
      expect(res.body.depositCents).toBe(DEPOSIT_CENTS);
      expect(res.body.orderId).toBeNull();
      // reservedFor was sent as a naive local time ("14:00", no suffix),
      // interpreted as America/Lima (UTC-5, default RESTAURANT_TIMEZONE)
      // — stored/returned reservedFor must be the correctly shifted UTC
      // instant, with reservedForLocal reflecting the original local time.
      expect(res.body.reservedFor).toBe('2026-08-01T19:00:00.000Z');
      expect(res.body.reservedForLocal).toBe('2026-08-01T14:00:00');
      reservationId = res.body.id;

      // Table is NOT committed yet — stays AVAILABLE until deposit confirmed.
      const table = await request(app.getHttpServer())
        .get(`/api/tables/${tableId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(table.body.status).toBe('AVAILABLE');
    });

    it('PATCH /api/reservations/:id/confirm marks the deposit confirmed and commits the table to RESERVED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/reservations/${reservationId}/confirm`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);

      expect(res.body.status).toBe('CONFIRMED');
      expect(res.body.depositConfirmedBy).toBeDefined();
      expect(res.body.depositConfirmedAt).toBeDefined();

      const table = await request(app.getHttpServer())
        .get(`/api/tables/${tableId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(table.body.status).toBe('RESERVED');
    });

    it('POST /api/reservations/:id/seat creates the (still-empty) order and sets the table OCCUPIED, WITHOUT applying the deposit discount yet', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/reservations/${reservationId}/seat`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({})
        .expect(201);

      // The order is created empty (no pre-order for DEPOSIT_ONLY), so the
      // deposit is deliberately NOT auto-applied as a discount yet — doing
      // so on a $0 subtotal would trip OrdersService.applyDiscount()'s
      // "discount cannot exceed subtotal" guard, which must stay intact.
      expect(res.body.discountCents).toBe(0);
      orderId = res.body.id;

      const table = await request(app.getHttpServer())
        .get(`/api/tables/${tableId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(table.body.status).toBe('OCCUPIED');
      expect(table.body.activeOrder.id).toBe(orderId);

      const reservation = await request(app.getHttpServer())
        .get(`/api/reservations/${reservationId}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);
      expect(reservation.body.status).toBe('SEATED');
      expect(reservation.body.orderId).toBe(orderId);
    });

    it('adds the pre-agreed items, staff manually applies the deposit discount, then confirms/checks out, releasing the table', async () => {
      const withItem = await request(app.getHttpServer())
        .post(`/api/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ menuItemId: burgerId, quantity: 1 })
        .expect(201);

      expect(withItem.body.totalCents).toBe(5000);

      // Now that the order has a non-zero subtotal, staff can apply the
      // reservation's deposit as a discount via the existing, unmodified
      // discount endpoint (same guard as any other order in the app).
      const withDiscount = await request(app.getHttpServer())
        .patch(`/api/orders/${orderId}/discount`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          discountType: 'FIXED',
          discountCents: DEPOSIT_CENTS,
          reason: 'Reservation deposit applied',
        })
        .expect(200);

      // subtotal 5000 - discount 1000 (deposit) = 4000
      expect(withDiscount.body.totalCents).toBe(4000);
      expect(withDiscount.body.discountCents).toBe(DEPOSIT_CENTS);

      await request(app.getHttpServer())
        .post(`/api/orders/${orderId}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      const checkout = await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId, method: 'CASH', amountPaidCents: 4000 })
        .expect(201);
      expect(checkout.body.order.status).toBe('CONFIRMED');
      expect(checkout.body.amountCents).toBe(4000);

      const table = await request(app.getHttpServer())
        .get(`/api/tables/${tableId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(table.body.status).toBe('AVAILABLE');
    });

    it('confirms the "discount cannot exceed subtotal" guard is still enforced (regression check for the applyDiscount revert)', async () => {
      const category = await request(app.getHttpServer())
        .post('/api/menu/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `GuardCheck_${Date.now()}` })
        .expect(201);

      const cheapItem = await request(app.getHttpServer())
        .post('/api/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Guard Check Item',
          priceCents: 500,
          categoryId: category.body.id,
        })
        .expect(201);

      const table = await request(app.getHttpServer())
        .post('/api/tables')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `GuardCheck_${Date.now()}` })
        .expect(201);

      const order = await request(app.getHttpServer())
        .post('/api/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DINE_IN',
          tableId: table.body.id,
          items: [{ menuItemId: cheapItem.body.id, quantity: 1 }],
        })
        .expect(201);
      expect(order.body.totalCents).toBe(500);

      const res = await request(app.getHttpServer())
        .patch(`/api/orders/${order.body.id}/discount`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          discountType: 'FIXED',
          discountCents: 10000,
          reason: 'too much',
        })
        .expect(400);

      expect(res.body.message).toMatch(/cannot exceed order subtotal/i);
    });

    afterAll(async () => {
      await request(app.getHttpServer())
        .post('/api/cash-register/close')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ countedCents: 4000 });
    });
  });

  describe('INFORMAL: create -> confirm -> seat with staff-chosen table -> no discount', () => {
    let reservationId: string;
    let tableId: string;

    it('POST /api/reservations rejects tableId/items for INFORMAL', async () => {
      await request(app.getHttpServer())
        .post('/api/reservations')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          customerName: 'Informal Guest',
          customerPhone: '+51988888888',
          partySize: 3,
          reservedFor: '2026-08-02T10:00:00',
          reservationType: 'INFORMAL',
          tableId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
    });

    it('POST /api/reservations creates a PENDING INFORMAL reservation with no table/order/deposit', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reservations')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          customerName: 'Informal Guest',
          customerPhone: '+51988888888',
          partySize: 3,
          reservedFor: '2026-08-02T10:00:00',
          reservationType: 'INFORMAL',
        })
        .expect(201);

      expect(res.body.status).toBe('PENDING');
      expect(res.body.depositCents).toBe(0);
      expect(res.body.tableId).toBeNull();
      expect(res.body.orderId).toBeNull();
      reservationId = res.body.id;
    });

    it('PATCH /api/reservations/:id/confirm does not touch any table', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/reservations/${reservationId}/confirm`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);

      expect(res.body.status).toBe('CONFIRMED');
    });

    it('POST /api/reservations/:id/seat requires a staff-chosen tableId', async () => {
      await request(app.getHttpServer())
        .post(`/api/reservations/${reservationId}/seat`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({})
        .expect(400);
    });

    it('POST /api/reservations/:id/seat with tableId creates the order with no discount applied', async () => {
      const table = await request(app.getHttpServer())
        .post('/api/tables')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Informal_${Date.now()}` })
        .expect(201);
      tableId = table.body.id;

      const res = await request(app.getHttpServer())
        .post(`/api/reservations/${reservationId}/seat`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ tableId })
        .expect(201);

      expect(res.body.discountCents).toBe(0);

      const table2 = await request(app.getHttpServer())
        .get(`/api/tables/${tableId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(table2.body.status).toBe('OCCUPIED');

      const reservation = await request(app.getHttpServer())
        .get(`/api/reservations/${reservationId}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);
      expect(reservation.body.status).toBe('SEATED');
      expect(reservation.body.tableId).toBe(tableId);
    });
  });

  describe('no-show / cancel release the table without reapplying the deposit', () => {
    it('no-show releases a RESERVED table back to AVAILABLE', async () => {
      const table = await request(app.getHttpServer())
        .post('/api/tables')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `NoShow_${Date.now()}` })
        .expect(201);

      const reservation = await request(app.getHttpServer())
        .post('/api/reservations')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          customerName: 'No Show Guest',
          customerPhone: '+51977777777',
          partySize: 2,
          reservedFor: '2026-08-03T10:00:00',
          reservationType: 'DEPOSIT_ONLY',
          tableId: table.body.id,
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/reservations/${reservation.body.id}/confirm`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);

      const reservedTable = await request(app.getHttpServer())
        .get(`/api/tables/${table.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(reservedTable.body.status).toBe('RESERVED');

      const noShow = await request(app.getHttpServer())
        .patch(`/api/reservations/${reservation.body.id}/no-show`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);
      expect(noShow.body.status).toBe('NO_SHOW');

      const releasedTable = await request(app.getHttpServer())
        .get(`/api/tables/${table.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(releasedTable.body.status).toBe('AVAILABLE');
    });

    it('rejects no-show/cancel on an already-terminal reservation', async () => {
      const table = await request(app.getHttpServer())
        .post('/api/tables')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Terminal_${Date.now()}` })
        .expect(201);

      const reservation = await request(app.getHttpServer())
        .post('/api/reservations')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          customerName: 'Terminal Guest',
          customerPhone: '+51966666666',
          partySize: 2,
          reservedFor: '2026-08-04T10:00:00',
          reservationType: 'DEPOSIT_ONLY',
          tableId: table.body.id,
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/reservations/${reservation.body.id}/cancel`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/reservations/${reservation.body.id}/cancel`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .patch(`/api/reservations/${reservation.body.id}/no-show`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(400);
    });
  });

  describe('GET /api/reservations filtering', () => {
    it('filters by status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/reservations')
        .query({ status: 'SEATED', limit: 100 })
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      for (const reservation of res.body) {
        expect(reservation.status).toBe('SEATED');
      }
    });

    it('filters by reservedFor date', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/reservations')
        .query({ date: '2026-08-02', limit: 100 })
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(
        res.body.every((r: { reservedFor: string }) =>
          r.reservedFor.startsWith('2026-08-02'),
        ),
      ).toBe(true);
    });
  });
});
