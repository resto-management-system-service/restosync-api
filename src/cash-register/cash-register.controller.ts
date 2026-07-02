import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CashRegisterService } from './cash-register.service';
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
  openSession(@Body() dto: OpenSessionDto, @CurrentUser('id') userId: string) {
    return this.cashRegisterService.openSession(dto, userId);
  }
}
