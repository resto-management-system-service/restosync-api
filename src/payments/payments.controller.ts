import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import {
  AuthUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CheckoutDto } from './dto/checkout.dto';
import { CreateIntentDto } from './dto/create-intent.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiBearerAuth()
  @Post('intent')
  @HttpCode(HttpStatus.CREATED)
  createIntent(@Body() dto: CreateIntentDto, @CurrentUser() user: AuthUser) {
    return this.paymentsService.createIntent(dto.orderId, user);
  }

  @ApiBearerAuth()
  @Roles(Role.STAFF, Role.ADMIN)
  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record payment method on checkout' })
  @ApiResponse({
    status: 201,
    description: 'Payment recorded with method, amount and order link',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error or insufficient payment',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  checkout(@Body() dto: CheckoutDto, @CurrentUser() user: AuthUser) {
    return this.paymentsService.checkout(dto, user);
  }

  @Public()
  @ApiExcludeEndpoint()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body');
    }
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    return this.paymentsService.handleWebhook(req.rawBody, signature);
  }
}
