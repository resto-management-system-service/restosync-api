# Menu Item Modifiers / Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let managers define priced modifier groups/options per menu item, and have order creation validate the selection, fold price deltas into the server-side line total, and snapshot the chosen options onto the order item.

**Architecture:** Two new Prisma models (`ModifierGroup`, `Modifier`) hang off `MenuItem`, both tenant-owned (`restaurantId`). A new `ModifiersService` in `MenuModule` owns config CRUD and a single `resolveSelections()` method that validates a list of selected modifier IDs against an item's groups and returns the priced, ordered selection. `OrdersModule` imports `MenuModule` and calls `resolveSelections()` from `create()` and `addItem()`; the resolved per-unit delta is stored on a new `OrderItem.modifierDeltaCents` column so every line-total recompute (`addItem`, `updateItemQuantity`, `recalculateTotals`) stays correct, and the human-readable breakdown is snapshotted onto the existing `OrderItem.modifiers` JSON column.

**Tech Stack:** NestJS 10, Prisma 5 (PostgreSQL), class-validator/class-transformer DTOs, Jest (unit `*.spec.ts` under `src/`, e2e `*.e2e-spec.ts` under `test/`), Swagger via `@nestjs/swagger`.

## Global Constraints

- **All money is integer cents.** Never introduce floats for prices/deltas. `priceDeltaCents` MAY be negative (a "no onions" style removal).
- **Tenancy:** every new tenant-owned model carries a non-null `restaurantId` FK to `Restaurant`. Services set `restaurantId` on create explicitly from the caller (`user.restaurantId` / the `restaurantId` arg), never from the client payload. Every `findMany`/`findFirst`/`count` on a tenant-owned model MUST include `restaurantId` in its `where` clause or the `tenantGuardExtension` throws at runtime. `findUnique`/`update`/`delete` by global id use the established fetch-by-id-then-verify-`restaurantId` pattern (throw `NotFoundException` — 404, never 403 — on mismatch).
- **Prisma commands** use the project scripts (`npm run prisma:migrate`, `npm run prisma:generate`) — the local Prisma is `^5.20.0`; a bare `npx prisma` pulls Prisma 7 and fails. A running Postgres must be reachable at `DATABASE_URL` (`docker compose up postgres -d` starts one; note `docker-compose.yml` maps host port **5533**, while `.env` defaults to `5432` — align one of them).
- **Quality gates, run at the end of every task:** `npm run lint` (eslint --fix, must exit clean), `npm run build` (tsc, must succeed), `npm test` (unit). Task 5 additionally runs `npm run test:e2e` (needs Postgres + `npm run prisma:seed`).
- **Follow existing patterns:** DTOs use `class-validator` decorators + `@ApiProperty`/`@ApiPropertyOptional`; `UpdateXDto extends PartialType(CreateXDto)`; services are constructor-injected with `PrismaService`; controllers use `@Roles(Role.ADMIN)` for management and `@Public()` for unauthenticated menu browsing.
- **Commit** after each task with a `feat:` / `test:` message referencing the issue number(s).

---

## File Structure

**Created:**
- `src/menu/dto/modifier.dto.ts` — DTOs for modifier-group and modifier CRUD, plus the shape of a resolved selection.
- `src/menu/modifiers.service.ts` — `ModifiersService`: config CRUD + `resolveSelections()`.
- `src/menu/modifiers.service.spec.ts` — unit tests for `ModifiersService`.
- `src/menu/modifiers.controller.ts` — `ModifiersController`: management endpoints under `menu/`.
- `test/modifiers.e2e-spec.ts` — end-to-end coverage of the config + order flow.

**Modified:**
- `prisma/schema.prisma` — `ModifierGroup`, `Modifier` models; `OrderItem.modifierDeltaCents`; back-relations on `MenuItem` and `Restaurant`.
- `prisma/migrations/<timestamp>_add_menu_item_modifiers/migration.sql` — generated.
- `src/common/prisma-tenant-guard.extension.ts` — add `ModifierGroup`, `Modifier` to `TENANT_GUARDED_MODELS`.
- `src/menu/menu.module.ts` — register `ModifiersController` + `ModifiersService`, export `ModifiersService`.
- `src/menu/menu-items.service.ts` — include `modifierGroups` (with `modifiers`) in `findOne`/`findAll`.
- `src/menu/menu-items.service.spec.ts` — adjust `findAll` mock expectations for the new `include`.
- `src/orders/orders.module.ts` — `imports: [MenuModule]`.
- `src/orders/dto/create-order.dto.ts` — `OrderLineDto`: replace `modifiers?: Record<string, unknown>` with `modifierIds?: string[]`.
- `src/orders/dto/add-order-item.dto.ts` — same replacement.
- `src/orders/orders.service.ts` — inject `ModifiersService`; validate + price + snapshot in `create()` and `addItem()`; fix `updateItemQuantity()` and `recalculateTotals()`/`applyDiscount()` to keep modifier deltas in the line total / subtotal.
- `src/orders/orders.service.spec.ts` — new `ModifiersService` mock; update `orderItem.findMany` mocks to carry `lineTotalCents`; new modifier tests.
- `prisma/seed.ts` — demo modifier group + options on "Classic Cheeseburger".
- `site/openapi.json` — regenerated (`npm run openapi:generate`).
- `docs/superpowers/specs/2026-08-19-v1-remaining-epics-design.md` — mark Epic #6 implemented (status note only).

---

## Interfaces (contract shared across tasks)

Defined in Task 1 (schema) and Task 3 (`ModifiersService`). Later tasks rely on these exact names/types.

```prisma
model ModifierGroup {
  id           String     @id @default(uuid())
  name         String
  required     Boolean    @default(false)
  minSelect    Int        @default(0)
  maxSelect    Int        @default(1)
  sortOrder    Int        @default(0)
  menuItemId   String
  menuItem     MenuItem   @relation(fields: [menuItemId], references: [id], onDelete: Cascade)
  modifiers    Modifier[]
  restaurantId String
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id])
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  @@index([menuItemId])
  @@index([restaurantId])
  @@map("modifier_groups")
}

model Modifier {
  id              String        @id @default(uuid())
  name            String
  priceDeltaCents Int           @default(0)
  sortOrder       Int           @default(0)
  available       Boolean       @default(true)
  groupId         String
  group           ModifierGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  restaurantId    String
  restaurant      Restaurant    @relation(fields: [restaurantId], references: [id])
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  @@index([groupId])
  @@index([restaurantId])
  @@map("modifiers")
}
```

`OrderItem` gains: `modifierDeltaCents Int @default(0)` — the **per-unit** sum of selected modifier price deltas. Line total invariant everywhere: `lineTotalCents = (priceCents + modifierDeltaCents) * quantity`.

```typescript
// src/menu/dto/modifier.dto.ts
export interface ResolvedModifierSelection {
  id: string;            // Modifier.id
  groupId: string;       // ModifierGroup.id
  groupName: string;     // ModifierGroup.name (snapshot)
  name: string;          // Modifier.name (snapshot)
  priceDeltaCents: number;
}
export interface ResolvedSelection {
  selections: ResolvedModifierSelection[]; // ordered by group.sortOrder, then modifier.sortOrder
  deltaCentsPerUnit: number;               // sum of selections[].priceDeltaCents
}

// src/menu/modifiers.service.ts — ModifiersService (exported from MenuModule)
class ModifiersService {
  createGroup(menuItemId: string, dto: CreateModifierGroupDto, user: AuthUser): Promise<ModifierGroup & { modifiers: Modifier[] }>;
  listGroupsForItem(menuItemId: string): Promise<(ModifierGroup & { modifiers: Modifier[] })[]>; // public browse: scoped to DEFAULT_RESTAURANT_ID
  updateGroup(groupId: string, dto: UpdateModifierGroupDto, user: AuthUser): Promise<ModifierGroup>;
  removeGroup(groupId: string, user: AuthUser): Promise<ModifierGroup>;
  addModifier(groupId: string, dto: CreateModifierDto, user: AuthUser): Promise<Modifier>;
  updateModifier(modifierId: string, dto: UpdateModifierDto, user: AuthUser): Promise<Modifier>;
  removeModifier(modifierId: string, user: AuthUser): Promise<Modifier>;
  // Order-time entry point. modifierIds may be undefined/empty.
  // Throws BadRequestException on any invalid selection; returns a priced, ordered result.
  resolveSelections(menuItemId: string, modifierIds: string[] | undefined, restaurantId: string): Promise<ResolvedSelection>;
}
```

---

## Task 1: Prisma models, `OrderItem.modifierDeltaCents`, migration

**Issue:** #166

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/common/prisma-tenant-guard.extension.ts:17-30`
- Create (generated): `prisma/migrations/<timestamp>_add_menu_item_modifiers/migration.sql`
- Test: `src/common/prisma-tenant-guard.extension.spec.ts` (add one case)

**Interfaces:**
- Produces: the `ModifierGroup`, `Modifier` models and `OrderItem.modifierDeltaCents` column from the Interfaces section above.

- [ ] **Step 1: Add the models + relations to `prisma/schema.prisma`**

In the `// ---------- Menu ----------` section, after `model MenuItem { ... }`, add the `ModifierGroup` and `Modifier` blocks exactly as given in the Interfaces section.

In `model MenuItem`, add one relation field (place it after `orderItems    OrderItem[]`):
```prisma
  modifierGroups ModifierGroup[]
```

In `model OrderItem`, add after `modifiers      Json?`:
```prisma
  modifierDeltaCents Int      @default(0)
```

In `model Restaurant`, add after `orderItems           OrderItem[]`:
```prisma
  modifierGroups       ModifierGroup[]
  modifiers            Modifier[]
```

- [ ] **Step 2: Start Postgres and create the migration**

Run:
```bash
docker compose up postgres -d   # if not already running; align .env DATABASE_URL to the mapped port
npm run prisma:migrate -- --name add_menu_item_modifiers
```
Expected: a new folder `prisma/migrations/<timestamp>_add_menu_item_modifiers/` with `migration.sql` creating `modifier_groups`, `modifiers`, and `ALTER TABLE "order_items" ADD COLUMN "modifierDeltaCents" INTEGER NOT NULL DEFAULT 0`. Prisma Client is regenerated automatically.

- [ ] **Step 3: Add the new models to the tenant guard**

In `src/common/prisma-tenant-guard.extension.ts`, add `'ModifierGroup'` and `'Modifier'` to the `TENANT_GUARDED_MODELS` set (keep alphabetical-ish grouping; a trailing comment `// #6 modifiers` is fine). Update the count in the doc comment above the set (`the same 12 tenant-owned models` → `14 tenant-owned models`).

- [ ] **Step 4: Write a guard test for one of the new models**

In `src/common/prisma-tenant-guard.extension.spec.ts`, add inside the top `describe`:
```typescript
it('throws when a guarded operation on ModifierGroup is missing restaurantId', async () => {
  const query = jest.fn().mockResolvedValue([]);
  await expect(
    tenantGuardOperation({
      model: 'ModifierGroup',
      operation: 'findMany',
      args: { where: { menuItemId: 'item-1' } },
      query,
    }),
  ).rejects.toThrow(/Tenant guard: ModifierGroup\.findMany\(\)/);
  expect(query).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run the guard spec**

Run: `npx jest src/common/prisma-tenant-guard.extension.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Quality gates**

Run: `npm run lint && npm run build && npm test`
Expected: all pass. `npm run build` proves the generated Prisma types (`ModifierGroup`, `Modifier`, `OrderItem.modifierDeltaCents`) compile.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/common/prisma-tenant-guard.extension.ts src/common/prisma-tenant-guard.extension.spec.ts
git commit -m "feat(#166): ModifierGroup + Modifier models + OrderItem.modifierDeltaCents migration"
```

---

## Task 2: Modifier config API (groups + options CRUD)

**Issues:** #161, #162 (config side), #166 (service scaffolding)

**Files:**
- Create: `src/menu/dto/modifier.dto.ts`
- Create: `src/menu/modifiers.service.ts`
- Create: `src/menu/modifiers.service.spec.ts`
- Create: `src/menu/modifiers.controller.ts`
- Modify: `src/menu/menu.module.ts`
- Modify: `src/menu/menu-items.service.ts:33-66` (findAll/findOne includes)
- Modify: `src/menu/menu-items.service.spec.ts` (findAll include expectation)

**Interfaces:**
- Consumes: `ModifierGroup`, `Modifier` from Task 1.
- Produces: `ModifiersService` config methods + DTOs + `ResolvedModifierSelection` / `ResolvedSelection` interfaces (the `resolveSelections` method itself is added in Task 3). `MenuModule` exports `ModifiersService`.

- [ ] **Step 1: Write the DTOs**

Create `src/menu/dto/modifier.dto.ts`:
```typescript
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateModifierDto {
  @ApiProperty({ example: 'Large' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({
    default: 0,
    description: 'Price change in integer cents; may be negative for removals',
  })
  @IsOptional()
  @IsInt()
  priceDeltaCents?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  available?: boolean;
}

export class UpdateModifierDto extends PartialType(CreateModifierDto) {}

export class CreateModifierGroupDto {
  @ApiProperty({ example: 'Size' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ default: 0, description: 'Minimum selections when the group is used' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minSelect?: number;

  @ApiPropertyOptional({ default: 1, description: 'Maximum selections allowed' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxSelect?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ type: [CreateModifierDto], description: 'Options to create with the group' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateModifierDto)
  modifiers?: CreateModifierDto[];
}

// PartialType drops the nested `modifiers` array on update — options are
// managed individually via the /modifiers endpoints.
export class UpdateModifierGroupDto extends PartialType(CreateModifierGroupDto) {}

export interface ResolvedModifierSelection {
  id: string;
  groupId: string;
  groupName: string;
  name: string;
  priceDeltaCents: number;
}

export interface ResolvedSelection {
  selections: ResolvedModifierSelection[];
  deltaCentsPerUnit: number;
}
```

- [ ] **Step 2: Write the failing service tests (config CRUD only)**

Create `src/menu/modifiers.service.spec.ts`:
```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_RESTAURANT_ID } from '../common/constants/tenancy';
import { ModifiersService } from './modifiers.service';

type MockPrisma = {
  menuItem: { findFirst: jest.Mock };
  modifierGroup: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  modifier: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    menuItem: { findFirst: jest.fn() },
    modifierGroup: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    modifier: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function buildUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'admin@restosync.local',
    role: Role.ADMIN,
    restaurantId: 'restaurant-A',
    ...overrides,
  };
}

describe('ModifiersService', () => {
  let service: ModifiersService;
  let prisma: MockPrisma;
  const user = buildUser();

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ModifiersService(prisma as unknown as PrismaService);
  });

  describe('createGroup', () => {
    it('creates a group (with nested options) scoped to the caller restaurant', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({ id: 'item-1', restaurantId: user.restaurantId });
      prisma.modifierGroup.create.mockResolvedValue({ id: 'g1', modifiers: [] });

      await service.createGroup(
        'item-1',
        { name: 'Size', required: true, minSelect: 1, maxSelect: 1, modifiers: [{ name: 'L', priceDeltaCents: 200 }] },
        user,
      );

      const arg = prisma.modifierGroup.create.mock.calls[0][0];
      expect(arg.data.restaurantId).toBe(user.restaurantId);
      expect(arg.data.menuItemId).toBe('item-1');
      expect(arg.data.modifiers.create[0].restaurantId).toBe(user.restaurantId);
    });

    it('throws NotFoundException when the menu item belongs to another restaurant', async () => {
      prisma.menuItem.findFirst.mockResolvedValue(null);
      await expect(
        service.createGroup('item-1', { name: 'Size' }, user),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when minSelect > maxSelect', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({ id: 'item-1', restaurantId: user.restaurantId });
      await expect(
        service.createGroup('item-1', { name: 'Size', minSelect: 3, maxSelect: 1 }, user),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listGroupsForItem (public browse)', () => {
    it('scopes to the default restaurant', async () => {
      prisma.modifierGroup.findMany.mockResolvedValue([]);
      await service.listGroupsForItem('item-1');
      expect(prisma.modifierGroup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { menuItemId: 'item-1', restaurantId: DEFAULT_RESTAURANT_ID },
        }),
      );
    });
  });

  describe('removeGroup / updateGroup / addModifier', () => {
    it('removeGroup throws NotFoundException (404, not 403) for another restaurant', async () => {
      prisma.modifierGroup.findUnique.mockResolvedValue({ id: 'g1', restaurantId: 'restaurant-B' });
      await expect(service.removeGroup('g1', user)).rejects.toThrow(NotFoundException);
      expect(prisma.modifierGroup.delete).not.toHaveBeenCalled();
    });

    it('addModifier sets restaurantId from the group, not the client', async () => {
      prisma.modifierGroup.findUnique.mockResolvedValue({ id: 'g1', restaurantId: user.restaurantId });
      prisma.modifier.create.mockResolvedValue({ id: 'm1' });
      await service.addModifier('g1', { name: 'Bacon', priceDeltaCents: 150 }, user);
      const arg = prisma.modifier.create.mock.calls[0][0];
      expect(arg.data.restaurantId).toBe(user.restaurantId);
      expect(arg.data.groupId).toBe('g1');
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest src/menu/modifiers.service.spec.ts`
Expected: FAIL — `Cannot find module './modifiers.service'`.

- [ ] **Step 4: Implement `ModifiersService` (config methods)**

Create `src/menu/modifiers.service.ts`:
```typescript
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_RESTAURANT_ID } from '../common/constants/tenancy';
import {
  CreateModifierDto,
  CreateModifierGroupDto,
  UpdateModifierDto,
  UpdateModifierGroupDto,
} from './dto/modifier.dto';

const groupInclude = {
  modifiers: { orderBy: [{ sortOrder: 'asc' as const }, { name: 'asc' as const }] },
};

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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/menu/modifiers.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Write the controller**

Create `src/menu/modifiers.controller.ts`:
```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CreateModifierDto,
  CreateModifierGroupDto,
  UpdateModifierDto,
  UpdateModifierGroupDto,
} from './dto/modifier.dto';
import { ModifiersService } from './modifiers.service';

@ApiTags('menu')
@Controller('menu')
export class ModifiersController {
  constructor(private readonly modifiersService: ModifiersService) {}

  @Public()
  @Get('items/:itemId/modifier-groups')
  @ApiOperation({ summary: 'List modifier groups and options for a menu item' })
  listForItem(@Param('itemId') itemId: string) {
    return this.modifiersService.listGroupsForItem(itemId);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('items/:itemId/modifier-groups')
  @ApiOperation({ summary: 'Create a modifier group (optionally with options) on a menu item' })
  createGroup(
    @Param('itemId') itemId: string,
    @Body() dto: CreateModifierGroupDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.modifiersService.createGroup(itemId, dto, user);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch('modifier-groups/:groupId')
  updateGroup(
    @Param('groupId') groupId: string,
    @Body() dto: UpdateModifierGroupDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.modifiersService.updateGroup(groupId, dto, user);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.MANAGER)
  @Delete('modifier-groups/:groupId')
  removeGroup(@Param('groupId') groupId: string, @CurrentUser() user: AuthUser) {
    return this.modifiersService.removeGroup(groupId, user);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('modifier-groups/:groupId/modifiers')
  addModifier(
    @Param('groupId') groupId: string,
    @Body() dto: CreateModifierDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.modifiersService.addModifier(groupId, dto, user);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch('modifiers/:modifierId')
  updateModifier(
    @Param('modifierId') modifierId: string,
    @Body() dto: UpdateModifierDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.modifiersService.updateModifier(modifierId, dto, user);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.MANAGER)
  @Delete('modifiers/:modifierId')
  removeModifier(
    @Param('modifierId') modifierId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.modifiersService.removeModifier(modifierId, user);
  }
}
```

> Route-ordering note: NestJS matches routes in declaration order. `items/:itemId/modifier-groups` is more specific than the existing `menu/items/:id` (different controller, `menu/items` prefix) — no collision. Keep `ModifiersController` listed after `MenuItemsController` in the module so `GET menu/items/:id` is unaffected.

- [ ] **Step 7: Register in `MenuModule` and include groups on menu item reads**

`src/menu/menu.module.ts` — full new content:
```typescript
import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { MenuItemsController } from './menu-items.controller';
import { MenuItemsService } from './menu-items.service';
import { ModifiersController } from './modifiers.controller';
import { ModifiersService } from './modifiers.service';

@Module({
  controllers: [CategoriesController, MenuItemsController, ModifiersController],
  providers: [CategoriesService, MenuItemsService, ModifiersService],
  exports: [MenuItemsService, ModifiersService],
})
export class MenuModule {}
```

In `src/menu/menu-items.service.ts`, add a shared include constant near the top (after imports):
```typescript
const menuItemInclude = {
  modifierGroups: {
    include: {
      modifiers: { orderBy: [{ sortOrder: 'asc' as const }, { name: 'asc' as const }] },
    },
    orderBy: [{ sortOrder: 'asc' as const }, { name: 'asc' as const }],
  },
};
```
Then:
- `findAll`: add `include: menuItemInclude` to the `this.prisma.menuItem.findMany({ ... })` call (leave `count` untouched).
- `findOne`: change `findUnique({ where: { id } })` to `findUnique({ where: { id }, include: menuItemInclude })`.

- [ ] **Step 8: Fix the `menu-items.service.spec.ts` findAll expectation**

The `findAll` test asserts `findMany` was called with an object `expect.objectContaining({ where: ... })` — adding `include` does not break `objectContaining`. Run the spec to confirm:

Run: `npx jest src/menu/menu-items.service.spec.ts`
Expected: PASS with no edits. If it fails on a stricter matcher, add `include: expect.anything()` to the `objectContaining`.

- [ ] **Step 9: Quality gates**

Run: `npm run lint && npm run build && npm test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/menu prisma
git commit -m "feat(#161,#162): modifier group/option CRUD API + include groups on menu item reads"
```

---

## Task 3: Order-time selection + validation

**Issues:** #163, #167, #162 (enforcement)

**Files:**
- Modify: `src/menu/modifiers.service.ts` (add `resolveSelections`)
- Modify: `src/menu/modifiers.service.spec.ts` (add `resolveSelections` tests)
- Modify: `src/orders/dto/create-order.dto.ts:29-35`
- Modify: `src/orders/dto/add-order-item.dto.ts:21-27`
- Modify: `src/orders/orders.module.ts`
- Modify: `src/orders/orders.service.ts` (inject `ModifiersService`; call `resolveSelections` in `create` + `addItem` — validation only this task)
- Modify: `src/orders/orders.service.spec.ts` (mock `ModifiersService`)

**Interfaces:**
- Consumes: `ModifiersService`, `ResolvedSelection` from Task 2.
- Produces: `ModifiersService.resolveSelections(menuItemId, modifierIds, restaurantId): Promise<ResolvedSelection>`. `OrderLineDto.modifierIds?: string[]` and `AddOrderItemDto.modifierIds?: string[]` replace the old `modifiers` field.

- [ ] **Step 1: Write the failing `resolveSelections` tests**

Append to `src/menu/modifiers.service.spec.ts` inside the top `describe`:
```typescript
describe('resolveSelections', () => {
  const restaurantId = 'restaurant-A';
  const groups = [
    {
      id: 'size', name: 'Size', required: true, minSelect: 1, maxSelect: 1, sortOrder: 0,
      modifiers: [
        { id: 'sm', name: 'Small', priceDeltaCents: 0, available: true, sortOrder: 0, groupId: 'size' },
        { id: 'lg', name: 'Large', priceDeltaCents: 300, available: true, sortOrder: 1, groupId: 'size' },
      ],
    },
    {
      id: 'extras', name: 'Extras', required: false, minSelect: 0, maxSelect: 2, sortOrder: 1,
      modifiers: [
        { id: 'bacon', name: 'Bacon', priceDeltaCents: 150, available: true, sortOrder: 0, groupId: 'extras' },
        { id: 'egg', name: 'Egg', priceDeltaCents: 120, available: true, sortOrder: 1, groupId: 'extras' },
        { id: 'gone', name: 'Truffle', priceDeltaCents: 900, available: false, sortOrder: 2, groupId: 'extras' },
      ],
    },
  ];

  beforeEach(() => {
    prisma.modifierGroup.findMany.mockResolvedValue(groups);
  });

  it('returns an empty priced selection when the item has no groups and nothing selected', async () => {
    prisma.modifierGroup.findMany.mockResolvedValue([]);
    const result = await service.resolveSelections('item-1', undefined, restaurantId);
    expect(result).toEqual({ selections: [], deltaCentsPerUnit: 0 });
  });

  it('prices and orders a valid selection', async () => {
    const result = await service.resolveSelections('item-1', ['bacon', 'lg'], restaurantId);
    expect(result.deltaCentsPerUnit).toBe(450);
    expect(result.selections.map((s) => s.id)).toEqual(['lg', 'bacon']); // size group first
    expect(result.selections[0]).toMatchObject({ groupName: 'Size', name: 'Large', priceDeltaCents: 300 });
  });

  it('scopes the group lookup by restaurantId', async () => {
    await service.resolveSelections('item-1', ['sm'], restaurantId);
    expect(prisma.modifierGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { menuItemId: 'item-1', restaurantId } }),
    );
  });

  it('rejects a modifier id that does not belong to the item', async () => {
    await expect(
      service.resolveSelections('item-1', ['sm', 'not-a-real-id'], restaurantId),
    ).rejects.toThrow(/invalid modifier/i);
  });

  it('rejects an unavailable modifier', async () => {
    await expect(
      service.resolveSelections('item-1', ['sm', 'gone'], restaurantId),
    ).rejects.toThrow(/not available/i);
  });

  it('rejects the same modifier selected twice', async () => {
    await expect(
      service.resolveSelections('item-1', ['sm', 'sm'], restaurantId),
    ).rejects.toThrow(/more than once/i);
  });

  it('rejects when a required group has no selection', async () => {
    await expect(
      service.resolveSelections('item-1', ['bacon'], restaurantId),
    ).rejects.toThrow(/Size.*required/i);
  });

  it('rejects when a group exceeds maxSelect', async () => {
    await expect(
      service.resolveSelections('item-1', ['sm', 'bacon', 'egg', 'gone'], restaurantId),
    ).rejects.toThrow(/not available/i); // 'gone' trips first
  });

  it('rejects when an optional group exceeds maxSelect (all available)', async () => {
    const twoExtra = [{ ...groups[0] }, { ...groups[1], maxSelect: 1 }];
    prisma.modifierGroup.findMany.mockResolvedValue(twoExtra);
    await expect(
      service.resolveSelections('item-1', ['sm', 'bacon', 'egg'], restaurantId),
    ).rejects.toThrow(/Extras.*at most 1/i);
  });

  it('rejects when a non-required group with selections is below minSelect', async () => {
    const g = [{ ...groups[0] }, { ...groups[1], minSelect: 2 }];
    prisma.modifierGroup.findMany.mockResolvedValue(g);
    await expect(
      service.resolveSelections('item-1', ['sm', 'bacon'], restaurantId),
    ).rejects.toThrow(/Extras.*at least 2/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/menu/modifiers.service.spec.ts -t resolveSelections`
Expected: FAIL — `service.resolveSelections is not a function`.

- [ ] **Step 3: Implement `resolveSelections`**

Add to `ModifiersService` (after `removeModifier`, before `assertMinMax`):
```typescript
  async resolveSelections(
    menuItemId: string,
    modifierIds: string[] | undefined,
    restaurantId: string,
  ): Promise<ResolvedSelection> {
    const ids = modifierIds ?? [];
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('The same modifier was selected more than once');
    }

    const groups = await this.prisma.modifierGroup.findMany({
      where: { menuItemId, restaurantId },
      include: groupInclude,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const byId = new Map<string, { modifier: Modifier; group: ModifierGroup }>();
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
        throw new BadRequestException(`"${hit.modifier.name}" is not available`);
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
        throw new BadRequestException(`Modifier group "${group.name}" is required`);
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
      deltaCentsPerUnit: selections.reduce((s, m) => s + m.priceDeltaCents, 0),
    };
  }
```
Add the type imports at the top of the file:
```typescript
import { Modifier, ModifierGroup } from '@prisma/client';
```
and add `ResolvedModifierSelection`, `ResolvedSelection` to the existing `./dto/modifier.dto` import.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/menu/modifiers.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Swap the order DTO fields**

`src/orders/dto/create-order.dto.ts` — in `OrderLineDto`, replace the `modifiers` property (and drop the now-unused `IsObject` import if nothing else uses it — `create-order.dto.ts` uses it only here):
```typescript
  @ApiPropertyOptional({
    type: [String],
    description: 'IDs of selected modifier options for this line',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  modifierIds?: string[];
```
Add `IsArray` to the `class-validator` import if absent (it is already imported). Keep `IsUUID` (already imported).

`src/orders/dto/add-order-item.dto.ts` — same replacement in `AddOrderItemDto`; update imports: add `IsArray`, drop `IsObject`.

- [ ] **Step 6: Wire `MenuModule` into `OrdersModule`**

`src/orders/orders.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MenuModule } from '../menu/menu.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuditModule, RealtimeModule, MenuModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
```
(No circular import: `MenuModule` does not import `OrdersModule`.)

- [ ] **Step 7: Update the `OrdersService` unit-test harness**

In `src/orders/orders.service.spec.ts`:
- Add to `MockPrisma`: nothing new needed (resolve is on the mocked service).
- Add a `ModifiersService` mock:
```typescript
import { ModifiersService } from '../menu/modifiers.service';
// ...
type MockModifiersService = { resolveSelections: jest.Mock };
function createMockModifiersService(): MockModifiersService {
  return {
    resolveSelections: jest
      .fn()
      .mockResolvedValue({ selections: [], deltaCentsPerUnit: 0 }),
  };
}
```
- In `beforeEach`, construct with the 5th arg:
```typescript
modifiersService = createMockModifiersService();
service = new OrdersService(
  prisma as unknown as PrismaService,
  auditService as unknown as AuditService,
  config as unknown as ConfigService,
  realtimeGateway as unknown as RealtimeGateway,
  modifiersService as unknown as ModifiersService,
);
```
- Declare `let modifiersService: MockModifiersService;` alongside the other lets.

- [ ] **Step 8: Write the failing "validation wired in" tests**

Add to `orders.service.spec.ts` in the `describe('create')` block:
```typescript
it('rejects the order when a line has an invalid modifier selection', async () => {
  prisma.table.findFirst.mockResolvedValue({ id: tableId, status: TableStatus.AVAILABLE });
  modifiersService.resolveSelections.mockRejectedValue(
    new BadRequestException('Modifier group "Size" is required'),
  );

  await expect(
    service.create(
      { ...dto, items: [{ menuItemId, quantity: 1, modifierIds: ['x'] }] } as any,
      user.restaurantId,
      user.id,
    ),
  ).rejects.toThrow(BadRequestException);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
```
And in `describe('addItem')`:
```typescript
it('rejects adding an item with an invalid modifier selection', async () => {
  prisma.order.findUnique.mockResolvedValue(baseOrder);
  prisma.menuItem.findFirst.mockResolvedValue(availableMenuItem);
  modifiersService.resolveSelections.mockRejectedValue(
    new BadRequestException('"Truffle" is not available'),
  );

  await expect(
    service.addItem(orderId, { menuItemId, quantity: 1, modifierIds: ['gone'] }, user),
  ).rejects.toThrow(BadRequestException);
  expect(prisma.orderItem.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 9: Run to verify failure**

Run: `npx jest src/orders/orders.service.spec.ts`
Expected: FAIL — constructor arity / `resolveSelections` never called (and TS compile error until Step 10 lands the constructor param).

- [ ] **Step 10: Implement — inject + validate (no pricing yet)**

In `src/orders/orders.service.ts`:
- Import: `import { ModifiersService } from '../menu/modifiers.service';`
- Add constructor param: `private readonly modifiersService: ModifiersService,` (last).
- In `create()`, replace the `dto.items.map((line) => { ... })` block with an async resolve. Because `.map` can't be async-awaited inline, build `orderItems` with a `for...of` loop:
```typescript
const orderItems: Array<{
  menuItemId: string;
  nameSnapshot: string;
  priceCents: number;
  quantity: number;
  modifiers: Prisma.InputJsonValue | undefined;
  modifierDeltaCents: number;
  notes: string | undefined;
  lineTotalCents: number;
}> = [];
for (const line of dto.items) {
  const item = byId.get(line.menuItemId);
  if (!item) {
    throw new BadRequestException(`Menu item ${line.menuItemId} does not exist`);
  }
  if (!item.available) {
    throw new BadRequestException(`"${item.name}" is not available`);
  }
  const resolved = await this.modifiersService.resolveSelections(
    item.id,
    line.modifierIds,
    restaurantId,
  );
  const modifierDeltaCents = resolved.deltaCentsPerUnit;
  const lineTotalCents = (item.priceCents + modifierDeltaCents) * line.quantity;
  orderItems.push({
    menuItemId: item.id,
    nameSnapshot: item.name,
    priceCents: item.priceCents,
    quantity: line.quantity,
    modifiers: resolved.selections.length
      ? (resolved.selections as unknown as Prisma.InputJsonValue)
      : undefined,
    modifierDeltaCents,
    notes: line.notes,
    lineTotalCents,
  });
}
```
(This task delivers validation; the `modifierDeltaCents` / snapshot writes are exercised fully in Task 4's tests, but wiring them now keeps `create()` in one coherent edit. The `items.create` mapping already spreads `...item`, so `modifierDeltaCents` and `modifiers` flow through.)
- In `addItem()`, after the `menuItem` availability check and before computing `lineTotalCents`:
```typescript
const resolved = await this.modifiersService.resolveSelections(
  menuItem.id,
  dto.modifierIds,
  user.restaurantId,
);
const lineTotalCents =
  (menuItem.priceCents + resolved.deltaCentsPerUnit) * dto.quantity;
```
and in the `orderItem.create({ data: { ... } })` call replace the `modifiers:` line and add `modifierDeltaCents`:
```typescript
        modifiers: resolved.selections.length
          ? (resolved.selections as unknown as Prisma.InputJsonValue)
          : undefined,
        modifierDeltaCents: resolved.deltaCentsPerUnit,
```

- [ ] **Step 11: Run the order tests**

Run: `npx jest src/orders/orders.service.spec.ts`
Expected: PASS. Existing tests that expected `lineTotalCents: 2400` for a 1200×2 line still pass (default mock `deltaCentsPerUnit: 0`).

- [ ] **Step 12: Quality gates**

Run: `npm run lint && npm run build && npm test`
Expected: all pass. If `reservations.service.spec.ts` or other suites break from the DTO rename, it's only in test fixtures still sending `modifiers:` — those are silently dropped by validation, and the DTO type no longer lists the field, so update any fixture object that names it.

- [ ] **Step 13: Commit**

```bash
git add src/menu src/orders
git commit -m "feat(#163,#167): validate selected modifiers against the item's groups at order time"
```

---

## Task 4: Fold price deltas into totals + snapshot; keep recompute paths correct

**Issues:** #164, #168, #169, #165

**Files:**
- Modify: `src/orders/orders.service.ts` — `updateItemQuantity` (use stored delta), `recalculateTotals` (sum `lineTotalCents`), `applyDiscount` (subtotal from `lineTotalCents`)
- Modify: `src/orders/orders.service.spec.ts` — update `orderItem.findMany` mocks to carry `lineTotalCents`; add pricing + snapshot tests

**Interfaces:**
- Consumes: `OrderItem.modifierDeltaCents` (Task 1), the `resolved` selections written in Task 3.
- Produces: line total = `(priceCents + modifierDeltaCents) * quantity`; order `subtotalCents` = Σ `lineTotalCents`; `OrderItem.modifiers` holds `ResolvedModifierSelection[]` (or `null`).

- [ ] **Step 1: Write the failing pricing/snapshot tests**

In `orders.service.spec.ts`:

Update the shared `beforeEach` mocks and add tests. First, in `describe('create')`'s `beforeEach`, the `prisma.orderItem.findMany` mock should include `lineTotalCents`:
```typescript
prisma.orderItem.findMany.mockResolvedValue([
  { priceCents: 1200, quantity: 1, lineTotalCents: 1200 },
]);
```
(Do the same in `addItem`, `updateItemQuantity`, `removeItem` describe blocks and the `recalculateTotals` describe block — every `orderItem.findMany` mock row gains `lineTotalCents` equal to `priceCents * quantity` unless a modifier delta is being tested.)

New tests:
```typescript
it('folds the per-unit modifier delta into the stored line total and snapshot (create)', async () => {
  prisma.table.findFirst.mockResolvedValue({ id: tableId, status: TableStatus.AVAILABLE });
  modifiersService.resolveSelections.mockResolvedValue({
    selections: [
      { id: 'lg', groupId: 'size', groupName: 'Size', name: 'Large', priceDeltaCents: 300 },
    ],
    deltaCentsPerUnit: 300,
  });

  await service.create(
    { ...dto, items: [{ menuItemId, quantity: 2, modifierIds: ['lg'] }] } as any,
    user.restaurantId,
    user.id,
  );

  const created = txOrderCreate.mock.calls[0][0].data.items.create[0];
  expect(created.modifierDeltaCents).toBe(300);
  expect(created.lineTotalCents).toBe((1200 + 300) * 2); // 3000
  expect(created.modifiers).toEqual([
    { id: 'lg', groupId: 'size', groupName: 'Size', name: 'Large', priceDeltaCents: 300 },
  ]);
});

it('stores null modifiers when nothing is selected', async () => {
  prisma.table.findFirst.mockResolvedValue({ id: tableId, status: TableStatus.AVAILABLE });
  await service.create(dto as any, user.restaurantId, user.id);
  const created = txOrderCreate.mock.calls[0][0].data.items.create[0];
  expect(created.modifiers ?? null).toBeNull();
  expect(created.modifierDeltaCents).toBe(0);
});

it('addItem folds the delta into lineTotalCents and writes the snapshot', async () => {
  prisma.order.findUnique.mockResolvedValue(baseOrder);
  prisma.menuItem.findFirst.mockResolvedValue(availableMenuItem);
  prisma.orderItem.create.mockResolvedValue({});
  prisma.orderItem.findMany.mockResolvedValue([{ priceCents: 1200, quantity: 1, lineTotalCents: 1350 }]);
  prisma.order.update.mockResolvedValue({ ...baseOrder, subtotalCents: 1350, taxCents: 0, totalCents: 1350 });
  modifiersService.resolveSelections.mockResolvedValue({
    selections: [{ id: 'bacon', groupId: 'extras', groupName: 'Extras', name: 'Bacon', priceDeltaCents: 150 }],
    deltaCentsPerUnit: 150,
  });

  await service.addItem(orderId, { menuItemId, quantity: 1, modifierIds: ['bacon'] }, user);

  expect(prisma.orderItem.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      lineTotalCents: 1350,
      modifierDeltaCents: 150,
      modifiers: [{ id: 'bacon', groupId: 'extras', groupName: 'Extras', name: 'Bacon', priceDeltaCents: 150 }],
    }),
  });
});

it('updateItemQuantity keeps the modifier delta when quantity changes', async () => {
  prisma.order.findUnique.mockResolvedValue(baseOrder);
  prisma.orderItem.findFirst.mockResolvedValue({
    id: 'oi-1', orderId, priceCents: 1200, quantity: 1, modifierDeltaCents: 300,
  });
  prisma.orderItem.update.mockResolvedValue({});
  prisma.orderItem.findMany.mockResolvedValue([{ priceCents: 1200, quantity: 3, lineTotalCents: 4500 }]);
  prisma.order.update.mockResolvedValue({ ...baseOrder, subtotalCents: 4500, taxCents: 0, totalCents: 4500 });

  await service.updateItemQuantity(orderId, 'oi-1', { quantity: 3 }, user);

  expect(prisma.orderItem.update).toHaveBeenCalledWith({
    where: { id: 'oi-1' },
    data: { quantity: 3, lineTotalCents: (1200 + 300) * 3 },
  });
});

it('recalculateTotals sums lineTotalCents (so modifier deltas count toward the subtotal)', async () => {
  prisma.orderItem.findMany.mockResolvedValue([
    { priceCents: 1200, quantity: 2, lineTotalCents: 3000 }, // includes a +300/unit delta
    { priceCents: 500, quantity: 1, lineTotalCents: 500 },
  ]);
  prisma.order.update.mockImplementation(({ data }: any) => Promise.resolve({ ...baseOrder, ...data }));

  const result = await (service as any).recalculateTotals(orderId, user.restaurantId);
  expect(result.subtotalCents).toBe(3500);
  expect(result.totalCents).toBe(3500);
});
```
Also update the existing `recalculateTotals` tests that asserted `subtotalCents: 2900` from `{ priceCents: 1200, quantity: 2 }` + `{ priceCents: 500, quantity: 1 }` — give those rows `lineTotalCents: 2400` and `lineTotalCents: 500` so the expected `2900` still holds.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/orders/orders.service.spec.ts`
Expected: FAIL — `updateItemQuantity` still computes `priceCents * quantity` (no delta); `recalculateTotals` still sums `priceCents * quantity`.

- [ ] **Step 3: Implement the recompute-path fixes**

In `src/orders/orders.service.ts`:

`updateItemQuantity` — change the line-total computation:
```typescript
const effectiveQuantity = dto.quantity ?? orderItem.quantity;
const lineTotalCents =
  (orderItem.priceCents + orderItem.modifierDeltaCents) * effectiveQuantity;
```

`recalculateTotals` — change the `subtotalCents` reduce:
```typescript
const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
```
(Leave the `discountCents` / `taxRate` / `totalCents` logic untouched.)

`applyDiscount` — change its local `subtotalCents` reduce the same way:
```typescript
const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/orders/orders.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Check the reservations pre-order path**

`ReservationsService.seatDepositOnly` computes a local subtotal from `item.priceCents * item.quantity` for an order it just created **empty** (`items: []`) — delta is structurally 0 there, so no behavior change. Leave it. Run its suite to confirm:

Run: `npx jest src/reservations`
Expected: PASS. If a fixture object passes `modifiers:` to an `OrderLineDto`, rename it to `modifierIds` (array of uuids) or drop it.

- [ ] **Step 6: Quality gates**

Run: `npm run lint && npm run build && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/orders
git commit -m "feat(#164,#168,#169): fold modifier deltas into line totals + snapshot onto OrderItem.modifiers"
```

---

## Task 5: End-to-end tests, seed data, generated spec

**Issue:** #170 (plus wrap-up for the epic)

**Files:**
- Create: `test/modifiers.e2e-spec.ts`
- Modify: `prisma/seed.ts`
- Modify: `site/openapi.json` (regenerated)
- Modify: `docs/superpowers/specs/2026-08-19-v1-remaining-epics-design.md`

**Interfaces:**
- Consumes: everything above, over HTTP.

- [ ] **Step 1: Add demo modifier data to the seed**

In `prisma/seed.ts`, after the "Classic Cheeseburger" `menuItem.upsert` (id `2222...`), add:
```typescript
  // ─── Demo modifiers on the Classic Cheeseburger ───────────────
  const sizeGroupId = '66666666-6666-4666-8666-666666666601';
  await prisma.modifierGroup.upsert({
    where: { id: sizeGroupId },
    update: {},
    create: {
      id: sizeGroupId,
      name: 'Size',
      required: true,
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 0,
      menuItemId: '22222222-2222-4222-8222-222222222222',
      restaurantId: restaurant.id,
      modifiers: {
        create: [
          { id: '66666666-6666-4666-8666-6666666666a1', name: 'Regular', priceDeltaCents: 0, sortOrder: 0, restaurantId: restaurant.id },
          { id: '66666666-6666-4666-8666-6666666666a2', name: 'Double', priceDeltaCents: 400, sortOrder: 1, restaurantId: restaurant.id },
        ],
      },
    },
  });

  const extrasGroupId = '66666666-6666-4666-8666-666666666602';
  await prisma.modifierGroup.upsert({
    where: { id: extrasGroupId },
    update: {},
    create: {
      id: extrasGroupId,
      name: 'Extras',
      required: false,
      minSelect: 0,
      maxSelect: 3,
      sortOrder: 1,
      menuItemId: '22222222-2222-4222-8222-222222222222',
      restaurantId: restaurant.id,
      modifiers: {
        create: [
          { id: '66666666-6666-4666-8666-6666666666b1', name: 'Bacon', priceDeltaCents: 150, sortOrder: 0, restaurantId: restaurant.id },
          { id: '66666666-6666-4666-8666-6666666666b2', name: 'Fried Egg', priceDeltaCents: 120, sortOrder: 1, restaurantId: restaurant.id },
          { id: '66666666-6666-4666-8666-6666666666b3', name: 'No pickles', priceDeltaCents: 0, sortOrder: 2, restaurantId: restaurant.id },
        ],
      },
    },
  });
```

- [ ] **Step 2: Re-seed locally**

Run:
```bash
npm run prisma:migrate      # applies the Task 1 migration to the dev DB if not yet
npm run prisma:seed
```
Expected: no errors; upserts are idempotent.

- [ ] **Step 3: Write the e2e spec**

Create `test/modifiers.e2e-spec.ts`:
```typescript
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Covers Epic #6 end-to-end: manager defines modifier groups/options on a
// menu item; order creation validates the selection, prices it server-side,
// and snapshots it onto the order item.
describe('Menu item modifiers (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;

  let categoryId: string;
  let itemId: string;
  let sizeGroupId: string;
  let regularId: string;
  let largeId: string;
  let baconId: string;
  let tableId: string;

  const BASE = 1500;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@restosync.local', password: 'Admin123!' })
      .expect(200);
    adminToken = login.body.accessToken;

    const category = await request(app.getHttpServer())
      .post('/api/menu/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Mods_${Date.now()}` })
      .expect(201);
    categoryId = category.body.id;

    const item = await request(app.getHttpServer())
      .post('/api/menu/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Mod Burger ${Date.now()}`, priceCents: BASE, categoryId })
      .expect(201);
    itemId = item.body.id;

    const table = await request(app.getHttpServer())
      .post('/api/tables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `MT_${Date.now()}` })
      .expect(201);
    tableId = table.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a required single-select group with nested options', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/menu/items/${itemId}/modifier-groups`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Size',
        required: true,
        minSelect: 1,
        maxSelect: 1,
        modifiers: [
          { name: 'Regular', priceDeltaCents: 0 },
          { name: 'Large', priceDeltaCents: 300 },
        ],
      })
      .expect(201);

    sizeGroupId = res.body.id;
    regularId = res.body.modifiers.find((m: any) => m.name === 'Regular').id;
    largeId = res.body.modifiers.find((m: any) => m.name === 'Large').id;
    expect(res.body.required).toBe(true);
  });

  it('rejects a group where minSelect > maxSelect', async () => {
    await request(app.getHttpServer())
      .post(`/api/menu/items/${itemId}/modifier-groups`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bad', minSelect: 3, maxSelect: 1 })
      .expect(400);
  });

  it('adds an optional extras group + option', async () => {
    const group = await request(app.getHttpServer())
      .post(`/api/menu/items/${itemId}/modifier-groups`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Extras', maxSelect: 2 })
      .expect(201);

    const bacon = await request(app.getHttpServer())
      .post(`/api/menu/modifier-groups/${group.body.id}/modifiers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bacon', priceDeltaCents: 150 })
      .expect(201);
    baconId = bacon.body.id;
  });

  it('exposes groups on the public menu item read', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/menu/items/${itemId}`)
      .expect(200);
    expect(res.body.modifierGroups).toHaveLength(2);
  });

  it('rejects an order that omits the required group', async () => {
    await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'DINE_IN', tableId, items: [{ menuItemId: itemId, quantity: 1 }] })
      .expect(400);
  });

  it('rejects an order selecting a modifier from another item', async () => {
    await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DINE_IN',
        tableId,
        items: [{ menuItemId: itemId, quantity: 1, modifierIds: ['00000000-0000-4000-8000-000000000000'] }],
      })
      .expect(400);
  });

  it('rejects exceeding maxSelect on the size group', async () => {
    await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DINE_IN',
        tableId,
        items: [{ menuItemId: itemId, quantity: 1, modifierIds: [regularId, largeId] }],
      })
      .expect(400);
  });

  it('prices a valid selection server-side and snapshots it', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DINE_IN',
        tableId,
        items: [{ menuItemId: itemId, quantity: 2, modifierIds: [largeId, baconId] }],
      })
      .expect(201);

    // (1500 + 300 + 150) * 2 = 3900
    expect(res.body.subtotalCents).toBe(3900);
    const line = res.body.items[0];
    expect(line.lineTotalCents).toBe(3900);
    expect(line.modifierDeltaCents).toBe(450);
    expect(line.modifiers.map((m: any) => m.name).sort()).toEqual(['Bacon', 'Large']);
    expect(line.modifiers[0]).toHaveProperty('priceDeltaCents');
  });

  it('recomputes totals when adding a modified line to an open order', async () => {
    const order = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DINE_IN',
        tableId,
        items: [{ menuItemId: itemId, quantity: 1, modifierIds: [regularId] }],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/orders/${order.body.id}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ menuItemId: itemId, quantity: 1, modifierIds: [largeId, baconId] })
      .expect(201);

    // line A: 1500 ; line B: 1500+300+150 = 1950 ; subtotal 3450
    expect(res.body.subtotalCents).toBe(3450);
  });
});
```

- [ ] **Step 4: Run the e2e suite**

Run:
```bash
docker compose up postgres -d
npm run prisma:migrate
npm run prisma:seed
npm run test:e2e
```
Expected: `test/modifiers.e2e-spec.ts` passes and no existing e2e suite regresses (`tax`, `tables`, `reservations`, `realtime`, `restaurants`, `tenant-isolation`, `app`).

- [ ] **Step 5: Regenerate the OpenAPI spec**

Run: `npm run openapi:generate`
Expected: `site/openapi.json` updated with the `menu` modifier routes and the `modifierIds` line field. Stage the diff.

- [ ] **Step 6: Mark the epic implemented in the spec doc**

In `docs/superpowers/specs/2026-08-19-v1-remaining-epics-design.md`, under `### Epic #6 — Menu item modifiers / options`, change the status line to note it is now implemented (add one line: `**Status: Implemented** — see docs/superpowers/plans/2026-08-28-menu-item-modifiers.md`). Do not rewrite the section.

- [ ] **Step 7: Full quality gate**

Run: `npm run lint && npm run build && npm run test:cov && npm run test:e2e`
Expected: all green. `test:cov` must clear the `src/orders/` line threshold (31%) — the added order-path tests only raise it.

- [ ] **Step 8: Commit**

```bash
git add test/modifiers.e2e-spec.ts prisma/seed.ts site/openapi.json docs/superpowers/specs/2026-08-19-v1-remaining-epics-design.md
git commit -m "test(#170): e2e coverage for modifier validation, pricing, and snapshot"
```

- [ ] **Step 9: Open the PR**

```bash
git push -u origin <feature-branch>
gh pr create --title "feat: menu item modifiers / options (epic #6)" --body "Closes #6, #161, #162, #163, #164, #165, #166, #167, #168, #169, #170"
```
Wait for CI green, then merge.

---

## Self-Review

**1. Spec coverage** (Epic #6 sub-issues):

| Sub-issue | Covered by |
|---|---|
| #161 define groups/options per item | Task 2 (DTOs, `createGroup` w/ nested options, `addModifier`, controller) |
| #162 required/optional + min/max | Task 2 (`assertMinMax`, DTO fields) + Task 3 (`resolveSelections` enforcement + tests) |
| #163 select modifiers on an order line | Task 3 (`modifierIds` DTO field, `create`/`addItem` wiring) |
| #164 line total includes deltas | Task 3 (line-total formula) + Task 4 (`updateItemQuantity`, e2e assertion) |
| #165 snapshot for historical accuracy | Task 4 (`modifiers` JSON write with name+delta) + e2e assertion |
| #166 models + migration | Task 1 |
| #167 validate against item's groups | Task 3 |
| #168 fold deltas into server-side line-total | Task 3 + Task 4 (`recalculateTotals`, `applyDiscount`) |
| #169 snapshot onto OrderItem.modifiers | Task 4 |
| #170 unit + e2e tests | Tasks 2–4 (unit, TDD) + Task 5 (e2e) |

**2. Placeholder scan:** no TBD/TODO; every code step has literal code. Validation rules are spelled out, not "add validation".

**3. Type consistency:** `resolveSelections(menuItemId, modifierIds, restaurantId)` signature identical in Interfaces, Task 3 impl, and all call sites. `ResolvedSelection.deltaCentsPerUnit` used consistently (not `deltaCents`/`deltaTotal`). `OrderItem.modifierDeltaCents` (per-unit) named identically in schema, service, tests. DTO field `modifierIds` (not `modifierOptionIds`/`modifiers`) everywhere. Line-total invariant `(priceCents + modifierDeltaCents) * quantity` used in `create`, `addItem`, `updateItemQuantity`.

**Known breaking change (intentional, per the epic):** `OrderLineDto.modifiers` / `AddOrderItemDto.modifiers` (free-form object, previously a cosmetic pass-through with no logic attached) are replaced by `modifierIds: string[]`. `CreateReservationDto` reuses `OrderLineDto`, so WITH_PREORDER pre-orders inherit `modifierIds` for free. `site/openapi.json` regen + `restosync-web` client sync (via the existing oasdiff→dispatch pipeline) will pick this up.
