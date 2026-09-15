import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

const TABLE_SHAPES = ['rounded', 'square', 'circle'] as const;

export class UpdateTableLayoutDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Zone this table belongs to',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'zoneId must be a valid UUID' })
  zoneId?: string;

  @ApiPropertyOptional({
    description: 'X position as a percentage of the canvas (0.0–1.0)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  positionX?: number;

  @ApiPropertyOptional({
    description: 'Y position as a percentage of the canvas (0.0–1.0)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  positionY?: number;

  @ApiPropertyOptional({
    description: 'Width as a percentage of the canvas (0.0–1.0)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  width?: number;

  @ApiPropertyOptional({
    description: 'Height as a percentage of the canvas (0.0–1.0)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  height?: number;

  @ApiPropertyOptional({ enum: TABLE_SHAPES, default: 'rounded' })
  @IsOptional()
  @IsIn(TABLE_SHAPES)
  shape?: string;
}
