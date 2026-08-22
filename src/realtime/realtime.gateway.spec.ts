import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OrderStatus } from '@prisma/client';
import type { Server, Socket } from 'socket.io';
import { customerRoom, RealtimeGateway, STAFF_ROOM } from './realtime.gateway';
import { PrismaService } from '../prisma/prisma.service';

type MockJwtService = { verifyAsync: jest.Mock };
type MockConfigService = { get: jest.Mock };
type MockPrismaService = { order: { findUnique: jest.Mock } };

function createMockJwtService(): MockJwtService {
  return { verifyAsync: jest.fn() };
}

function createMockConfigService(): MockConfigService {
  return { get: jest.fn(() => 'test-secret') };
}

function createMockPrismaService(): MockPrismaService {
  return { order: { findUnique: jest.fn() } };
}

function createSocket(token?: string): Socket {
  return {
    handshake: { auth: token === undefined ? {} : { token } },
    data: {},
    disconnect: jest.fn(),
    join: jest.fn(),
  } as unknown as Socket;
}

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let jwt: MockJwtService;
  let config: MockConfigService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    jwt = createMockJwtService();
    config = createMockConfigService();
    prisma = createMockPrismaService();
    gateway = new RealtimeGateway(
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
  });

  it('accepts a connection with a valid JWT and stores the authenticated user', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'cook@restosync.dev',
      role: 'KITCHEN',
    });

    const socket = createSocket('valid.token');
    await gateway.handleConnection(socket);

    expect(jwt.verifyAsync).toHaveBeenCalledWith('valid.token', {
      secret: 'test-secret',
    });
    expect(socket.data.user).toEqual({
      userId: 'user-1',
      email: 'cook@restosync.dev',
      role: 'KITCHEN',
    });
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('rejects a connection with a missing JWT', async () => {
    const socket = createSocket();
    await gateway.handleConnection(socket);

    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    expect(socket.data.user).toBeUndefined();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects a connection with an invalid JWT', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    const socket = createSocket('invalid.token');
    await gateway.handleConnection(socket);

    expect(socket.data.user).toBeUndefined();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  describe('room assignment on connection (#159/#156/#155)', () => {
    it.each(['KITCHEN', 'CASHIER', 'ADMIN', 'WAITER', 'MANAGER', 'STAFF'])(
      'a connection with role %s joins the "staff" room',
      async (role) => {
        jwt.verifyAsync.mockResolvedValue({
          sub: 'user-1',
          email: 'staff@restosync.dev',
          role,
        });

        const socket = createSocket('valid.token');
        await gateway.handleConnection(socket);

        expect(socket.join).toHaveBeenCalledWith(STAFF_ROOM);
        expect(socket.join).toHaveBeenCalledTimes(1);
      },
    );

    it('a connection with role CUSTOMER joins customer:${userId}, not the staff room', async () => {
      jwt.verifyAsync.mockResolvedValue({
        sub: 'customer-1',
        email: 'diner@restosync.dev',
        role: 'CUSTOMER',
      });

      const socket = createSocket('valid.token');
      await gateway.handleConnection(socket);

      expect(socket.join).toHaveBeenCalledWith(customerRoom('customer-1'));
      expect(socket.join).not.toHaveBeenCalledWith(STAFF_ROOM);
      expect(socket.join).toHaveBeenCalledTimes(1);
    });

    it('a connection with an unrecognized role joins no room (fail closed)', async () => {
      jwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        email: 'mystery@restosync.dev',
        role: 'SOME_FUTURE_ROLE',
      });

      const socket = createSocket('valid.token');
      await gateway.handleConnection(socket);

      expect(socket.join).not.toHaveBeenCalled();
    });
  });

  describe('emitStatusChanged', () => {
    const payload = {
      orderId: 'order-1',
      status: OrderStatus.CONFIRMED,
      previousStatus: OrderStatus.PENDING,
    };

    it('emits to both "staff" and the owning customer room when the order has a customerId', async () => {
      const server = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
      gateway.server = server as unknown as Server;
      prisma.order.findUnique.mockResolvedValue({ customerId: 'customer-1' });

      await gateway.emitStatusChanged(payload);

      expect(prisma.order.findUnique).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        select: { customerId: true },
      });
      expect(server.to).toHaveBeenCalledWith(STAFF_ROOM);
      expect(server.to).toHaveBeenCalledWith(customerRoom('customer-1'));
      expect(server.emit).toHaveBeenCalledWith('order.status_changed', payload);
      expect(server.emit).toHaveBeenCalledTimes(2);
    });

    it('emits ONLY to "staff" when the order has no customerId (walk-in order)', async () => {
      const server = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
      gateway.server = server as unknown as Server;
      prisma.order.findUnique.mockResolvedValue({ customerId: null });

      await gateway.emitStatusChanged(payload);

      expect(server.to).toHaveBeenCalledWith(STAFF_ROOM);
      expect(server.to).toHaveBeenCalledTimes(1);
      expect(server.emit).toHaveBeenCalledTimes(1);
    });

    it('does not deliver the event to an unrelated customer room (security property)', async () => {
      // Simulates two independently-tracked "rooms" via separate emit
      // spies, proving customer B's handler is never invoked for an
      // event scoped to customer A.
      const customerAHandler = jest.fn();
      const customerBHandler = jest.fn();
      const rooms: Record<string, { emit: jest.Mock }> = {
        [STAFF_ROOM]: { emit: jest.fn() },
        [customerRoom('customer-A')]: { emit: customerAHandler },
        [customerRoom('customer-B')]: { emit: customerBHandler },
      };
      const server = {
        to: jest.fn((room: string) => rooms[room] ?? { emit: jest.fn() }),
      };
      gateway.server = server as unknown as Server;
      prisma.order.findUnique.mockResolvedValue({ customerId: 'customer-A' });

      await gateway.emitStatusChanged(payload);

      expect(customerAHandler).toHaveBeenCalledWith(
        'order.status_changed',
        payload,
      );
      expect(customerBHandler).not.toHaveBeenCalled();
    });
  });

  describe('emitTotalsChanged', () => {
    const payload = {
      orderId: 'order-1',
      subtotalCents: 1200,
      taxCents: 100,
      discountCents: 0,
      totalCents: 1300,
    };

    it('emits to both "staff" and the owning customer room when the order has a customerId', async () => {
      const server = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
      gateway.server = server as unknown as Server;
      prisma.order.findUnique.mockResolvedValue({ customerId: 'customer-1' });

      await gateway.emitTotalsChanged(payload);

      expect(server.to).toHaveBeenCalledWith(STAFF_ROOM);
      expect(server.to).toHaveBeenCalledWith(customerRoom('customer-1'));
      expect(server.emit).toHaveBeenCalledWith('order.totals_changed', payload);
      expect(server.emit).toHaveBeenCalledTimes(2);
    });

    it('emits ONLY to "staff" when the order has no customerId (walk-in order)', async () => {
      const server = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
      gateway.server = server as unknown as Server;
      prisma.order.findUnique.mockResolvedValue({ customerId: null });

      await gateway.emitTotalsChanged(payload);

      expect(server.to).toHaveBeenCalledWith(STAFF_ROOM);
      expect(server.to).toHaveBeenCalledTimes(1);
      expect(server.emit).toHaveBeenCalledTimes(1);
    });

    it('does not deliver the event to an unrelated customer room (security property)', async () => {
      const customerAHandler = jest.fn();
      const customerBHandler = jest.fn();
      const rooms: Record<string, { emit: jest.Mock }> = {
        [STAFF_ROOM]: { emit: jest.fn() },
        [customerRoom('customer-A')]: { emit: customerAHandler },
        [customerRoom('customer-B')]: { emit: customerBHandler },
      };
      const server = {
        to: jest.fn((room: string) => rooms[room] ?? { emit: jest.fn() }),
      };
      gateway.server = server as unknown as Server;
      prisma.order.findUnique.mockResolvedValue({ customerId: 'customer-A' });

      await gateway.emitTotalsChanged(payload);

      expect(customerAHandler).toHaveBeenCalledWith(
        'order.totals_changed',
        payload,
      );
      expect(customerBHandler).not.toHaveBeenCalled();
    });
  });
});
