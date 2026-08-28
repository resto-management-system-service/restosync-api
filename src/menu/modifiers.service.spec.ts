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
      prisma.menuItem.findFirst.mockResolvedValue({
        id: 'item-1',
        restaurantId: user.restaurantId,
      });
      prisma.modifierGroup.create.mockResolvedValue({
        id: 'g1',
        modifiers: [],
      });

      await service.createGroup(
        'item-1',
        {
          name: 'Size',
          required: true,
          minSelect: 1,
          maxSelect: 1,
          modifiers: [{ name: 'L', priceDeltaCents: 200 }],
        },
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
      prisma.menuItem.findFirst.mockResolvedValue({
        id: 'item-1',
        restaurantId: user.restaurantId,
      });
      await expect(
        service.createGroup(
          'item-1',
          { name: 'Size', minSelect: 3, maxSelect: 1 },
          user,
        ),
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
      prisma.modifierGroup.findUnique.mockResolvedValue({
        id: 'g1',
        restaurantId: 'restaurant-B',
      });
      await expect(service.removeGroup('g1', user)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.modifierGroup.delete).not.toHaveBeenCalled();
    });

    it('addModifier sets restaurantId from the group, not the client', async () => {
      prisma.modifierGroup.findUnique.mockResolvedValue({
        id: 'g1',
        restaurantId: user.restaurantId,
      });
      prisma.modifier.create.mockResolvedValue({ id: 'm1' });
      await service.addModifier(
        'g1',
        { name: 'Bacon', priceDeltaCents: 150 },
        user,
      );
      const arg = prisma.modifier.create.mock.calls[0][0];
      expect(arg.data.restaurantId).toBe(user.restaurantId);
      expect(arg.data.groupId).toBe('g1');
    });
  });

  describe('resolveSelections', () => {
    const restaurantId = 'restaurant-A';
    const groups = [
      {
        id: 'size',
        name: 'Size',
        required: true,
        minSelect: 1,
        maxSelect: 1,
        sortOrder: 0,
        modifiers: [
          {
            id: 'sm',
            name: 'Small',
            priceDeltaCents: 0,
            available: true,
            sortOrder: 0,
            groupId: 'size',
          },
          {
            id: 'lg',
            name: 'Large',
            priceDeltaCents: 300,
            available: true,
            sortOrder: 1,
            groupId: 'size',
          },
        ],
      },
      {
        id: 'extras',
        name: 'Extras',
        required: false,
        minSelect: 0,
        maxSelect: 2,
        sortOrder: 1,
        modifiers: [
          {
            id: 'bacon',
            name: 'Bacon',
            priceDeltaCents: 150,
            available: true,
            sortOrder: 0,
            groupId: 'extras',
          },
          {
            id: 'egg',
            name: 'Egg',
            priceDeltaCents: 120,
            available: true,
            sortOrder: 1,
            groupId: 'extras',
          },
          {
            id: 'gone',
            name: 'Truffle',
            priceDeltaCents: 900,
            available: false,
            sortOrder: 2,
            groupId: 'extras',
          },
        ],
      },
    ];

    beforeEach(() => {
      prisma.modifierGroup.findMany.mockResolvedValue(groups);
    });

    it('returns an empty priced selection when the item has no groups and nothing selected', async () => {
      prisma.modifierGroup.findMany.mockResolvedValue([]);
      const result = await service.resolveSelections(
        'item-1',
        undefined,
        restaurantId,
      );
      expect(result).toEqual({ selections: [], deltaCentsPerUnit: 0 });
    });

    it('prices and orders a valid selection', async () => {
      const result = await service.resolveSelections(
        'item-1',
        ['bacon', 'lg'],
        restaurantId,
      );
      expect(result.deltaCentsPerUnit).toBe(450);
      expect(result.selections.map((s) => s.id)).toEqual(['lg', 'bacon']);
      expect(result.selections[0]).toMatchObject({
        groupName: 'Size',
        name: 'Large',
        priceDeltaCents: 300,
      });
    });

    it('scopes the group lookup by restaurantId', async () => {
      await service.resolveSelections('item-1', ['sm'], restaurantId);
      expect(prisma.modifierGroup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { menuItemId: 'item-1', restaurantId },
        }),
      );
    });

    it('rejects a modifier id that does not belong to the item', async () => {
      await expect(
        service.resolveSelections(
          'item-1',
          ['sm', 'not-a-real-id'],
          restaurantId,
        ),
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

    it('rejects when an optional group exceeds maxSelect (all available)', async () => {
      const twoExtra = [{ ...groups[0] }, { ...groups[1], maxSelect: 1 }];
      prisma.modifierGroup.findMany.mockResolvedValue(twoExtra);
      await expect(
        service.resolveSelections(
          'item-1',
          ['sm', 'bacon', 'egg'],
          restaurantId,
        ),
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
});
