import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, TableStatus } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateTableLayoutDto } from './dto/update-table-layout.dto';

const ACTIVE_ORDER_STATUSES: OrderStatus[] = Object.values(OrderStatus).filter(
  (status) =>
    status !== OrderStatus.COMPLETED && status !== OrderStatus.CANCELLED,
);

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthUser) {
    const tables = await this.prisma.table.findMany({
      where: { restaurantId: user.restaurantId },
      orderBy: { name: 'asc' },
    });
    return Promise.all(
      tables.map((table) => this.withActiveOrder(table, user)),
    );
  }

  async findOne(id: string, user: AuthUser) {
    const table = await this.ensureExists(id, user);
    return this.withActiveOrder(table, user);
  }

  create(dto: CreateTableDto, user: AuthUser) {
    return this.prisma.table.create({
      data: {
        name: dto.name,
        capacity: dto.capacity ?? null,
        restaurantId: user.restaurantId,
      },
    });
  }

  async update(id: string, dto: UpdateTableDto, user: AuthUser) {
    const table = await this.ensureExists(id, user);
    this.assertEditable(table);
    return this.prisma.table.update({
      where: { id },
      data: {
        name: dto.name,
        capacity: dto.capacity,
      },
    });
  }

  async updateLayout(id: string, dto: UpdateTableLayoutDto, user: AuthUser) {
    await this.ensureExists(id, user);

    if (dto.zoneId) {
      const zone = await this.prisma.zone.findFirst({
        where: { id: dto.zoneId, restaurantId: user.restaurantId },
      });
      if (!zone) {
        throw new NotFoundException('Zone not found');
      }
    }

    return this.prisma.table.update({
      where: { id },
      data: {
        zoneId: dto.zoneId,
        positionX: dto.positionX,
        positionY: dto.positionY,
        width: dto.width,
        height: dto.height,
        shape: dto.shape,
      },
    });
  }

  async remove(id: string, user: AuthUser) {
    const table = await this.ensureExists(id, user);
    this.assertEditable(table);
    return this.prisma.table.delete({ where: { id } });
  }

  private async ensureExists(id: string, user: AuthUser) {
    const table = await this.prisma.table.findUnique({ where: { id } });
    if (!table || table.restaurantId !== user.restaurantId) {
      throw new NotFoundException('Table not found');
    }
    return table;
  }

  private assertEditable(table: { status: TableStatus }) {
    if (table.status !== TableStatus.AVAILABLE) {
      throw new BadRequestException(
        'Cannot edit or delete a table that is reserved or occupied',
      );
    }
  }

  private async withActiveOrder<T extends { id: string; status: TableStatus }>(
    table: T,
    user: AuthUser,
  ) {
    if (table.status !== TableStatus.OCCUPIED) {
      return { ...table, activeOrder: null };
    }

    const activeOrder = await this.prisma.order.findFirst({
      where: {
        tableId: table.id,
        status: { in: ACTIVE_ORDER_STATUSES },
        restaurantId: user.restaurantId,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, number: true, totalCents: true },
    });

    return { ...table, activeOrder: activeOrder ?? null };
  }
}
