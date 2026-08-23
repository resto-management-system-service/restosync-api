import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_RESTAURANT_ID } from '../common/constants/tenancy';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCategoryDto, user: AuthUser) {
    return this.prisma.category.create({
      data: { ...dto, restaurantId: user.restaurantId },
    });
  }

  // @Public() endpoint (unauthenticated menu browsing) — there is no
  // caller restaurantId to scope by yet. Until public multi-tenant menu
  // browsing gets real tenant resolution (e.g. a restaurant slug/subdomain
  // — out of this prompt's scope), this scopes to the single default
  // restaurant, matching the same temporary-default precedent already
  // established for AuthService.register() in #151.
  findAll(includeInactive = false) {
    return this.prisma.category.findMany({
      where: {
        restaurantId: DEFAULT_RESTAURANT_ID,
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  // @Public() endpoint — see findAll's note on DEFAULT_RESTAURANT_ID.
  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!category || category.restaurantId !== DEFAULT_RESTAURANT_ID) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto, user: AuthUser) {
    await this.ensureExists(id, user);
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(id: string, user: AuthUser) {
    await this.ensureExists(id, user);
    return this.prisma.category.delete({ where: { id } });
  }

  private async ensureExists(id: string, user: AuthUser) {
    const exists = await this.prisma.category.findUnique({ where: { id } });
    if (!exists || exists.restaurantId !== user.restaurantId) {
      throw new NotFoundException('Category not found');
    }
  }
}
