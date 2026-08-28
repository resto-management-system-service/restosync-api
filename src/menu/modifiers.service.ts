import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Modifier, ModifierGroup, Prisma } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_RESTAURANT_ID } from '../common/constants/tenancy';
import {
  CreateModifierDto,
  CreateModifierGroupDto,
  ResolvedModifierSelection,
  ResolvedSelection,
  UpdateModifierDto,
  UpdateModifierGroupDto,
} from './dto/modifier.dto';

const groupInclude = {
  modifiers: {
    orderBy: [{ sortOrder: 'asc' as const }, { name: 'asc' as const }],
  },
} satisfies Prisma.ModifierGroupInclude;

@Injectable()
export class ModifiersService {
  constructor(private readonly prisma: PrismaService) {}

  async createGroup(
    menuItemId: string,
    dto: CreateModifierGroupDto,
    user: AuthUser,
  ) {
    this.assertMinMax(dto.minSelect, dto.maxSelect);
    const item = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, restaurantId: user.restaurantId },
    });
    if (!item) {
      throw new NotFoundException('Menu item not found');
    }
    return this.prisma.modifierGroup.create({
      data: {
        name: dto.name,
        required: dto.required ?? false,
        minSelect: dto.minSelect ?? 0,
        maxSelect: dto.maxSelect ?? 1,
        sortOrder: dto.sortOrder ?? 0,
        menuItemId,
        restaurantId: user.restaurantId,
        modifiers: dto.modifiers
          ? {
              create: dto.modifiers.map((m) => ({
                name: m.name,
                priceDeltaCents: m.priceDeltaCents ?? 0,
                sortOrder: m.sortOrder ?? 0,
                available: m.available ?? true,
                restaurantId: user.restaurantId,
              })),
            }
          : undefined,
      },
      include: groupInclude,
    });
  }

  // @Public() browse endpoint — no authenticated caller. Mirrors
  // CategoriesService.findAll's DEFAULT_RESTAURANT_ID scoping note.
  listGroupsForItem(menuItemId: string) {
    return this.prisma.modifierGroup.findMany({
      where: { menuItemId, restaurantId: DEFAULT_RESTAURANT_ID },
      include: groupInclude,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async updateGroup(
    groupId: string,
    dto: UpdateModifierGroupDto,
    user: AuthUser,
  ) {
    const group = await this.ensureGroup(groupId, user);
    const nextMin = dto.minSelect ?? group.minSelect;
    const nextMax = dto.maxSelect ?? group.maxSelect;
    this.assertMinMax(nextMin, nextMax);
    return this.prisma.modifierGroup.update({
      where: { id: groupId },
      data: {
        name: dto.name,
        required: dto.required,
        minSelect: dto.minSelect,
        maxSelect: dto.maxSelect,
        sortOrder: dto.sortOrder,
      },
      include: groupInclude,
    });
  }

  async removeGroup(groupId: string, user: AuthUser) {
    await this.ensureGroup(groupId, user);
    return this.prisma.modifierGroup.delete({ where: { id: groupId } });
  }

  async addModifier(groupId: string, dto: CreateModifierDto, user: AuthUser) {
    await this.ensureGroup(groupId, user);
    return this.prisma.modifier.create({
      data: {
        name: dto.name,
        priceDeltaCents: dto.priceDeltaCents ?? 0,
        sortOrder: dto.sortOrder ?? 0,
        available: dto.available ?? true,
        groupId,
        restaurantId: user.restaurantId,
      },
    });
  }

  async updateModifier(
    modifierId: string,
    dto: UpdateModifierDto,
    user: AuthUser,
  ) {
    await this.ensureModifier(modifierId, user);
    return this.prisma.modifier.update({
      where: { id: modifierId },
      data: {
        name: dto.name,
        priceDeltaCents: dto.priceDeltaCents,
        sortOrder: dto.sortOrder,
        available: dto.available,
      },
    });
  }

  async removeModifier(modifierId: string, user: AuthUser) {
    await this.ensureModifier(modifierId, user);
    return this.prisma.modifier.delete({ where: { id: modifierId } });
  }

  // Order-time entry point. Validates `modifierIds` against `menuItemId`'s
  // configured groups (ownership, availability, required groups present,
  // min/max respected) and returns the priced, group-ordered selection.
  async resolveSelections(
    menuItemId: string,
    modifierIds: string[] | undefined,
    restaurantId: string,
  ): Promise<ResolvedSelection> {
    const ids = modifierIds ?? [];
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'The same modifier was selected more than once',
      );
    }

    const groups = await this.prisma.modifierGroup.findMany({
      where: { menuItemId, restaurantId },
      include: groupInclude,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const byId = new Map<
      string,
      { modifier: Modifier; group: ModifierGroup }
    >();
    for (const group of groups) {
      for (const modifier of group.modifiers) {
        byId.set(modifier.id, { modifier, group });
      }
    }

    for (const id of ids) {
      const hit = byId.get(id);
      if (!hit) {
        throw new BadRequestException(
          `Selected an invalid modifier for this item (${id})`,
        );
      }
      if (!hit.modifier.available) {
        throw new BadRequestException(
          `"${hit.modifier.name}" is not available`,
        );
      }
    }

    const countByGroup = new Map<string, number>();
    for (const id of ids) {
      const groupId = byId.get(id)!.group.id;
      countByGroup.set(groupId, (countByGroup.get(groupId) ?? 0) + 1);
    }

    for (const group of groups) {
      const count = countByGroup.get(group.id) ?? 0;
      const effectiveMin = group.required
        ? Math.max(group.minSelect, 1)
        : group.minSelect;
      if (group.required && count === 0) {
        throw new BadRequestException(
          `Modifier group "${group.name}" is required`,
        );
      }
      if (count > 0 && count < effectiveMin) {
        throw new BadRequestException(
          `Modifier group "${group.name}" requires at least ${effectiveMin} selection(s)`,
        );
      }
      if (count > group.maxSelect) {
        throw new BadRequestException(
          `Modifier group "${group.name}" allows at most ${group.maxSelect} selection(s)`,
        );
      }
    }

    const selections: ResolvedModifierSelection[] = groups.flatMap((group) =>
      group.modifiers
        .filter((m) => ids.includes(m.id))
        .map((m) => ({
          id: m.id,
          groupId: group.id,
          groupName: group.name,
          name: m.name,
          priceDeltaCents: m.priceDeltaCents,
        })),
    );

    return {
      selections,
      deltaCentsPerUnit: selections.reduce(
        (sum, m) => sum + m.priceDeltaCents,
        0,
      ),
    };
  }

  private assertMinMax(min?: number, max?: number) {
    if (min !== undefined && max !== undefined && min > max) {
      throw new BadRequestException('minSelect cannot exceed maxSelect');
    }
  }

  private async ensureGroup(groupId: string, user: AuthUser) {
    const group = await this.prisma.modifierGroup.findUnique({
      where: { id: groupId },
    });
    if (!group || group.restaurantId !== user.restaurantId) {
      throw new NotFoundException('Modifier group not found');
    }
    return group;
  }

  private async ensureModifier(modifierId: string, user: AuthUser) {
    const modifier = await this.prisma.modifier.findUnique({
      where: { id: modifierId },
    });
    if (!modifier || modifier.restaurantId !== user.restaurantId) {
      throw new NotFoundException('Modifier not found');
    }
    return modifier;
  }
}
