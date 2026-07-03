import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
  IsString,
} from 'class-validator';

export class AddOrderItemDto {
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

  @ApiPropertyOptional({ description: 'Kitchen instructions for this item' })
  @IsOptional()
  @IsString()
  notes?: string;
}
