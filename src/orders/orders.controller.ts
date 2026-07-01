import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AddOrderItemDto } from './dto/add-order-item.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderItemDto } from './dto/update-order-item.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Open a new order' })
  @ApiResponse({ status: 201, description: 'Order created in DRAFT status' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@Body() dto: CreateOrderDto, @CurrentUser('id') userId: string) {
    return this.ordersService.create(dto, userId);
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto, @CurrentUser() user: AuthUser) {
    return this.ordersService.findAll(query, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.ordersService.findOne(id, user);
  }

  @Roles(Role.ADMIN, Role.STAFF)
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.ordersService.updateStatus(id, dto.status);
  }

  @ApiBearerAuth()
  @ApiTags('orders')
  @Roles(Role.STAFF, Role.ADMIN)
  @Post(':id/items')
  @ApiOperation({ summary: 'Add a product to an open order' })
  @ApiResponse({
    status: 201,
    description: 'Item added with price snapshot, total recomputed',
  })
  @ApiResponse({
    status: 400,
    description: 'Order not editable or validation error',
  })
  @ApiResponse({ status: 404, description: 'Order or menu item not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  addItem(@Param('id') id: string, @Body() dto: AddOrderItemDto) {
    return this.ordersService.addItem(id, dto);
  }

  @ApiBearerAuth()
  @ApiTags('orders')
  @Roles(Role.STAFF, Role.ADMIN)
  @Patch(':id/items/:itemId')
  @ApiOperation({ summary: 'Change quantity of an order line' })
  @ApiResponse({
    status: 200,
    description: 'Quantity updated, total recomputed',
  })
  @ApiResponse({
    status: 400,
    description: 'Order not editable or validation error',
  })
  @ApiResponse({ status: 404, description: 'Order or item not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  updateItemQuantity(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateOrderItemDto,
  ) {
    return this.ordersService.updateItemQuantity(id, itemId, dto);
  }

  @ApiBearerAuth()
  @ApiTags('orders')
  @Roles(Role.STAFF, Role.ADMIN)
  @Delete(':id/items/:itemId')
  @ApiOperation({ summary: 'Remove a line from an open order' })
  @ApiResponse({ status: 200, description: 'Line removed, totals recomputed' })
  @ApiResponse({ status: 400, description: 'Order not editable' })
  @ApiResponse({ status: 404, description: 'Order or item not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.ordersService.removeItem(id, itemId);
  }

  @ApiBearerAuth()
  @ApiTags('orders')
  @Roles(Role.STAFF, Role.ADMIN)
  @Post(':id/confirm')
  confirmOrder(@Param('id') id: string) {
    return this.ordersService.confirmOrder(id);
  }
}
