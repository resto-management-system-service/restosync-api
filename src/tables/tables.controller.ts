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
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { TablesService } from './tables.service';

@ApiTags('tables')
@ApiBearerAuth()
@Controller('tables')
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get()
  @ApiOperation({ summary: 'List all tables with their current status' })
  @ApiResponse({
    status: 200,
    description:
      'List of tables; OCCUPIED tables include a summary of the active order',
  })
  findAll() {
    return this.tablesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single table' })
  @ApiResponse({ status: 200, description: 'Table details' })
  @ApiResponse({ status: 404, description: 'Table not found' })
  findOne(@Param('id') id: string) {
    return this.tablesService.findOne(id);
  }

  @Post()
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Create a new table' })
  @ApiResponse({ status: 201, description: 'Table created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  create(@Body() dto: CreateTableDto) {
    return this.tablesService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Update a table name/capacity' })
  @ApiResponse({ status: 200, description: 'Table updated' })
  @ApiResponse({ status: 404, description: 'Table not found' })
  update(@Param('id') id: string, @Body() dto: UpdateTableDto) {
    return this.tablesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Delete a table (only if AVAILABLE)' })
  @ApiResponse({ status: 200, description: 'Table deleted' })
  @ApiResponse({ status: 400, description: 'Table is currently occupied' })
  @ApiResponse({ status: 404, description: 'Table not found' })
  remove(@Param('id') id: string) {
    return this.tablesService.remove(id);
  }
}
