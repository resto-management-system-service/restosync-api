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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CreateMenuItemDto,
  MenuItemQueryDto,
  UpdateMenuItemDto,
} from './dto/menu-item.dto';
import { MenuItemsService } from './menu-items.service';

@ApiTags('menu')
@Controller('menu/items')
export class MenuItemsController {
  constructor(private readonly menuItemsService: MenuItemsService) {}

  @Public()
  @ApiOperation({
    summary: 'List menu items with optional name search and pagination',
  })
  @Get()
  findAll(@Query() query: MenuItemQueryDto) {
    return this.menuItemsService.findAll(query);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.menuItemsService.findOne(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Create a menu item (imageUrl is a public URL, no file upload)',
  })
  @Post()
  create(@Body() dto: CreateMenuItemDto, @CurrentUser() user: AuthUser) {
    return this.menuItemsService.create(dto, user);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Associate a public image URL with a product',
  })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMenuItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.menuItemsService.update(id, dto, user);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.menuItemsService.remove(id, user);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Deactivate a product (soft delete — preserves order history)',
  })
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.menuItemsService.deactivate(id, user);
  }
}
