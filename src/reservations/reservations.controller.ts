import {
  Body,
  Controller,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ListReservationsQueryDto } from './dto/list-reservations-query.dto';
import { SeatReservationDto } from './dto/seat-reservation.dto';
import { ReservationsService } from './reservations.service';

@ApiTags('reservations')
@ApiBearerAuth()
@Roles(Role.CASHIER, Role.MANAGER, Role.ADMIN)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Register a reservation (WITH_PREORDER, DEPOSIT_ONLY, or INFORMAL)',
  })
  @ApiResponse({ status: 201, description: 'Reservation created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Table not found' })
  create(@Body() dto: CreateReservationDto, @CurrentUser('id') userId: string) {
    return this.reservationsService.create(dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List reservations, filterable by status/date' })
  @ApiResponse({ status: 200, description: 'List of reservations' })
  findAll(@Query() query: ListReservationsQueryDto) {
    return this.reservationsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single reservation' })
  @ApiResponse({ status: 200, description: 'Reservation details' })
  @ApiResponse({ status: 404, description: 'Reservation not found' })
  findOne(@Param('id') id: string) {
    return this.reservationsService.findOne(id);
  }

  @Patch(':id/confirm')
  @ApiOperation({
    summary:
      'Confirm a reservation (deposit received); commits the table to RESERVED for paid types',
  })
  @ApiResponse({ status: 200, description: 'Reservation confirmed' })
  @ApiResponse({ status: 400, description: 'Reservation not PENDING' })
  @ApiResponse({ status: 404, description: 'Reservation not found' })
  confirm(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.reservationsService.confirm(id, userId);
  }

  @Post(':id/seat')
  @ApiOperation({
    summary:
      'Seat the customer: creates/links the order and sets the table OCCUPIED',
  })
  @ApiResponse({ status: 201, description: 'Order created/linked' })
  @ApiResponse({
    status: 400,
    description: 'Reservation not CONFIRMED or missing required data',
  })
  @ApiResponse({ status: 404, description: 'Reservation not found' })
  seat(
    @Param('id') id: string,
    @Body() dto: SeatReservationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.reservationsService.seat(id, dto, userId);
  }

  @Patch(':id/no-show')
  @ApiOperation({
    summary: 'Mark as a no-show (staff decision, never automatic)',
  })
  @ApiResponse({ status: 200, description: 'Reservation marked NO_SHOW' })
  @ApiResponse({ status: 400, description: 'Reservation already terminal' })
  @ApiResponse({ status: 404, description: 'Reservation not found' })
  noShow(@Param('id') id: string) {
    return this.reservationsService.noShow(id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a reservation' })
  @ApiResponse({ status: 200, description: 'Reservation cancelled' })
  @ApiResponse({ status: 400, description: 'Reservation already terminal' })
  @ApiResponse({ status: 404, description: 'Reservation not found' })
  cancel(@Param('id') id: string) {
    return this.reservationsService.cancel(id);
  }
}
