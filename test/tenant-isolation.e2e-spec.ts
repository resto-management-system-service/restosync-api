import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// #153: end-to-end proof that cross-tenant isolation holds through the REAL
// HTTP + WebSocket stack. Two real restaurants, two real staff accounts,
// and real data created via the public API (not mocks). Each scenario
// asserts the specific expected status code (404) AND the specific absence
// of data — explicitly proving the wrong thing did NOT happen, not just
// that the right thing did.

const EVENT_TIMEOUT_MS = 5000;
const NO_EVENT_WINDOW_MS = 1000;

function waitForEvent<T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = EVENT_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, onEvent);
    };
    const onEvent = (data: T) => {
      cleanup();
      resolve(data);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for socket event '${event}'`));
    }, timeoutMs);
    socket.on(event, onEvent);
  });
}

function waitForNoEvent(
  socket: Socket,
  event: string,
  timeoutMs = NO_EVENT_WINDOW_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, onEvent);
    };
    const onEvent = () => {
      settled = true;
      cleanup();
      reject(new Error(`Did not expect socket event '${event}'`));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      resolve();
    }, timeoutMs);
    socket.on(event, onEvent);
  });
}

function connect(port: number, token?: string): Socket {
  return io(`http://127.0.0.1:${port}`, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
}

describe('Tenant Isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let port: number;

  let adminToken: string;
  let staffAToken: string;
  let staffBToken: string;

  let restaurantAId: string;
  let restaurantBId: string;
  let menuItemAId: string;
  let menuItemBId: string;

  const sockets: Socket[] = [];
  const ts = Date.now();

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

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
    await app.listen(0, '127.0.0.1');

    prisma = app.get(PrismaService);
    port = app.getHttpServer().address().port;

    // Seeded platform admin (used only to onboard restaurants via #148).
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@restosync.local', password: 'Admin123!' })
      .expect(200);
    adminToken = adminLogin.body.accessToken;

    // Two real restaurants.
    const resA = await request(app.getHttpServer())
      .post('/api/restaurants')
      .set(auth(adminToken))
      .send({ name: `Tenant A ${ts}` })
      .expect(201);
    restaurantAId = resA.body.id;

    const resB = await request(app.getHttpServer())
      .post('/api/restaurants')
      .set(auth(adminToken))
      .send({ name: `Tenant B ${ts}` })
      .expect(201);
    restaurantBId = resB.body.id;

    // register() still assigns the default restaurant, so staff accounts
    // are created directly via Prisma with an explicit restaurantId.
    const staffAEmail = `tenant_a_${ts}@example.com`;
    const staffBEmail = `tenant_b_${ts}@example.com`;
    await prisma.user.create({
      data: {
        email: staffAEmail,
        passwordHash: await bcrypt.hash('TenantA123!', 10),
        role: Role.ADMIN,
        restaurantId: restaurantAId,
        firstName: 'Tenant',
        lastName: 'A',
      },
    });
    await prisma.user.create({
      data: {
        email: staffBEmail,
        passwordHash: await bcrypt.hash('TenantB123!', 10),
        role: Role.ADMIN,
        restaurantId: restaurantBId,
        firstName: 'Tenant',
        lastName: 'B',
      },
    });

    const loginA = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: staffAEmail, password: 'TenantA123!' })
      .expect(200);
    staffAToken = loginA.body.accessToken;

    const loginB = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: staffBEmail, password: 'TenantB123!' })
      .expect(200);
    staffBToken = loginB.body.accessToken;

    // Menu fixtures scoped to each restaurant (menu-item creation is
    // ADMIN-only via HTTP and the seeded admin lives in the default
    // restaurant, so fixtures are created directly here).
    const categoryA = await prisma.category.create({
      data: { name: `Cat A ${ts}`, restaurantId: restaurantAId },
    });
    const categoryB = await prisma.category.create({
      data: { name: `Cat B ${ts}`, restaurantId: restaurantBId },
    });
    const itemA = await prisma.menuItem.create({
      data: {
        name: `Burger A ${ts}`,
        priceCents: 1200,
        categoryId: categoryA.id,
        restaurantId: restaurantAId,
      },
    });
    const itemB = await prisma.menuItem.create({
      data: {
        name: `Burger B ${ts}`,
        priceCents: 1200,
        categoryId: categoryB.id,
        restaurantId: restaurantBId,
      },
    });
    menuItemAId = itemA.id;
    menuItemBId = itemB.id;
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      socket.close();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('(a) Restaurant B staff cannot read Restaurant A data', () => {
    it('A creates Order/Table/Reservation/InventoryItem; B sees 404 by id and absence in lists', async () => {
      const table = await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(staffAToken))
        .send({ name: `TblA ${ts}` })
        .expect(201);

      const inventory = await request(app.getHttpServer())
        .post('/api/inventory')
        .set(auth(staffAToken))
        .send({ name: `InvA ${ts}`, unit: 'kg', quantityOnHand: 10 })
        .expect(201);

      const reservation = await request(app.getHttpServer())
        .post('/api/reservations')
        .set(auth(staffAToken))
        .send({
          customerName: 'Jane Doe',
          customerPhone: '+51999999999',
          partySize: 2,
          reservedFor: '2099-01-01T14:00:00',
          reservationType: 'INFORMAL',
        })
        .expect(201);

      const order = await request(app.getHttpServer())
        .post('/api/orders')
        .set(auth(staffAToken))
        .send({ type: 'TAKEAWAY', items: [{ menuItemId: menuItemAId, quantity: 1 }] })
        .expect(201);

      // B cannot fetch any of A's records by id — 404, not 403, not data.
      await request(app.getHttpServer())
        .get(`/api/tables/${table.body.id}`)
        .set(auth(staffBToken))
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/inventory/${inventory.body.id}`)
        .set(auth(staffBToken))
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/reservations/${reservation.body.id}`)
        .set(auth(staffBToken))
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/orders/${order.body.id}`)
        .set(auth(staffBToken))
        .expect(404);

      // B's lists do not contain A's records.
      const tablesB = await request(app.getHttpServer())
        .get('/api/tables')
        .set(auth(staffBToken))
        .expect(200);
      expect(tablesB.body.map((t: { id: string }) => t.id)).not.toContain(
        table.body.id,
      );

      const inventoryB = await request(app.getHttpServer())
        .get('/api/inventory')
        .set(auth(staffBToken))
        .expect(200);
      expect(inventoryB.body.map((i: { id: string }) => i.id)).not.toContain(
        inventory.body.id,
      );

      const reservationsB = await request(app.getHttpServer())
        .get('/api/reservations')
        .set(auth(staffBToken))
        .expect(200);
      expect(reservationsB.body.map((r: { id: string }) => r.id)).not.toContain(
        reservation.body.id,
      );

      const ordersB = await request(app.getHttpServer())
        .get('/api/orders')
        .set(auth(staffBToken))
        .expect(200);
      expect(ordersB.body.data.map((o: { id: string }) => o.id)).not.toContain(
        order.body.id,
      );

      // Positive control: A CAN still see its own records.
      await request(app.getHttpServer())
        .get(`/api/tables/${table.body.id}`)
        .set(auth(staffAToken))
        .expect(200);
    });
  });

  describe('(b) Restaurant A staff cannot fetch Restaurant B record by id', () => {
    it('returns 404, not 403, not the actual data', async () => {
      const tableB = await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(staffBToken))
        .send({ name: `TblB ${ts}` })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/tables/${tableB.body.id}`)
        .set(auth(staffAToken))
        .expect(404);
    });
  });

  describe('(c) Restaurant A staff cannot update/delete Restaurant B record', () => {
    it('returns 404 for both update and delete, and no mutation occurs', async () => {
      const tableB = await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(staffBToken))
        .send({ name: `TblB Mut ${ts}`, capacity: 4 })
        .expect(201);

      // A tries to mutate B's table — both must 404.
      await request(app.getHttpServer())
        .patch(`/api/tables/${tableB.body.id}`)
        .set(auth(staffAToken))
        .send({ name: 'HACKED' })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/tables/${tableB.body.id}`)
        .set(auth(staffAToken))
        .expect(404);

      // Prove no mutation occurred: B still sees its own, unmodified table.
      const stillThere = await request(app.getHttpServer())
        .get(`/api/tables/${tableB.body.id}`)
        .set(auth(staffBToken))
        .expect(200);
      expect(stillThere.body.name).toBe(`TblB Mut ${ts}`);
      expect(stillThere.body.capacity).toBe(4);
    });
  });

  describe('(d) create() ignores client-supplied restaurantId', () => {
    it('a record created by A staff is scoped to A even when the body tries to force B', async () => {
      const sneaky = await request(app.getHttpServer())
        .post('/api/tables')
        .set(auth(staffAToken))
        .send({ name: `Sneaky ${ts}`, restaurantId: restaurantBId })
        .expect(201);

      // The record must belong to A (caller's own restaurant), never B.
      await request(app.getHttpServer())
        .get(`/api/tables/${sneaky.body.id}`)
        .set(auth(staffAToken))
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/tables/${sneaky.body.id}`)
        .set(auth(staffBToken))
        .expect(404);
    });
  });

  describe('(e) WebSocket isolation: A staff does not receive B order events', () => {
    it('B\'s order status change reaches B staff but never A staff', async () => {
      const orderB = await request(app.getHttpServer())
        .post('/api/orders')
        .set(auth(staffBToken))
        .send({ type: 'TAKEAWAY', items: [{ menuItemId: menuItemBId, quantity: 1 }] })
        .expect(201);

      const staffA = connect(port, staffAToken);
      const staffB = connect(port, staffBToken);
      sockets.push(staffA, staffB);
      await Promise.all([
        waitForEvent(staffA, 'connect'),
        waitForEvent(staffB, 'connect'),
      ]);

      const staffBEvent = waitForEvent(staffB, 'order.status_changed');
      const staffANone = waitForNoEvent(staffA, 'order.status_changed');

      await request(app.getHttpServer())
        .patch(`/api/orders/${orderB.body.id}/status`)
        .set(auth(staffBToken))
        .send({ status: 'PENDING' })
        .expect(200);

      // Prove delivery to B first, then prove exclusion from A.
      const bPayload = await staffBEvent;
      expect(bPayload).toMatchObject({
        orderId: orderB.body.id,
        status: 'PENDING',
      });
      await staffANone;
    });
  });

  describe('(f) Audit log isolation', () => {
    it('an audit entry written by A is not visible to B', async () => {
      const orderA = await request(app.getHttpServer())
        .post('/api/orders')
        .set(auth(staffAToken))
        .send({ type: 'TAKEAWAY', items: [{ menuItemId: menuItemAId, quantity: 1 }] })
        .expect(201);

      // Applying a discount writes an AuditLog entry scoped to A.
      await request(app.getHttpServer())
        .patch(`/api/orders/${orderA.body.id}/discount`)
        .set(auth(staffAToken))
        .send({ discountType: 'FIXED', discountCents: 100, reason: 'test' })
        .expect(200);

      // A sees its own audit entry.
      const aLog = await request(app.getHttpServer())
        .get(`/api/orders/${orderA.body.id}/audit-log`)
        .set(auth(staffAToken))
        .expect(200);
      expect(aLog.body.length).toBeGreaterThan(0);

      // B sees nothing (empty list, not the entry).
      const bLog = await request(app.getHttpServer())
        .get(`/api/orders/${orderA.body.id}/audit-log`)
        .set(auth(staffBToken))
        .expect(200);
      expect(bLog.body).toEqual([]);
    });
  });

  describe('(g) Prisma Extension backstop', () => {
    it('throws when a tenant-owned model query is missing a restaurantId filter', async () => {
      // Well-behaved services never trigger this — a raw, deliberately
      // unfiltered query proves the defense-in-depth layer actually fires.
      await expect(
        prisma.order.findMany({ where: { status: 'DRAFT' } }),
      ).rejects.toThrow(/Tenant guard: Order\.findMany\(\)/);
    });

    it('does NOT throw for a properly scoped query (control)', async () => {
      await expect(
        prisma.order.findMany({ where: { restaurantId: restaurantAId } }),
      ).resolves.toBeDefined();
    });
  });
});
