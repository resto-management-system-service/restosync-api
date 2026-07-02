import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateInventoryItemDto {
  @ApiProperty({ description: 'Name of the inventory item' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    description: 'Unit of measurement (unit, kg, l, etc.)',
    default: 'unit',
  })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiPropertyOptional({ description: 'Current quantity on hand', default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  quantityOnHand?: number;

  @ApiPropertyOptional({ description: 'Low stock alert threshold', default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  lowStockThreshold?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Link to a menu item',
  })
  @IsUUID()
  @IsOptional()
  menuItemId?: string;
}
