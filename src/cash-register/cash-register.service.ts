import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
}
