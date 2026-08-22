import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { OrderStatus, Role } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

export interface SocketUser {
  userId: string;
  email: string;
  role: string;
}

// Any staff-facing role sees every order, unfiltered (#156, #154's
// kitchen display). CUSTOMER is deliberately excluded — customers only
// join their own per-user room (see joinRooms()).
const STAFF_ROLES: string[] = [
  Role.ADMIN,
  Role.WAITER,
  Role.CASHIER,
  Role.MANAGER,
  Role.STAFF,
  Role.KITCHEN,
];

export const STAFF_ROOM = 'staff';

export function customerRoom(customerId: string): string {
  return `customer:${customerId}`;
}

export interface StatusChangedPayload {
  orderId: string;
  status: OrderStatus;
  previousStatus: OrderStatus;
}

export interface TotalsChangedPayload {
  orderId: string;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
}

@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const payload = await this.verifyToken(client);
      const user = this.toSocketUser(payload);
      client.data.user = user;
      this.joinRooms(client, user);
      this.logger.log(
        `Realtime connection established for ${payload.email} (${payload.role})`,
      );
    } catch (error) {
      this.logger.warn(
        `Realtime connection rejected: ${
          error instanceof Error ? error.message : 'invalid token'
        }`,
      );
      client.disconnect(true);
    }
  }

  // Fail closed: an unrecognized role joins no room and therefore
  // receives no events, rather than defaulting to broadcast or staff.
  private joinRooms(client: Socket, user: SocketUser): void {
    if (this.isStaffRole(user.role)) {
      client.join(STAFF_ROOM);
    } else if (user.role === Role.CUSTOMER) {
      client.join(customerRoom(user.userId));
    }
  }

  private isStaffRole(role: string): boolean {
    return STAFF_ROLES.includes(role);
  }

  private extractToken(client: Socket): string | undefined {
    const auth = client.handshake.auth as { token?: unknown } | undefined;
    return typeof auth?.token === 'string' ? auth.token : undefined;
  }

  private async verifyToken(client: Socket): Promise<JwtPayload> {
    const token = this.extractToken(client);
    if (!token) {
      throw new WsException('Missing authentication token');
    }
    try {
      return await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
    } catch {
      throw new WsException('Invalid authentication token');
    }
  }

  private toSocketUser(payload: JwtPayload): SocketUser {
    return { userId: payload.sub, email: payload.email, role: payload.role };
  }

  // Staff always see every order (#156). If the order belongs to a
  // customer, that customer's own room also receives it (#155) — no
  // other customer ever does.
  async emitStatusChanged(payload: StatusChangedPayload): Promise<void> {
    this.server.to(STAFF_ROOM).emit('order.status_changed', payload);
    const customerId = await this.findCustomerId(payload.orderId);
    if (customerId) {
      this.server
        .to(customerRoom(customerId))
        .emit('order.status_changed', payload);
    }
  }

  async emitTotalsChanged(payload: TotalsChangedPayload): Promise<void> {
    this.server.to(STAFF_ROOM).emit('order.totals_changed', payload);
    const customerId = await this.findCustomerId(payload.orderId);
    if (customerId) {
      this.server
        .to(customerRoom(customerId))
        .emit('order.totals_changed', payload);
    }
  }

  private async findCustomerId(orderId: string): Promise<string | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { customerId: true },
    });
    return order?.customerId ?? null;
  }
}
