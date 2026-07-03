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
import { ApplyDiscountDto } from './dto/apply-discount.dto';
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
  @Roles(Role.WAITER, Role.CASHIER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({
    summary: 'Open a new order (supports notes per order and per line)',
  })
  @ApiResponse({ status: 201, description: 'Order created in DRAFT status' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@Body() dto: CreateOrderDto, @CurrentUser('id') userId: string) {
    return this.ordersService.create(dto, userId);
  }

  @Get()
  @Roles(Role.CASHIER, Role.MANAGER, Role.ADMIN)
  findAll(@Query() query: PaginationQueryDto, @CurrentUser() user: AuthUser) {
    return this.ordersService.findAll(query, user);
  }

  @Roles(Role.WAITER, Role.CASHIER, Role.MANAGER, Role.ADMIN)
  @Get('open')
  @ApiOperation({ summary: 'List open orders with current totals' })
  @ApiResponse({
    status: 200,
    description: 'List of DRAFT/PENDING orders with totals',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findOpen() {
    return this.ordersService.findOpen();
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
  @Roles(Role.WAITER, Role.CASHIER, Role.MANAGER, Role.ADMIN)
  @Post(':id/items')
  @ApiOperation({
    summary: 'Add a product to an open order (supports per-line kitchen notes)',
  })
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
  @Roles(Role.WAITER, Role.CASHIER, Role.MANAGER, Role.ADMIN)
  @Patch(':id/items/:itemId')
  @ApiOperation({ summary: 'Change quantity or notes of an order line' })
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
  @Roles(Role.WAITER, Role.CASHIER, Role.MANAGER, Role.ADMIN)
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
  @Roles(Role.WAITER, Role.CASHIER, Role.MANAGER, Role.ADMIN)
  @Post(':id/confirm')
  @ApiOperation({ summary: 'Close an order and send to checkout' })
  @ApiResponse({ status: 200, description: 'Order closed, status PENDING' })
  @ApiResponse({
    status: 400,
    description: 'Order has no items or invalid transition',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  confirmOrder(@Param('id') id: string) {
    return this.ordersService.confirmOrder(id);
  }

  @ApiBearerAuth()
  @ApiTags('orders')
  @Roles(Role.CASHIER, Role.MANAGER, Role.ADMIN)
  @Patch(':id/discount')
  @ApiOperation({ summary: 'Apply a discount to an open order' })
  @ApiResponse({
    status: 200,
    description: 'Discount applied, total recomputed',
  })
  @ApiResponse({
    status: 400,
    description: 'Order not editable or discount exceeds subtotal',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  applyDiscount(@Param('id') id: string, @Body() dto: ApplyDiscountDto) {
    return this.ordersService.applyDiscount(id, dto);
  }
}
