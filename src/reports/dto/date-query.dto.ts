import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class DateQueryDto {
  @ApiProperty({
    example: '2025-06-30',
    description: 'Date in YYYY-MM-DD format',
  })
  @IsDateString()
  date!: string;
}
