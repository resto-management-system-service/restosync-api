import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, TableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

const ACTIVE_ORDER_STATUSES: OrderStatus[] = Object.values(OrderStatus).filter(
  (status) =>
    status !== OrderStatus.COMPLETED && status !== OrderStatus.CANCELLED,
);

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const tables = await this.prisma.table.findMany({
      orderBy: { name: 'asc' },
    });
    return Promise.all(tables.map((table) => this.withActiveOrder(table)));
  }

  async findOne(id: string) {
    const table = await this.ensureExists(id);
    return this.withActiveOrder(table);
  }

  create(dto: CreateTableDto) {
    return this.prisma.table.create({
      data: {
        name: dto.name,
        capacity: dto.capacity ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateTableDto) {
    await this.ensureExists(id);
    return this.prisma.table.update({
      where: { id },
      data: {
        name: dto.name,
        capacity: dto.capacity,
      },
    });
  }

  async remove(id: string) {
    const table = await this.ensureExists(id);
    if (table.status === TableStatus.OCCUPIED) {
      throw new BadRequestException('Cannot delete an occupied table');
    }
    return this.prisma.table.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const table = await this.prisma.table.findUnique({ where: { id } });
    if (!table) {
      throw new NotFoundException('Table not found');
    }
    return table;
  }

  private async withActiveOrder<T extends { id: string; status: TableStatus }>(
    table: T,
  ) {
    if (table.status !== TableStatus.OCCUPIED) {
      return { ...table, activeOrder: null };
    }

    const activeOrder = await this.prisma.order.findFirst({
      where: { tableId: table.id, status: { in: ACTIVE_ORDER_STATUSES } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, number: true, totalCents: true },
    });

    return { ...table, activeOrder: activeOrder ?? null };
  }
}
