import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class UpdateZoneDto {
  @ApiPropertyOptional({ description: 'Zone name, e.g. "Piso 1" or "Terraza"' })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Sort order for display' })
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
