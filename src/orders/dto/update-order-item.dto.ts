import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateOrderItemDto {
  @ApiProperty({ example: 2, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Kitchen instructions for this item' })
  @IsOptional()
  @IsString()
  notes?: string;
}
