import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateRestaurantDto {
  @ApiProperty({ example: 'El Buen Filo' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    default: 'America/Lima',
    description: 'IANA timezone used to interpret restaurant-local times',
  })
  @IsOptional()
  @IsString()
  timezone?: string;
}
