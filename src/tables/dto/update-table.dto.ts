import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

// Status is intentionally excluded — it is only changed by the order
// lifecycle (opening/paying an order), never directly by a user.
export class UpdateTableDto {
  @ApiPropertyOptional({ description: 'Table name/number, must be unique' })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Seating capacity' })
  @IsInt()
  @Min(1)
  @IsOptional()
  capacity?: number;
}
