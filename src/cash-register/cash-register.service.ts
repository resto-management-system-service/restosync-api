import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CloseSessionDto } from './dto/close-session.dto';
import { OpenSessionDto } from './dto/open-session.dto';

@Injectable()
export class CashRegisterService {
  constructor(private readonly prisma: PrismaService) {}

  async openSession(dto: OpenSessionDto, actorId: string) {
    const active = await this.prisma.cashRegisterSession.findFirst({
      where: { closedAt: null },
    });
    if (active) {
      throw new BadRequestException('A register session is already open');
    }

    return this.prisma.cashRegisterSession.create({
      data: {
        openedById: actorId,
        openingFloatCents: dto.openingFloatCents,
        notes: dto.notes ?? null,
      },
    });
  }

  async closeSession(dto: CloseSessionDto, actorId: string) {
    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { closedAt: null },
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
      },
    });
    const expectedCents = paymentsAgg._sum.amountCents ?? 0;
    const differenceCents = dto.countedCents - expectedCents;

    return this.prisma.cashRegisterSession.update({
      where: { id: session.id },
      data: {
        closedById: actorId,
        closedAt: new Date(),
        expectedCents,
        countedCents: dto.countedCents,
        differenceCents,
        notes: dto.notes ?? session.notes,
      },
    });
  }

  async getSessionSummary(sessionId: string) {
    const session = await this.prisma.cashRegisterSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const payments = await this.prisma.payment.findMany({
      where: { sessionId, status: PaymentStatus.SUCCEEDED },
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

  async getCurrentSummary() {
    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { closedAt: null },
      orderBy: { openedAt: 'desc' },
    });
    if (!session) {
      throw new NotFoundException('No active session');
    }

    return this.getSessionSummary(session.id);
  }
}
