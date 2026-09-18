import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { ZonesService } from './zones.service';

@ApiTags('zones')
@ApiBearerAuth()
@Controller('zones')
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Post()
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Create a zone' })
  @ApiResponse({ status: 201, description: 'Zone created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  create(@Body() dto: CreateZoneDto, @CurrentUser() user: AuthUser) {
    return this.zonesService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List zones for the current restaurant' })
  @ApiResponse({
    status: 200,
    description: 'List of zones ordered by sortOrder',
  })
  findAll(@CurrentUser() user: AuthUser) {
    return this.zonesService.findAll(user);
  }

  @Get(':id/next-table-name')
  @ApiOperation({
    summary: 'Suggest the next available table name for a zone',
  })
  @ApiResponse({
    status: 200,
    description: 'Suggested table name, e.g. { "suggestedName": "102" }',
  })
  @ApiResponse({ status: 404, description: 'Zone not found' })
  getNextTableName(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.zonesService.getNextTableName(id, user);
  }

  @Patch(':id')
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Rename or reorder a zone' })
  @ApiResponse({ status: 200, description: 'Zone updated' })
  @ApiResponse({ status: 404, description: 'Zone not found' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateZoneDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.zonesService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Delete a zone (only if it has no tables)' })
  @ApiResponse({ status: 200, description: 'Zone deleted' })
  @ApiResponse({ status: 400, description: 'Zone still has tables assigned' })
  @ApiResponse({ status: 404, description: 'Zone not found' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.zonesService.remove(id, user);
  }
}
