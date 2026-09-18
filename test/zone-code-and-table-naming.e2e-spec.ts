import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Covers the zone code field (validation + restaurant-scoped uniqueness), the
// GET /zones/:id/next-table-name suggestion endpoint, and the table-name
// normalization used for duplicate detection.
describe('Zone code & table naming (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const ts = Date.now();
  const seededRestaurantId = '00000000-0000-4000-8000-000000000001';

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

    prisma = app.get(PrismaService);

    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@restosync.local', password: 'Admin123!' })
      .expect(200);
    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('zone code validation', () => {
    it('rejects a code with spaces with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/zones')
        .set(auth(adminToken))
        .send({ name: `BadCode_${Date.now()}`, code: 'a b' })
        .expect(400);
    });

    it('rejects a code with special characters with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/zones')
        .set(auth(adminToken))
        .send({ name: `BadCode_${Date.now()}`, code: 'a-b' })
        .expect(400);
    });

    it('rejects a code longer than 10 characters with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/zones')
        .set(auth(adminToken))
        .send({ name: `BadCode_${Date.now()}`, code: '12345678901' })
        .expect(400);
    });

    it('rejects a missing code with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/zones')
        .set(auth(adminToken))
        .send({ name: `BadCode_${Date.now()}` })
        .expect(400);
    });

    it('rejects a duplicate code (case-insensitively) with 400', async () => {
      const code = `C${String(Date.now()).slice(-9)}`;
      await request(app.getHttpServer())
        .post('/api/zones')
        .set(auth(adminToken))
        .send({ name: `Code1_${Date.now()}`, code })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/zones')
        .set(auth(adminToken))
        .send({ name: `Code2_${Date.now()}`, code: code.toLowerCase() })
        .expect(400);

      expect(res.body.message).toMatch(/already exists/i);
    });
  });

  describe('GET /zones/:id/next-table-name', () => {
    it('suggests "{code}01" for an empty zone', async () => {
      const code = `N${String(Date.now()).slice(-9)}`;
      const zone = await request(app.getHttpServer())
        .post('/api/zones')
        .set(auth(adminToken))
        .send({ name: `Next_${Date.now()}`, code })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/zones/${zone.body.id}/next-table-name`)
        .set(auth(adminToken))
        .expect(200);

      expect(res.body).toEqual({ suggestedName: `${code}01` });
    });

    it('reuses a gap left by a deleted table ({code}01 and {code}03 exist)', async () => {
      const code = `G${String(Date.now()).slice(-9)}`;
      const zone = await request(app.getHttpServer())
        .post('/api/zones')
        .set(auth(adminToken))
        .send({ name: `Gap_${Date.now()}`, code })
        .expect(201);

      await prisma.table.createMany({
        data: [
          {
            name: `${code}01`,
            restaurantId: seededRestaurantId,
            zoneId: zone.body.id,
          },
          {
            name: `${code}03`,
            restaurantId: seededRestaurantId,
            zoneId: zone.body.id,
          },
        ],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/zones/${zone.body.id}/next-table-name`)
        .set(auth(adminToken))
        .expect(200);

      expect(res.body).toEqual({ suggestedName: `${code}02` });
    });

    it('returns 404 for a zone in another restaurant', async () => {
      const resB = await request(app.getHttpServer())
        .post('/api/restaurants')
        .set(auth(adminToken))
        .send({ name: `Cross Tenant ${ts}` })
        .expect(201);
      const restaurantBId = resB.body.id;

      const staffBEmail = `cross_tenant_${ts}@example.com`;
      await prisma.user.create({
        data: {
          email: staffBEmail,
          passwordHash: await bcrypt.hash('CrossB123!', 10),
          role: Role.ADMIN,
          restaurantId: restaurantBId,
          firstName: 'Cross',
          lastName: 'Tenant',
        },
      });

      const loginB = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: staffBEmail, password: 'CrossB123!' })
        .expect(200);
      const staffBToken = loginB.body.accessToken;

      const zoneB = await request(app.getHttpServer())
        .post('/api/zones')
        .set(auth(staffBToken))
        .send({ name: `ZoneB_${Date.now()}`, code: 'B' })
        .expect(201);

      // The admin of restaurant A cannot read a zone of restaurant B.
      await request(app.getHttpServer())
        .get(`/api/zones/${zoneB.body.id}/next-table-name`)
        .set(auth(adminToken))
        .expect(404);
    });
  });

  describe('table name normalization', () => {
    it('rejects whitespace/casing variations as duplicates with 400', async () => {
      const base = `Norm_${Date.now()}`;
      await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(adminToken))
        .send({ name: base })
        .expect(201);

      const spaced = await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(adminToken))
        .send({ name: `  ${base.toUpperCase()}   ` })
        .expect(400);
      expect(spaced.body.message).toMatch(/already exists/i);

      const cased = await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(adminToken))
        .send({ name: base.toUpperCase() })
        .expect(400);
      expect(cased.body.message).toMatch(/already exists/i);
    });

    it('allows a name that differs only by a removed space', async () => {
      const withSpace = `Space_${Date.now()} 1`;
      await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(adminToken))
        .send({ name: withSpace })
        .expect(201);

      // "Space_...1" (no space) is a genuinely different name.
      await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(adminToken))
        .send({ name: withSpace.replace(' ', '') })
        .expect(201);
    });
  });
});
