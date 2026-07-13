import { ValidationPipe, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Verifies OrdersService's recalculateTotals() picks up a configured,
// non-zero tax rate end-to-end (#7). Uses its own isolated Nest
// application instance with ConfigService.get('tax.rate') stubbed to a
// non-zero rate, rather than mutating process.env.TAX_RATE globally —
// this avoids leaking a non-zero tax rate into the main app.e2e-spec.ts
// suite's assumptions (which rely on the default TAX_RATE=0 behavior).
describe('Configurable tax strategy (e2e)', () => {
  let app: INestApplication;
  const TAX_RATE = 0.18; // Peru IGV

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    const configService = app.get(ConfigService);
    const originalGet = configService.get.bind(configService);
    jest.spyOn(configService, 'get').mockImplementation((key: string) => {
      if (key === 'tax.rate') {
        return TAX_RATE;
      }
      return originalGet(key);
    });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an order that reflects the configured non-zero tax rate', async () => {
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@restosync.local', password: 'Admin123!' })
      .expect(200);
    const adminToken = adminLogin.body.accessToken;

    const category = await request(app.getHttpServer())
      .post('/api/menu/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Tax_${Date.now()}` })
      .expect(201);

    const item = await request(app.getHttpServer())
      .post('/api/menu/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Taxable Burger',
        priceCents: 1000,
        categoryId: category.body.id,
      })
      .expect(201);

    const table = await request(app.getHttpServer())
      .post('/api/tables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `TX1_${Date.now()}` })
      .expect(201);

    const order = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table.body.id,
        items: [{ menuItemId: item.body.id, quantity: 2 }],
      })
      .expect(201);

    // subtotal = 1000 * 2 = 2000; tax = round(2000 * 0.18) = 360
    expect(order.body.subtotalCents).toBe(2000);
    expect(order.body.taxCents).toBe(360);
    expect(order.body.taxCents).toBeGreaterThan(0);
    // No discount applied: subtotal + tax === total.
    expect(order.body.discountCents).toBe(0);
    expect(order.body.totalCents).toBe(
      order.body.subtotalCents + order.body.taxCents,
    );
    expect(order.body.totalCents).toBe(2360);
  });
});
