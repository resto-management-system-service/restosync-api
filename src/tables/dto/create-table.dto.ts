import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateTableDto {
  @ApiProperty({ description: 'Table name/number, must be unique' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: 'Seating capacity' })
  @IsInt()
  @Min(1)
  @IsOptional()
  capacity?: number;
}
