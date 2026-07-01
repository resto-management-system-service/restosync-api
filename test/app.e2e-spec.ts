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
});
