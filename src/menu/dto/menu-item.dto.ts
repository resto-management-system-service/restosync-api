import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class CreateMenuItemDto {
  @ApiProperty({ example: 'Classic Cheeseburger' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 1200, description: 'Price in integer cents' })
  @IsInt()
  @Min(0)
  priceCents!: number;

  @ApiPropertyOptional({ default: 'usd' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    description: 'Public URL of the product image',
    example: 'https://example.com/images/ceviche.jpg',
  })
  @IsOptional()
  @IsUrl()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  available?: boolean;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;
}

export class UpdateMenuItemDto extends PartialType(CreateMenuItemDto) {}

export class MenuItemQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by product name (case-insensitive)',
    example: 'ceviche',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Only return available items' })
  @IsOptional()
  @IsBoolean()
  available?: boolean;
}
