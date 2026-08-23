import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { RestaurantsService } from './restaurants.service';

@ApiTags('restaurants')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Get()
  @ApiOperation({ summary: 'List all restaurants' })
  @ApiResponse({ status: 200, description: 'List of restaurants' })
  findAll() {
    return this.restaurantsService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Create a new restaurant (empty isolated space)' })
  @ApiResponse({ status: 201, description: 'Restaurant created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  create(@Body() dto: CreateRestaurantDto) {
    return this.restaurantsService.create(dto);
  }
}
