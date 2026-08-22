import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';

@Injectable()
export class RestaurantsService {
  constructor(private readonly prisma: PrismaService) {}

  // Restaurant is the tenant root — it does not itself belong to another
  // restaurant, so no restaurantId scoping applies here (unlike every
  // other service in this codebase).
  create(dto: CreateRestaurantDto) {
    return this.prisma.restaurant.create({
      data: {
        name: dto.name,
        timezone: dto.timezone ?? 'America/Lima',
      },
    });
  }

  findAll() {
    return this.prisma.restaurant.findMany({
      orderBy: { name: 'asc' },
    });
  }
}
