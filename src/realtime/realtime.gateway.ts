import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { OrderStatus } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

export interface SocketUser {
  userId: string;
  email: string;
  role: string;
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
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const payload = await this.verifyToken(client);
      client.data.user = this.toSocketUser(payload);
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

  // Broadcast to every connected socket — no room/role scoping yet
  // (that's #159/#156, a separate follow-up).
  emitStatusChanged(payload: StatusChangedPayload): void {
    this.server.emit('order.status_changed', payload);
  }

  emitTotalsChanged(payload: TotalsChangedPayload): void {
    this.server.emit('order.totals_changed', payload);
  }
}
