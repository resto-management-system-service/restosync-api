import { Controller, Get, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { toCsv } from '../common/utils/csv';
import { DateQueryDto } from './dto/date-query.dto';
import { DateRangeQueryDto } from './dto/date-range-query.dto';
import { ReportsService } from './reports.service';

function flattenPaymentMethods(
  byMethod: Record<string, number>,
): { method: string; amountCents: number }[] {
  return Object.entries(byMethod).map(([method, amountCents]) => ({
    method,
    amountCents,
  }));
}

function sendCsv(
  res: Response,
  filename: string,
  rows: Record<string, unknown>[],
  columns?: string[],
): void {
  const csv = toCsv(rows, columns);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

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
  async getDailySummary(
    @Query() query: DateQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getDailySummary(query.date);

    if (query.format === 'csv') {
      sendCsv(res, `daily-summary-${query.date}.csv`, [result]);
      return;
    }

    return result;
  }

  @Get('payment-methods')
  @ApiOperation({ summary: 'Sales breakdown by payment method' })
  @ApiResponse({ status: 200, description: 'Amount per payment method' })
  async getPaymentMethodBreakdown(
    @Query() query: DateQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getPaymentMethodBreakdown(
      query.date,
    );

    if (query.format === 'csv') {
      sendCsv(
        res,
        `payment-methods-${query.date}.csv`,
        flattenPaymentMethods(result),
        ['method', 'amountCents'],
      );
      return;
    }

    return result;
  }

  @Get('best-selling')
  @ApiOperation({ summary: 'Best-selling products by quantity and revenue' })
  @ApiResponse({
    status: 200,
    description: 'Top products by quantity sold',
  })
  async getBestSellingProducts(
    @Query() query: DateQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getBestSellingProducts(
      query.date,
      query.limit ?? 10,
    );

    if (query.format === 'csv') {
      sendCsv(res, `best-selling-${query.date}.csv`, result, [
        'menuItemId',
        'name',
        'quantitySold',
        'revenueCents',
      ]);
      return;
    }

    return result;
  }

  @Get('closed-tickets')
  @ApiOperation({ summary: 'Closed tickets in date range' })
  @ApiResponse({ status: 200, description: 'List of closed orders' })
  async getClosedTickets(
    @Query() query: DateRangeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getClosedTickets(
      query.startDate,
      query.endDate,
    );

    if (query.format === 'csv') {
      sendCsv(
        res,
        `closed-tickets-${query.startDate}_${query.endDate}.csv`,
        result,
        ['id', 'number', 'totalCents', 'status', 'createdAt', 'itemCount'],
      );
      return;
    }

    return result;
  }

  @Get('daily-summary-range')
  @ApiOperation({ summary: 'Daily sales totals for a date range' })
  @ApiResponse({
    status: 200,
    description: 'Array of daily sales summaries',
  })
  async getDailySummaryRange(
    @Query() query: DateRangeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getDailySummaryRange(
      query.startDate,
      query.endDate,
    );

    if (query.format === 'csv') {
      sendCsv(
        res,
        `daily-summary-range-${query.startDate}_${query.endDate}.csv`,
        result,
        ['date', 'totalSalesCents', 'ticketCount', 'averageTicketCents'],
      );
      return;
    }

    return result;
  }

  @Get('payment-methods-range')
  @ApiOperation({ summary: 'Payment method breakdown for a date range' })
  @ApiResponse({ status: 200, description: 'Amount per payment method' })
  async getPaymentMethodBreakdownRange(
    @Query() query: DateRangeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getPaymentMethodBreakdownRange(
      query.startDate,
      query.endDate,
    );

    if (query.format === 'csv') {
      // NOTE: getPaymentMethodBreakdownRange returns a flat
      // Record<PaymentMethod, number> aggregated over the whole range
      // (not grouped per-day) — verified in reports.service.ts. The
      // flattening logic mirrors payment-methods exactly.
      sendCsv(
        res,
        `payment-methods-range-${query.startDate}_${query.endDate}.csv`,
        flattenPaymentMethods(result),
        ['method', 'amountCents'],
      );
      return;
    }

    return result;
  }

  @Get('tickets-by-day')
  @ApiOperation({ summary: 'Closed ticket count grouped by day' })
  @ApiResponse({
    status: 200,
    description: 'Array of daily ticket counts',
  })
  async getTicketCountByDay(
    @Query() query: DateRangeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getTicketCountByDay(
      query.startDate,
      query.endDate,
    );

    if (query.format === 'csv') {
      sendCsv(
        res,
        `tickets-by-day-${query.startDate}_${query.endDate}.csv`,
        result,
        ['date', 'ticketCount'],
      );
      return;
    }

    return result;
  }
}
