import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdjustmentType } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class AdjustStockDto {
  @ApiProperty({
    enum: AdjustmentType,
    description: 'Type of stock adjustment',
  })
  @IsEnum(AdjustmentType)
  type!: AdjustmentType;

  @ApiProperty({
    description: 'Quantity change (positive = in, negative = out)',
  })
  @IsNumber()
  quantityDelta!: number;

  @ApiPropertyOptional({ description: 'Reason for the adjustment' })
  @IsString()
  @IsOptional()
  reason?: string;
}
