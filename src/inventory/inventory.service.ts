import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.inventoryItem.findMany({
      include: { menuItem: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      include: { menuItem: true, adjustments: true },
    });
    if (!item) {
      throw new NotFoundException('Inventory item not found');
    }
    return item;
  }

  create(dto: CreateInventoryItemDto) {
    return this.prisma.inventoryItem.create({
      data: {
        name: dto.name,
        unit: dto.unit ?? 'unit',
        quantityOnHand: dto.quantityOnHand ?? 0,
        lowStockThreshold: dto.lowStockThreshold ?? 0,
        menuItemId: dto.menuItemId ?? null,
      },
    });
  }

  async update(id: string, dto: Partial<CreateInventoryItemDto>) {
    await this.ensureExists(id);
    return this.prisma.inventoryItem.update({
      where: { id },
      data: {
        name: dto.name,
        unit: dto.unit,
        quantityOnHand: dto.quantityOnHand,
        lowStockThreshold: dto.lowStockThreshold,
        menuItemId: dto.menuItemId,
      },
      include: { menuItem: true },
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return this.prisma.inventoryItem.delete({ where: { id } });
  }

  async adjust(id: string, dto: AdjustStockDto, actorId: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
    });
    if (!item) {
      throw new NotFoundException('Inventory item not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.stockAdjustment.create({
        data: {
          inventoryItemId: id,
          type: dto.type,
          quantityDelta: dto.quantityDelta,
          reason: dto.reason ?? null,
          performedById: actorId,
        },
      });

      const newQty = Math.max(0, item.quantityOnHand + dto.quantityDelta);

      return tx.inventoryItem.update({
        where: { id },
        data: { quantityOnHand: newQty },
        include: { adjustments: true, menuItem: true },
      });
    });
  }

  async findLowStock() {
    const items = await this.prisma.inventoryItem.findMany({
      where: { lowStockThreshold: { gt: 0 } },
      orderBy: { name: 'asc' },
    });
    return items
      .filter((i) => i.quantityOnHand <= i.lowStockThreshold)
      .map((i) => ({
        ...i,
        alertLevel:
          i.quantityOnHand === 0 ? ('CRITICAL' as const) : ('LOW' as const),
      }));
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.inventoryItem.findUnique({
      where: { id },
    });
    if (!exists) {
      throw new NotFoundException('Inventory item not found');
    }
  }
}
