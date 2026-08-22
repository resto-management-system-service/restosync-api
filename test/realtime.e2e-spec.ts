import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Covers the real-time layer end-to-end (#160): a real socket.io server
// (booted from AppModule) + real socket.io-client connections, exercising
// JWT auth on the socket handshake, room assignment per role, and the
// scoping of emitted events (staff see everything, the owning customer sees
// their own order, other customers see nothing).
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

// Proves a socket does NOT receive a given event within a bounded window,
// racing the "no event" outcome against a short timeout so the test fails
// fast and deterministically instead of hanging.
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

describe('Realtime (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let port: number;
  let adminToken: string;

  let customerAId: string;
  let customerAToken: string;
  let customerBToken: string;

  let categoryId: string;
  let burgerId: string;
  let friesId: string;

  // Order created by admin (customerId = admin id): not linked to any
  // registered customer — used to prove staff-only delivery.
  let staffOrderId: string;
  // Order whose customerId we overwrite to customerA's id.
  let customerOrderId: string;

  const sockets: Socket[] = [];

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
    // Bind the HTTP (and socket.io) server to a real port so socket.io
    // clients can connect; supertest reuses the already-listening server.
    await app.listen(0, '127.0.0.1');

    prisma = app.get(PrismaService);
    const address = app.getHttpServer().address();
    port = address.port;

    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@restosync.local', password: 'Admin123!' })
      .expect(200);
    adminToken = adminLogin.body.accessToken;

    // Register two real CUSTOMER users.
    const emailA = `rt_cust_a_${Date.now()}@example.com`;
    const regA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: emailA, password: 'Secret123!', firstName: 'CustA' })
      .expect(201);
    customerAToken = regA.body.accessToken;
    const meA = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${customerAToken}`)
      .expect(200);
    customerAId = meA.body.id;

    const emailB = `rt_cust_b_${Date.now()}@example.com`;
    const regB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: emailB, password: 'Secret123!', firstName: 'CustB' })
      .expect(201);
    customerBToken = regB.body.accessToken;

    // Menu fixtures.
    const category = await request(app.getHttpServer())
      .post('/api/menu/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `RT_${Date.now()}` })
      .expect(201);
    categoryId = category.body.id;

    const burger = await request(app.getHttpServer())
      .post('/api/menu/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `RT Burger ${Date.now()}`, priceCents: 1200, categoryId })
      .expect(201);
    burgerId = burger.body.id;

    const fries = await request(app.getHttpServer())
      .post('/api/menu/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `RT Fries ${Date.now()}`, priceCents: 500, categoryId })
      .expect(201);
    friesId = fries.body.id;

    // TAKEAWAY orders avoid the table-occupancy dedup behavior, so each
    // POST creates a distinct order.
    const staffOrder = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ menuItemId: burgerId, quantity: 1 }],
      })
      .expect(201);
    staffOrderId = staffOrder.body.id;

    const customerOrder = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ menuItemId: burgerId, quantity: 1 }],
      })
      .expect(201);
    customerOrderId = customerOrder.body.id;

    // The REST order-creation flow sets customerId to the creating staff
    // member's id (OrdersService.create is called with the authenticated
    // user id). To exercise per-customer scoping we tie this order to
    // customerA directly.
    await prisma.order.update({
      where: { id: customerOrderId },
      data: { customerId: customerAId },
    });
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      socket.close();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('a staff client with a valid JWT connects and stays connected', async () => {
    const client = connect(port, adminToken);
    sockets.push(client);

    await waitForEvent(client, 'connect');
    expect(client.connected).toBe(true);

    await waitForNoEvent(client, 'disconnect', 500);
  });

  it('a client with an invalid token gets disconnected', async () => {
    const client = connect(port, 'invalid-token');
    sockets.push(client);

    await waitForEvent(client, 'disconnect');
  });

  it('a client with no token gets disconnected', async () => {
    const client = connect(port);
    sockets.push(client);

    await waitForEvent(client, 'disconnect');
  });

  it('a staff client receives order.status_changed for a non-customer order', async () => {
    const staff = connect(port, adminToken);
    sockets.push(staff);
    await waitForEvent(staff, 'connect');

    const statusEvent = waitForEvent(staff, 'order.status_changed');

    await request(app.getHttpServer())
      .patch(`/api/orders/${staffOrderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'PENDING' })
      .expect(200);

    const payload = await statusEvent;
    expect(payload).toMatchObject({
      orderId: staffOrderId,
      status: 'PENDING',
      previousStatus: 'DRAFT',
    });
  });

  it('staff and the owning customer receive order.status_changed for a customer-owned order', async () => {
    const staff = connect(port, adminToken);
    const customerA = connect(port, customerAToken);
    sockets.push(staff, customerA);
    await Promise.all([
      waitForEvent(staff, 'connect'),
      waitForEvent(customerA, 'connect'),
    ]);

    const staffEvent = waitForEvent(staff, 'order.status_changed');
    const customerAEvent = waitForEvent(customerA, 'order.status_changed');

    await request(app.getHttpServer())
      .patch(`/api/orders/${customerOrderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'PENDING' })
      .expect(200);

    const [staffPayload, customerAPayload] = await Promise.all([
      staffEvent,
      customerAEvent,
    ]);
    expect(staffPayload).toMatchObject({ orderId: customerOrderId });
    expect(customerAPayload).toMatchObject({ orderId: customerOrderId });
  });

  it("a different customer does NOT receive the event for another customer's order", async () => {
    const staff = connect(port, adminToken);
    const customerA = connect(port, customerAToken);
    const customerB = connect(port, customerBToken);
    sockets.push(staff, customerA, customerB);
    await Promise.all([
      waitForEvent(staff, 'connect'),
      waitForEvent(customerA, 'connect'),
      waitForEvent(customerB, 'connect'),
    ]);

    const staffEvent = waitForEvent(staff, 'order.status_changed');
    const customerAEvent = waitForEvent(customerA, 'order.status_changed');
    const customerBNone = waitForNoEvent(customerB, 'order.status_changed');

    await request(app.getHttpServer())
      .patch(`/api/orders/${customerOrderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CONFIRMED' })
      .expect(200);

    // Prove delivery happened (staff + owner), then prove exclusion.
    await Promise.all([staffEvent, customerAEvent]);
    await customerBNone;
  });

  it('emits order.totals_changed with the correct payload when an item is added', async () => {
    const staff = connect(port, adminToken);
    sockets.push(staff);
    await waitForEvent(staff, 'connect');

    const totalsEvent = waitForEvent(staff, 'order.totals_changed');

    const res = await request(app.getHttpServer())
      .post(`/api/orders/${staffOrderId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ menuItemId: friesId, quantity: 1 })
      .expect(201);

    const payload = await totalsEvent;
    expect(payload).toMatchObject({
      orderId: staffOrderId,
      subtotalCents: 1700,
      taxCents: 0,
      discountCents: 0,
      totalCents: 1700,
    });
    // Cross-check the emitted totals against what was actually persisted.
    expect(res.body.totalCents).toBe(1700);
  });
});
