import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class DateRangeQueryDto {
  @ApiProperty({
    example: '2025-06-01',
    description: 'Start date in YYYY-MM-DD format',
  })
  @IsDateString()
  startDate!: string;

  @ApiProperty({
    example: '2025-06-30',
    description: 'End date in YYYY-MM-DD format',
  })
  @IsDateString()
  endDate!: string;
}
