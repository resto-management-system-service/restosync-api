import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

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

  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}
