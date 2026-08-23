import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Covers #148: onboarding a new restaurant. The Restaurant row is the
// tenant root — creating one provisions an empty, isolated data space
// (enforced by the #152 restaurantId scoping already in every service);
// no child data is auto-provisioned.
describe('Restaurants (e2e)', () => {
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

  describe('POST /restaurants', () => {
    it('ADMIN creates a new restaurant', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/restaurants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `La Mar ${Date.now()}` })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toContain('La Mar');
      expect(res.body.timezone).toBe('America/Lima');
    });

    it('ADMIN can create a restaurant with a custom timezone', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/restaurants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Madrid ${Date.now()}`, timezone: 'Europe/Madrid' })
        .expect(201);

      expect(res.body.timezone).toBe('Europe/Madrid');
    });

    it('rejects a missing name with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/restaurants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ timezone: 'America/Lima' })
        .expect(400);
    });

    it('non-admin role (CASHIER) is rejected with 403', async () => {
      await request(app.getHttpServer())
        .post('/api/restaurants')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ name: 'Nope' })
        .expect(403);
    });

    it('unauthenticated request is rejected with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/restaurants')
        .send({ name: 'Nope' })
        .expect(401);
    });
  });

  describe('GET /restaurants', () => {
    it('ADMIN can list all restaurants', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/restaurants')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // At minimum the default "El Buen Filo" restaurant from #149 exists.
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('non-admin role (CASHIER) is rejected with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/restaurants')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(403);
    });

    it('unauthenticated request is rejected with 401', async () => {
      await request(app.getHttpServer()).get('/api/restaurants').expect(401);
    });
  });
});
