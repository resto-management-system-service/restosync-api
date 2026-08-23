import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CloseSessionDto } from './dto/close-session.dto';
import { OpenSessionDto } from './dto/open-session.dto';

@Injectable()
export class CashRegisterService {
  constructor(private readonly prisma: PrismaService) {}

  async openSession(dto: OpenSessionDto, user: AuthUser) {
    const active = await this.prisma.cashRegisterSession.findFirst({
      where: { closedAt: null, restaurantId: user.restaurantId },
    });
    if (active) {
      throw new BadRequestException('A register session is already open');
    }

    return this.prisma.cashRegisterSession.create({
      data: {
        openedById: user.id,
        openingFloatCents: dto.openingFloatCents,
        notes: dto.notes ?? null,
        restaurantId: user.restaurantId,
      },
    });
  }

  async closeSession(dto: CloseSessionDto, user: AuthUser) {
    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { closedAt: null, restaurantId: user.restaurantId },
      orderBy: { openedAt: 'desc' },
    });
    if (!session) {
      throw new BadRequestException('No active cash register session');
    }

    const paymentsAgg = await this.prisma.payment.aggregate({
      _sum: { amountCents: true },
      where: {
        sessionId: session.id,
        status: PaymentStatus.SUCCEEDED,
        restaurantId: user.restaurantId,
      },
    });
    const expectedCents = paymentsAgg._sum.amountCents ?? 0;
    const differenceCents = dto.countedCents - expectedCents;

    return this.prisma.cashRegisterSession.update({
      where: { id: session.id },
      data: {
        closedById: user.id,
        closedAt: new Date(),
        expectedCents,
        countedCents: dto.countedCents,
        differenceCents,
        notes: dto.notes ?? session.notes,
      },
    });
  }

  async getSessionSummary(sessionId: string, user: AuthUser) {
    const session = await this.prisma.cashRegisterSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.restaurantId !== user.restaurantId) {
      throw new NotFoundException('Session not found');
    }

    const payments = await this.prisma.payment.findMany({
      where: {
        sessionId,
        status: PaymentStatus.SUCCEEDED,
        restaurantId: user.restaurantId,
      },
    });

    const totalSalesCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
    const ticketCount = payments.length;

    const byMethodRaw: Record<string, number> = {};
    for (const p of payments) {
      byMethodRaw[p.method] = (byMethodRaw[p.method] ?? 0) + p.amountCents;
    }

    const byMethod: Record<string, number> = {};
    for (const method of Object.values(PaymentMethod)) {
      const amount = byMethodRaw[method];
      if (amount && amount > 0) {
        byMethod[method] = amount;
      }
    }

    return {
      session,
      summary: { totalSalesCents, ticketCount, byMethod },
    };
  }

  async getCurrentSummary(user: AuthUser) {
    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { closedAt: null, restaurantId: user.restaurantId },
      orderBy: { openedAt: 'desc' },
    });
    if (!session) {
      throw new NotFoundException('No active session');
    }

    return this.getSessionSummary(session.id, user);
  }
}
