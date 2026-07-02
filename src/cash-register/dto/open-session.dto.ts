import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class OpenSessionDto {
  @ApiProperty({
    description: 'Starting float amount in cents',
    example: 10000,
  })
  @IsInt()
  @Min(0)
  openingFloatCents!: number;

  @ApiPropertyOptional({ description: 'Optional notes for the session' })
  @IsString()
  @IsOptional()
  notes?: string;
}
