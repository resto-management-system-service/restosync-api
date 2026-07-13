import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

// Only meaningful for INFORMAL reservations, where no table was chosen at
// reservation time — staff picks an available table when the customer
// actually arrives. Ignored for WITH_PREORDER/DEPOSIT_ONLY, which already
// have a committed table from reservation creation.
export class SeatReservationDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Required only when seating an INFORMAL reservation',
  })
  @IsOptional()
  @IsUUID()
  tableId?: string;
}
