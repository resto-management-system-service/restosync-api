import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
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
}
