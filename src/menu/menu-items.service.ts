import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../common/dto/pagination-query.dto';
import { DEFAULT_RESTAURANT_ID } from '../common/constants/tenancy';
import {
  CreateMenuItemDto,
  MenuItemQueryDto,
  UpdateMenuItemDto,
} from './dto/menu-item.dto';

// Image policy (MVP): URL-only. Admin provides a public image URL.
// File upload (S3/Supabase Storage) is out of scope for MVP.
// To remove an image, set imageUrl to null via PATCH.
@Injectable()
export class MenuItemsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateMenuItemDto, user: AuthUser) {
    return this.prisma.menuItem.create({
      data: { ...dto, restaurantId: user.restaurantId },
    });
  }

  // @Public() endpoint (unauthenticated menu browsing) — see
  // CategoriesService.findAll's note: scopes to the single default
  // restaurant until public tenant resolution exists (out of scope here).
  async findAll(query: MenuItemQueryDto) {
    const where: Prisma.MenuItemWhereInput = {
      restaurantId: DEFAULT_RESTAURANT_ID,
    };
    if (query.name) {
      where.name = { contains: query.name, mode: 'insensitive' };
    }
    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }
    if (query.available !== undefined) {
      where.available = query.available;
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.menuItem.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.menuItem.count({ where }),
    ]);
    return paginate(data, total, query.page, query.limit);
  }

  // @Public() endpoint — see findAll's note on DEFAULT_RESTAURANT_ID.
  async findOne(id: string) {
    const item = await this.prisma.menuItem.findUnique({ where: { id } });
    if (!item || item.restaurantId !== DEFAULT_RESTAURANT_ID) {
      throw new NotFoundException('Menu item not found');
    }
    return item;
  }

  async update(id: string, dto: UpdateMenuItemDto, user: AuthUser) {
    await this.ensureExists(id, user);
    return this.prisma.menuItem.update({ where: { id }, data: dto });
  }

  async remove(id: string, user: AuthUser) {
    await this.ensureExists(id, user);

    const orderItemCount = await this.prisma.orderItem.count({
      where: { menuItemId: id, restaurantId: user.restaurantId },
    });

    if (orderItemCount > 0) {
      throw new BadRequestException(
        'Cannot delete a product with order history. Set available = false instead.',
      );
    }

    return this.prisma.menuItem.delete({ where: { id } });
  }

  async deactivate(id: string, user: AuthUser) {
    await this.ensureExists(id, user);
    return this.prisma.menuItem.update({
      where: { id },
      data: { available: false },
    });
  }

  private async ensureExists(id: string, user: AuthUser) {
    const item = await this.prisma.menuItem.findUnique({ where: { id } });
    if (!item || item.restaurantId !== user.restaurantId) {
      throw new NotFoundException('Menu item not found');
    }
  }
}
