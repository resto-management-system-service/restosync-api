import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
  @ApiOperation({
    summary: 'Create a modifier group (optionally with options) on a menu item',
  })
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
  @ApiOperation({ summary: 'Update a modifier group' })
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
  @ApiOperation({ summary: 'Delete a modifier group and its options' })
  removeGroup(
    @Param('groupId') groupId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.modifiersService.removeGroup(groupId, user);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('modifier-groups/:groupId/modifiers')
  @ApiOperation({ summary: 'Add an option to a modifier group' })
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
  @ApiOperation({ summary: 'Update a modifier option' })
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
  @ApiOperation({ summary: 'Delete a modifier option' })
  removeModifier(
    @Param('modifierId') modifierId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.modifiersService.removeModifier(modifierId, user);
  }
}
