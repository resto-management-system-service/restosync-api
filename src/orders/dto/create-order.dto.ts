import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class OrderLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  menuItemId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    description:
      'Free-form modifiers (e.g. { "size": "L", "extras": ["bacon"] })',
  })
  @IsOptional()
  @IsObject()
  modifiers?: Record<string, unknown>;
}

export class CreateOrderDto {
  @ApiProperty({ enum: OrderType, default: OrderType.DINE_IN })
  @IsEnum(OrderType)
  type!: OrderType;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.type === OrderType.DINE_IN)
  @IsString()
  @IsNotEmpty({ message: 'table is required for dine-in orders' })
  table?: string;

  @ApiProperty({ type: [OrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
