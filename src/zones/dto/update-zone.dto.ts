import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class UpdateZoneDto {
  @ApiPropertyOptional({ description: 'Zone name, e.g. "Piso 1" or "Terraza"' })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description:
      'Short alphanumeric zone code used as a table-name prefix, e.g. "1", "2", "T", "VIP"',
    example: '1',
  })
  @IsString()
  @Matches(/^[a-zA-Z0-9]{1,10}$/, {
    message:
      'code must be 1-10 alphanumeric characters with no spaces or special characters',
  })
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ description: 'Sort order for display' })
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
