import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CloseSessionDto {
  @ApiProperty({
    description: 'Physically counted amount in cents',
    example: 25000,
  })
  @IsInt()
  @Min(0)
  countedCents!: number;

  @ApiPropertyOptional({ description: 'Optional notes for the session' })
  @IsString()
  @IsOptional()
  notes?: string;
}
