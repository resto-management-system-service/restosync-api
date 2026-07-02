import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { DateQueryDto } from './dto/date-query.dto';
import { DateRangeQueryDto } from './dto/date-range-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Roles(Role.MANAGER, Role.ADMIN)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('daily-summary')
  @ApiOperation({ summary: 'Daily sales summary' })
  @ApiResponse({
    status: 200,
    description: 'Total sales, ticket count, average ticket',
  })
  getDailySummary(@Query() query: DateQueryDto) {
    return this.reportsService.getDailySummary(query.date);
  }

  @Get('payment-methods')
  @ApiOperation({ summary: 'Sales breakdown by payment method' })
  @ApiResponse({ status: 200, description: 'Amount per payment method' })
  getPaymentMethodBreakdown(@Query() query: DateQueryDto) {
    return this.reportsService.getPaymentMethodBreakdown(query.date);
  }

  @Get('best-selling')
  @ApiOperation({ summary: 'Best selling products for the day' })
  @ApiResponse({
    status: 200,
    description: 'Top products by quantity sold',
  })
  getBestSellingProducts(
    @Query() query: DateQueryDto,
    @Query('limit') limit?: number,
  ) {
    return this.reportsService.getBestSellingProducts(query.date, limit ?? 10);
  }

  @Get('closed-tickets')
  @ApiOperation({ summary: 'Closed tickets in date range' })
  @ApiResponse({ status: 200, description: 'List of closed orders' })
  getClosedTickets(@Query() query: DateRangeQueryDto) {
    return this.reportsService.getClosedTickets(query.startDate, query.endDate);
  }

  @Get('daily-summary-range')
  @ApiOperation({ summary: 'Daily sales totals for a date range' })
  @ApiResponse({
    status: 200,
    description: 'Array of daily sales summaries',
  })
  getDailySummaryRange(@Query() query: DateRangeQueryDto) {
    return this.reportsService.getDailySummaryRange(
      query.startDate,
      query.endDate,
    );
  }

  @Get('payment-methods-range')
  @ApiOperation({ summary: 'Payment method breakdown for a date range' })
  @ApiResponse({ status: 200, description: 'Amount per payment method' })
  getPaymentMethodBreakdownRange(@Query() query: DateRangeQueryDto) {
    return this.reportsService.getPaymentMethodBreakdownRange(
      query.startDate,
      query.endDate,
    );
  }

  @Get('tickets-by-day')
  @ApiOperation({ summary: 'Closed ticket count grouped by day' })
  @ApiResponse({
    status: 200,
    description: 'Array of daily ticket counts',
  })
  getTicketCountByDay(@Query() query: DateRangeQueryDto) {
    return this.reportsService.getTicketCountByDay(
      query.startDate,
      query.endDate,
    );
  }
}
