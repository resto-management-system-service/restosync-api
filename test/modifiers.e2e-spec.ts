import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Covers Epic #6 end-to-end: a manager defines modifier groups/options on a
// menu item; order creation validates the selection, prices it server-side,
// and snapshots it onto the order item.
describe('Menu item modifiers (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;

  let categoryId: string;
  let itemId: string;
  let regularId: string;
  let largeId: string;
  let baconId: string;

  const BASE = 1500;

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

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@restosync.local', password: 'Admin123!' })
      .expect(200);
    adminToken = login.body.accessToken;

    const category = await request(app.getHttpServer())
      .post('/api/menu/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Mods_${Date.now()}` })
      .expect(201);
    categoryId = category.body.id;

    const item = await request(app.getHttpServer())
      .post('/api/menu/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Mod Burger ${Date.now()}`, priceCents: BASE, categoryId })
      .expect(201);
    itemId = item.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a required single-select group with nested options', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/menu/items/${itemId}/modifier-groups`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Size',
        required: true,
        minSelect: 1,
        maxSelect: 1,
        modifiers: [
          { name: 'Regular', priceDeltaCents: 0 },
          { name: 'Large', priceDeltaCents: 300 },
        ],
      })
      .expect(201);

    regularId = res.body.modifiers.find(
      (m: { name: string }) => m.name === 'Regular',
    ).id;
    largeId = res.body.modifiers.find(
      (m: { name: string }) => m.name === 'Large',
    ).id;
    expect(res.body.required).toBe(true);
  });

  it('rejects a group where minSelect > maxSelect', async () => {
    await request(app.getHttpServer())
      .post(`/api/menu/items/${itemId}/modifier-groups`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bad', minSelect: 3, maxSelect: 1 })
      .expect(400);
  });

  it('adds an optional extras group + option', async () => {
    const group = await request(app.getHttpServer())
      .post(`/api/menu/items/${itemId}/modifier-groups`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Extras', maxSelect: 2 })
      .expect(201);

    const bacon = await request(app.getHttpServer())
      .post(`/api/menu/modifier-groups/${group.body.id}/modifiers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bacon', priceDeltaCents: 150 })
      .expect(201);
    baconId = bacon.body.id;
  });

  it('exposes groups on the public menu item read', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/menu/items/${itemId}`)
      .expect(200);
    expect(res.body.modifierGroups).toHaveLength(2);
  });

  it('rejects an order that omits the required group', async () => {
    await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ menuItemId: itemId, quantity: 1 }],
      })
      .expect(400);
  });

  it('rejects an order selecting a modifier that is not on the item', async () => {
    await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [
          {
            menuItemId: itemId,
            quantity: 1,
            modifierIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
          },
        ],
      })
      .expect(400);
  });

  it('rejects exceeding maxSelect on the size group', async () => {
    await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [
          {
            menuItemId: itemId,
            quantity: 1,
            modifierIds: [regularId, largeId],
          },
        ],
      })
      .expect(400);
  });

  it('prices a valid selection server-side and snapshots it', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [
          { menuItemId: itemId, quantity: 2, modifierIds: [largeId, baconId] },
        ],
      })
      .expect(201);

    // (1500 + 300 + 150) * 2 = 3900
    expect(res.body.subtotalCents).toBe(3900);
    const line = res.body.items[0];
    expect(line.lineTotalCents).toBe(3900);
    expect(line.modifierDeltaCents).toBe(450);
    expect(line.modifiers.map((m: { name: string }) => m.name).sort()).toEqual([
      'Bacon',
      'Large',
    ]);
    expect(line.modifiers[0]).toHaveProperty('priceDeltaCents');
  });

  it('recomputes totals when adding a modified line to an open order', async () => {
    const order = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ menuItemId: itemId, quantity: 1, modifierIds: [regularId] }],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/orders/${order.body.id}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        menuItemId: itemId,
        quantity: 1,
        modifierIds: [largeId, baconId],
      })
      .expect(201);

    // line A: 1500 ; line B: 1500 + 300 + 150 = 1950 ; subtotal 3450
    expect(res.body.subtotalCents).toBe(3450);
  });
});
