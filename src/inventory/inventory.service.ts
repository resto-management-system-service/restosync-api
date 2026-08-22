import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(user: AuthUser) {
    return this.prisma.inventoryItem.findMany({
      where: { restaurantId: user.restaurantId },
      include: { menuItem: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, user: AuthUser) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      include: { menuItem: true, adjustments: true },
    });
    if (!item || item.restaurantId !== user.restaurantId) {
      throw new NotFoundException('Inventory item not found');
    }
    return item;
  }

  create(dto: CreateInventoryItemDto, user: AuthUser) {
    return this.prisma.inventoryItem.create({
      data: {
        name: dto.name,
        unit: dto.unit ?? 'unit',
        quantityOnHand: dto.quantityOnHand ?? 0,
        lowStockThreshold: dto.lowStockThreshold ?? 0,
        menuItemId: dto.menuItemId ?? null,
        restaurantId: user.restaurantId,
      },
    });
  }

  async update(
    id: string,
    dto: Partial<CreateInventoryItemDto>,
    user: AuthUser,
  ) {
    await this.ensureExists(id, user);
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

  async remove(id: string, user: AuthUser) {
    await this.ensureExists(id, user);
    return this.prisma.inventoryItem.delete({ where: { id } });
  }

  // Takes restaurantId/actorId directly rather than a full AuthUser: this
  // is also called internally by PaymentsService's best-effort inventory
  // hook (#51), which acts on behalf of an already-verified order/actor
  // pair rather than an authenticated HTTP request.
  async adjust(
    id: string,
    dto: AdjustStockDto,
    actorId: string,
    restaurantId: string,
  ) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
    });
    if (!item || item.restaurantId !== restaurantId) {
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
          restaurantId,
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

  async findLowStock(user: AuthUser) {
    const items = await this.prisma.inventoryItem.findMany({
      where: { restaurantId: user.restaurantId, lowStockThreshold: { gt: 0 } },
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

  private async ensureExists(id: string, user: AuthUser) {
    const exists = await this.prisma.inventoryItem.findUnique({
      where: { id },
    });
    if (!exists || exists.restaurantId !== user.restaurantId) {
      throw new NotFoundException('Inventory item not found');
    }
  }
}
