import { PrismaService } from '../prisma/prisma.service';
import { RestaurantsService } from './restaurants.service';

type MockPrisma = {
  restaurant: {
    create: jest.Mock;
    findMany: jest.Mock;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    restaurant: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('RestaurantsService', () => {
  let service: RestaurantsService;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new RestaurantsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('creates a Restaurant with the given name and timezone', async () => {
      const created = {
        id: 'restaurant-1',
        name: 'La Mar',
        timezone: 'Europe/Madrid',
      };
      prisma.restaurant.create.mockResolvedValue(created);

      const result = await service.create({
        name: 'La Mar',
        timezone: 'Europe/Madrid',
      });

      expect(prisma.restaurant.create).toHaveBeenCalledWith({
        data: { name: 'La Mar', timezone: 'Europe/Madrid' },
      });
      expect(result).toBe(created);
    });

    it('defaults timezone to "America/Lima" when not provided', async () => {
      prisma.restaurant.create.mockResolvedValue({
        id: 'restaurant-2',
        name: 'La Mar',
        timezone: 'America/Lima',
      });

      await service.create({ name: 'La Mar' });

      expect(prisma.restaurant.create).toHaveBeenCalledWith({
        data: { name: 'La Mar', timezone: 'America/Lima' },
      });
    });
  });

  describe('findAll', () => {
    it('returns all restaurants ordered by name', async () => {
      const restaurants = [
        { id: 'r1', name: 'El Buen Filo' },
        { id: 'r2', name: 'La Mar' },
      ];
      prisma.restaurant.findMany.mockResolvedValue(restaurants);

      const result = await service.findAll();

      expect(prisma.restaurant.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
      });
      expect(result).toBe(restaurants);
    });
  });
});
