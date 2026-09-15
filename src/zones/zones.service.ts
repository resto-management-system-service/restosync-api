import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TableStatus } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';

@Injectable()
export class ZonesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateZoneDto, user: AuthUser) {
    return this.prisma.zone.create({
      data: {
        name: dto.name,
        sortOrder: dto.sortOrder ?? 0,
        restaurantId: user.restaurantId,
      },
    });
  }

  findAll(user: AuthUser) {
    return this.prisma.zone.findMany({
      where: { restaurantId: user.restaurantId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async update(id: string, dto: UpdateZoneDto, user: AuthUser) {
    await this.ensureExists(id, user);
    return this.prisma.zone.update({
      where: { id },
      data: {
        name: dto.name,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async remove(id: string, user: AuthUser) {
    await this.ensureExists(id, user);

    const blockingTable = await this.prisma.table.findFirst({
      where: {
        zoneId: id,
        restaurantId: user.restaurantId,
        status: { in: [TableStatus.RESERVED, TableStatus.OCCUPIED] },
      },
      select: { id: true },
    });
    if (blockingTable) {
      throw new BadRequestException(
        'Cannot delete a zone that has reserved or occupied tables',
      );
    }

    // Unassign (never delete) the zone's AVAILABLE tables, then remove the
    // zone — atomically, so a table is never left pointing at a deleted zone.
    return this.prisma.$transaction(async (tx) => {
      await tx.table.updateMany({
        where: { zoneId: id, restaurantId: user.restaurantId },
        data: { zoneId: null },
      });
      return tx.zone.delete({ where: { id } });
    });
  }

  private async ensureExists(id: string, user: AuthUser) {
    const zone = await this.prisma.zone.findUnique({ where: { id } });
    if (!zone || zone.restaurantId !== user.restaurantId) {
      throw new NotFoundException('Zone not found');
    }
    return zone;
  }
}
