import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TableStatus } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { normalizeName } from '../common/utils/normalize-name';
import { PrismaService } from '../prisma/prisma.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';

@Injectable()
export class ZonesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateZoneDto, user: AuthUser) {
    await this.assertCodeUnique(dto.code, user);
    return this.prisma.zone.create({
      data: {
        name: dto.name,
        code: dto.code,
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
    if (dto.code !== undefined) {
      await this.assertCodeUnique(dto.code, user, id);
    }
    return this.prisma.zone.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async getNextTableName(id: string, user: AuthUser) {
    const zone = await this.ensureExists(id, user);

    const tables = await this.prisma.table.findMany({
      where: { zoneId: id, restaurantId: user.restaurantId },
      select: { name: true },
    });

    // Collect the numeric suffixes of names matching the "{code}NN" pattern
    // (exactly two digits), then pick the smallest unused suffix from 01 up,
    // reusing gaps left by deleted tables.
    const used = new Set<number>();
    for (const table of tables) {
      if (!table.name.startsWith(zone.code)) continue;
      const suffix = table.name.slice(zone.code.length);
      if (/^\d{2}$/.test(suffix)) {
        used.add(parseInt(suffix, 10));
      }
    }

    let next = 1;
    while (used.has(next)) next += 1;

    return { suggestedName: `${zone.code}${String(next).padStart(2, '0')}` };
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

  private async assertCodeUnique(
    code: string,
    user: AuthUser,
    excludeId?: string,
  ) {
    const normalized = normalizeName(code);
    const existing = await this.prisma.zone.findMany({
      where: {
        restaurantId: user.restaurantId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, code: true },
    });
    if (existing.some((z) => normalizeName(z.code) === normalized)) {
      throw new BadRequestException(`Zone code "${code}" already exists`);
    }
  }

  private async ensureExists(id: string, user: AuthUser) {
    const zone = await this.prisma.zone.findUnique({ where: { id } });
    if (!zone || zone.restaurantId !== user.restaurantId) {
      throw new NotFoundException('Zone not found');
    }
    return zone;
  }
}
