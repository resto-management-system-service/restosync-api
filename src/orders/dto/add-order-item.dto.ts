import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
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
    type: [String],
    description: 'IDs of selected modifier options for this line',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  modifierIds?: string[];

  @ApiPropertyOptional({ description: 'Kitchen instructions for this item' })
  @IsOptional()
  @IsString()
  notes?: string;
}
