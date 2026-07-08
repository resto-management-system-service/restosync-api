import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class DateQueryDto {
  @ApiProperty({
    example: '2025-06-30',
    description: 'Date in YYYY-MM-DD format',
  })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({
    example: 10,
    description: 'Max number of results to return',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
