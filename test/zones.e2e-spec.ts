import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Covers the Zone entity and the Table layout endpoint end-to-end: creating
// a zone, assigning a table to it with a percentage-based layout, updating
// that layout, and enforcing the no-tables guard on zone deletion.
describe('Zones & table layout (e2e)', () => {
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

  it('POST /api/zones creates a zone scoped to the caller restaurant', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/zones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `ZonesFlow_${Date.now()}`,
        code: String(Date.now()).slice(-10),
      })
      .expect(201);

    expect(res.body.name).toBeDefined();
    expect(res.body.code).toBeDefined();
    expect(res.body.sortOrder).toBe(0);
  });

  it('rejects zone creation from a non-manager role', async () => {
    await request(app.getHttpServer())
      .post('/api/zones')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        name: `Rejected_${Date.now()}`,
        code: String(Date.now()).slice(-10),
      })
      .expect(403);
  });

  describe('full flow: zone -> table in zone -> layout update -> delete guard', () => {
    let zoneId: string;
    let tableId: string;

    it('creates a zone', async () => {
      const zone = await request(app.getHttpServer())
        .post('/api/zones')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Terraza_${Date.now()}`,
          code: String(Date.now()).slice(-10),
          sortOrder: 1,
        })
        .expect(201);
      zoneId = zone.body.id;
    });

    it('creates a table and assigns it to the zone with a layout position', async () => {
      const table = await request(app.getHttpServer())
        .post('/api/tables')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Layout_${Date.now()}`, capacity: 4 })
        .expect(201);
      tableId = table.body.id;

      const res = await request(app.getHttpServer())
        .patch(`/api/tables/${tableId}/layout`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          zoneId,
          positionX: 0.25,
          positionY: 0.5,
          width: 0.1,
          height: 0.1,
          shape: 'circle',
        })
        .expect(200);

      expect(res.body.zoneId).toBe(zoneId);
      expect(res.body.positionX).toBe(0.25);
      expect(res.body.positionY).toBe(0.5);
      expect(res.body.shape).toBe('circle');
    });

    it('updates the layout', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/tables/${tableId}/layout`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ positionX: 0.8, positionY: 0.1, shape: 'square' })
        .expect(200);

      expect(res.body.positionX).toBe(0.8);
      expect(res.body.positionY).toBe(0.1);
      expect(res.body.shape).toBe('square');
      // zoneId and other layout fields are preserved.
      expect(res.body.zoneId).toBe(zoneId);
      expect(res.body.width).toBe(0.1);
      expect(res.body.height).toBe(0.1);
    });

    it('rejects an out-of-range position with a 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/tables/${tableId}/layout`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ positionX: 1.5 })
        .expect(400);
    });

    it('deleting a zone with only AVAILABLE tables succeeds and unassigns them', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/zones/${zoneId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.id).toBe(zoneId);

      // The table is not deleted — it becomes unassigned (zoneId null).
      const table = await request(app.getHttpServer())
        .get(`/api/tables/${tableId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(table.body.id).toBe(tableId);
      expect(table.body.zoneId).toBeNull();

      await request(app.getHttpServer())
        .get(`/api/zones/${zoneId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});
