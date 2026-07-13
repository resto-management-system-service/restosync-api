import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Covers the Table entity feature end-to-end: the table lifecycle tied to
// orders (AVAILABLE -> OCCUPIED -> AVAILABLE on checkout) and the
// TablesController CRUD endpoints.
describe('Tables (e2e)', () => {
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

  describe('full flow: open table -> order -> retry -> checkout -> release', () => {
    const ORDER_TOTAL_CENTS = 1000;
    let categoryId: string;
    let burgerId: string;
    let friesId: string;
    let tableId: string;
    let orderId: string;
    let orderItemId: string;

    beforeAll(async () => {
      const category = await request(app.getHttpServer())
        .post('/api/menu/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `TableFlow_${Date.now()}` })
        .expect(201);
      categoryId = category.body.id;

      const burger = await request(app.getHttpServer())
        .post('/api/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Table Flow Burger',
          priceCents: ORDER_TOTAL_CENTS,
          categoryId,
        })
        .expect(201);
      burgerId = burger.body.id;

      const fries = await request(app.getHttpServer())
        .post('/api/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Table Flow Fries',
          priceCents: 500,
          categoryId,
        })
        .expect(201);
      friesId = fries.body.id;

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

    it('creates a table in AVAILABLE status', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tables')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Flow_${Date.now()}`, capacity: 4 })
        .expect(201);

      expect(res.body.status).toBe('AVAILABLE');
      tableId = res.body.id;
    });

    it('creates a DINE_IN order for the table, which becomes OCCUPIED', async () => {
      const order = await request(app.getHttpServer())
        .post('/api/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DINE_IN',
          tableId,
          items: [{ menuItemId: burgerId, quantity: 1 }],
        })
        .expect(201);
      orderId = order.body.id;
      expect(order.body.totalCents).toBe(ORDER_TOTAL_CENTS);

      const table = await request(app.getHttpServer())
        .get(`/api/tables/${tableId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(table.body.status).toBe('OCCUPIED');
      expect(table.body.activeOrder.id).toBe(orderId);
    });

    it('returns the SAME order instead of creating a duplicate when opening the occupied table again', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DINE_IN',
          tableId,
          items: [{ menuItemId: burgerId, quantity: 1 }],
        })
        .expect(201);

      expect(res.body.id).toBe(orderId);
    });

    it('adds items to the same order via POST /orders/:id/items', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ menuItemId: friesId, quantity: 1 })
        .expect(201);

      expect(res.body.totalCents).toBe(ORDER_TOTAL_CENTS + 500);
      const friesItem = res.body.items.find(
        (item: { menuItemId: string }) => item.menuItemId === friesId,
      );
      orderItemId = friesItem.id;
      expect(orderItemId).toBeDefined();
    });

    it('confirms the order (DRAFT -> PENDING)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/orders/${orderId}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body.status).toBe('PENDING');
    });

    it('checks out the order and releases the table back to AVAILABLE', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          orderId,
          method: 'CASH',
          amountPaidCents: ORDER_TOTAL_CENTS + 500,
        })
        .expect(201);
      expect(res.body.order.status).toBe('CONFIRMED');

      const table = await request(app.getHttpServer())
        .get(`/api/tables/${tableId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(table.body.status).toBe('AVAILABLE');
      expect(table.body.activeOrder).toBeNull();
    });

    afterAll(async () => {
      await request(app.getHttpServer())
        .post('/api/cash-register/close')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ countedCents: ORDER_TOTAL_CENTS + 500 });
    });
  });

  describe('POST /api/orders validation', () => {
    it('rejects a DINE_IN order without tableId', async () => {
      const category = await request(app.getHttpServer())
        .post('/api/menu/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `NoTable_${Date.now()}` })
        .expect(201);

      const item = await request(app.getHttpServer())
        .post('/api/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'No Table Item',
          priceCents: 500,
          categoryId: category.body.id,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DINE_IN',
          items: [{ menuItemId: item.body.id, quantity: 1 }],
        })
        .expect(400);
    });

    it('throws NotFoundException for a nonexistent tableId', async () => {
      const category = await request(app.getHttpServer())
        .post('/api/menu/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `BadTable_${Date.now()}` })
        .expect(201);

      const item = await request(app.getHttpServer())
        .post('/api/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Bad Table Item',
          priceCents: 500,
          categoryId: category.body.id,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DINE_IN',
          tableId: '00000000-0000-4000-8000-000000000000',
          items: [{ menuItemId: item.body.id, quantity: 1 }],
        })
        .expect(404);
    });
  });

  describe('TablesController CRUD', () => {
    let tableId: string;

    it('POST /api/tables creates a table', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tables')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `CRUD_${Date.now()}`, capacity: 2 })
        .expect(201);

      expect(res.body.status).toBe('AVAILABLE');
      expect(res.body.capacity).toBe(2);
      tableId = res.body.id;
    });

    it('rejects table creation from a non-manager role', async () => {
      await request(app.getHttpServer())
        .post('/api/tables')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ name: `Rejected_${Date.now()}` })
        .expect(403);
    });

    it('GET /api/tables lists all tables', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tables')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((t: { id: string }) => t.id === tableId)).toBe(true);
    });

    it('GET /api/tables/:id returns a single table', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tables/${tableId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.id).toBe(tableId);
    });

    it('GET /api/tables/:id returns 404 for a nonexistent table', async () => {
      await request(app.getHttpServer())
        .get('/api/tables/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('PATCH /api/tables/:id updates name/capacity', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/tables/${tableId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ capacity: 6 })
        .expect(200);

      expect(res.body.capacity).toBe(6);
    });

    it('DELETE /api/tables/:id deletes an AVAILABLE table', async () => {
      await request(app.getHttpServer())
        .delete(`/api/tables/${tableId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/tables/${tableId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('DELETE /api/tables/:id rejects deleting an OCCUPIED table', async () => {
      const table = await request(app.getHttpServer())
        .post('/api/tables')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Occupied_${Date.now()}` })
        .expect(201);
      const occupiedTableId = table.body.id;

      const category = await request(app.getHttpServer())
        .post('/api/menu/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `OccupiedDelete_${Date.now()}` })
        .expect(201);

      const item = await request(app.getHttpServer())
        .post('/api/menu/items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Occupied Delete Item',
          priceCents: 500,
          categoryId: category.body.id,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DINE_IN',
          tableId: occupiedTableId,
          items: [{ menuItemId: item.body.id, quantity: 1 }],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .delete(`/api/tables/${occupiedTableId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      expect(res.body.message).toMatch(/occupied/i);
    });
  });
});
