import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import {
  paginate,
  PaginationQueryDto,
} from '../common/dto/pagination-query.dto';

const safeSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  active: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginationQueryDto, user: AuthUser) {
    const where: Prisma.UserWhereInput = { restaurantId: user.restaurantId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: safeSelect,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string, user: AuthUser) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { ...safeSelect, restaurantId: true },
    });
    if (!target || target.restaurantId !== user.restaurantId) {
      throw new NotFoundException('User not found');
    }
    const { restaurantId: _omitted, ...safeUser } = target;
    void _omitted;
    return safeUser;
  }
}
