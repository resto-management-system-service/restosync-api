import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { CashRegisterService } from './cash-register.service';
import { CloseSessionDto } from './dto/close-session.dto';
import { OpenSessionDto } from './dto/open-session.dto';

@ApiTags('cash-register')
@ApiBearerAuth()
@Controller('cash-register')
export class CashRegisterController {
  constructor(private readonly cashRegisterService: CashRegisterService) {}

  @Roles(Role.CASHIER, Role.MANAGER, Role.ADMIN)
  @Post('open')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Open cash register with starting float' })
  @ApiResponse({ status: 201, description: 'Session opened' })
  @ApiResponse({ status: 400, description: 'Session already open' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  openSession(@Body() dto: OpenSessionDto, @CurrentUser() user: AuthUser) {
    return this.cashRegisterService.openSession(dto, user);
  }

  @Roles(Role.CASHIER, Role.MANAGER, Role.ADMIN)
  @Post('close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close cash register with reconciliation' })
  @ApiResponse({
    status: 200,
    description: 'Session closed with expected vs counted reconciliation',
  })
  @ApiResponse({ status: 400, description: 'No active session' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  closeSession(@Body() dto: CloseSessionDto, @CurrentUser() user: AuthUser) {
    return this.cashRegisterService.closeSession(dto, user);
  }

  @Roles(Role.CASHIER, Role.MANAGER, Role.ADMIN)
  @Get('sessions/:id/summary')
  @ApiOperation({ summary: 'Get summary for a specific register session' })
  @ApiResponse({
    status: 200,
    description: 'Session summary with totals by payment method',
  })
  @ApiResponse({ status: 404, description: 'Session not found' })
  getSessionSummary(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.cashRegisterService.getSessionSummary(id, user);
  }

  @Roles(Role.CASHIER, Role.MANAGER, Role.ADMIN)
  @Get('current/summary')
  @ApiOperation({ summary: 'Get summary for the current active session' })
  @ApiResponse({ status: 200, description: 'Current session summary' })
  @ApiResponse({ status: 404, description: 'No active session' })
  getCurrentSummary(@CurrentUser() user: AuthUser) {
    return this.cashRegisterService.getCurrentSummary(user);
  }
}
