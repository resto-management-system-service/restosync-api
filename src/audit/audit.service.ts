import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    entityType: string;
    entityId: string;
    action: string;
    userId: string;
    restaurantId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        ...params,
        metadata: params.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async findByEntity(
    entityType: string,
    entityId: string,
    restaurantId: string,
  ) {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId, restaurantId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
