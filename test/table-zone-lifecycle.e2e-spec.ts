import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Covers the status-based edit/delete lifecycle rules for tables and zones,
// and reproduces (at the API level) the reported "cannot reuse a name after
// deleting" bug to determine whether it's a backend or frontend concern.
describe('Table & Zone lifecycle rules (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const ts = Date.now();

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

  async function createOccupiedTable(prefix: string): Promise<string> {
    const table = await request(app.getHttpServer())
      .post('/api/tables')
      .set(auth(adminToken))
      .send({ name: `${prefix}_${Date.now()}` })
      .expect(201);
    const tableId = table.body.id;

    const category = await request(app.getHttpServer())
      .post('/api/menu/categories')
      .set(auth(adminToken))
      .send({ name: `Cat_${Date.now()}` })
      .expect(201);
    const item = await request(app.getHttpServer())
      .post('/api/menu/items')
      .set(auth(adminToken))
      .send({
        name: `Item_${Date.now()}`,
        priceCents: 1000,
        categoryId: category.body.id,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/orders')
      .set(auth(adminToken))
      .send({
        type: 'DINE_IN',
        tableId,
        items: [{ menuItemId: item.body.id, quantity: 1 }],
      })
      .expect(201);

    return tableId;
  }

  describe('Table edit/delete status rules', () => {
    it('edits and deletes an AVAILABLE table', async () => {
      const table = await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(adminToken))
        .send({ name: `Editable_${Date.now()}` })
        .expect(201);
      const tableId = table.body.id;

      await request(app.getHttpServer())
        .patch(`/api/tables/${tableId}`)
        .set(auth(adminToken))
        .send({ capacity: 8 })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/tables/${tableId}`)
        .set(auth(adminToken))
        .expect(200);
    });

    it('rejects editing an OCCUPIED table with 400', async () => {
      const tableId = await createOccupiedTable('OccEdit');

      const res = await request(app.getHttpServer())
        .patch(`/api/tables/${tableId}`)
        .set(auth(adminToken))
        .send({ capacity: 8 })
        .expect(400);

      expect(res.body.message).toMatch(/reserved or occupied/i);
    });

    it('rejects deleting an OCCUPIED table with 400', async () => {
      const tableId = await createOccupiedTable('OccDelete');

      const res = await request(app.getHttpServer())
        .delete(`/api/tables/${tableId}`)
        .set(auth(adminToken))
        .expect(400);

      expect(res.body.message).toMatch(/reserved or occupied/i);
    });

    it('still updates the layout of an OCCUPIED table (not status-restricted)', async () => {
      const tableId = await createOccupiedTable('OccLayout');

      const res = await request(app.getHttpServer())
        .patch(`/api/tables/${tableId}/layout`)
        .set(auth(adminToken))
        .send({ positionX: 0.42, positionY: 0.42 })
        .expect(200);

      expect(res.body.positionX).toBe(0.42);
    });
  });

  describe('Zone rename/delete rules', () => {
    it('renames a zone that has an OCCUPIED table', async () => {
      const zone = await request(app.getHttpServer())
        .post('/api/zones')
        .set(auth(adminToken))
        .send({ name: `RenameZone_${Date.now()}` })
        .expect(201);
      const zoneId = zone.body.id;

      const tableId = await createOccupiedTable('ZoneRename');
      await request(app.getHttpServer())
        .patch(`/api/tables/${tableId}/layout`)
        .set(auth(adminToken))
        .send({ zoneId })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/api/zones/${zoneId}`)
        .set(auth(adminToken))
        .send({ name: `Renamed_${Date.now()}` })
        .expect(200);

      expect(res.body.name).toMatch(/^Renamed_/);
    });

    it('rejects deleting a zone that has an OCCUPIED table with 400', async () => {
      const zone = await request(app.getHttpServer())
        .post('/api/zones')
        .set(auth(adminToken))
        .send({ name: `BlockedZone_${Date.now()}` })
        .expect(201);
      const zoneId = zone.body.id;

      const tableId = await createOccupiedTable('ZoneBlock');
      await request(app.getHttpServer())
        .patch(`/api/tables/${tableId}/layout`)
        .set(auth(adminToken))
        .send({ zoneId })
        .expect(200);

      const res = await request(app.getHttpServer())
        .delete(`/api/zones/${zoneId}`)
        .set(auth(adminToken))
        .expect(400);

      expect(res.body.message).toMatch(/reserved or occupied/i);
    });
  });

  describe('name reuse after delete', () => {
    it('allows recreating a table with the same name after deletion (same restaurant)', async () => {
      const name = `ReuseTable_${Date.now()}`;
      const table = await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(adminToken))
        .send({ name })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/tables/${table.body.id}`)
        .set(auth(adminToken))
        .expect(200);

      const recreated = await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(adminToken))
        .send({ name })
        .expect(201);

      expect(recreated.body.name).toBe(name);
      expect(recreated.body.id).not.toBe(table.body.id);
    });

    it('allows recreating a zone with the same name after deletion', async () => {
      const name = `ReuseZone_${Date.now()}`;
      const zone = await request(app.getHttpServer())
        .post('/api/zones')
        .set(auth(adminToken))
        .send({ name })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/zones/${zone.body.id}`)
        .set(auth(adminToken))
        .expect(200);

      const recreated = await request(app.getHttpServer())
        .post('/api/zones')
        .set(auth(adminToken))
        .send({ name })
        .expect(201);

      expect(recreated.body.name).toBe(name);
    });

    it('allows two DIFFERENT restaurants to each have a table with the same name', async () => {
      const name = `SameName_${Date.now()}`;

      // Restaurant A (the seeded admin's default restaurant).
      await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(adminToken))
        .send({ name })
        .expect(201);

      // A second, independent restaurant with its own staff account.
      const resB = await request(app.getHttpServer())
        .post('/api/restaurants')
        .set(auth(adminToken))
        .send({ name: `Reuse Tenant ${ts}` })
        .expect(201);
      const restaurantBId = resB.body.id;

      const staffBEmail = `reuse_tenant_${ts}@example.com`;
      await prisma.user.create({
        data: {
          email: staffBEmail,
          passwordHash: await bcrypt.hash('ReuseB123!', 10),
          role: Role.ADMIN,
          restaurantId: restaurantBId,
          firstName: 'Reuse',
          lastName: 'Tenant',
        },
      });

      const loginB = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: staffBEmail, password: 'ReuseB123!' })
        .expect(200);
      const staffBToken = loginB.body.accessToken;

      const tableB = await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(staffBToken))
        .send({ name })
        .expect(201);

      expect(tableB.body.name).toBe(name);
    });
  });
});
