import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateModifierDto {
  @ApiProperty({ example: 'Large' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({
    default: 0,
    description: 'Price change in integer cents; may be negative for removals',
  })
  @IsOptional()
  @IsInt()
  priceDeltaCents?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  available?: boolean;
}

export class UpdateModifierDto extends PartialType(CreateModifierDto) {}

export class CreateModifierGroupDto {
  @ApiProperty({ example: 'Size' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({
    default: 0,
    description: 'Minimum selections when the group is used',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  minSelect?: number;

  @ApiPropertyOptional({
    default: 1,
    description: 'Maximum selections allowed',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxSelect?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    type: [CreateModifierDto],
    description: 'Options to create with the group',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateModifierDto)
  modifiers?: CreateModifierDto[];
}

// PartialType drops the nested `modifiers` array on update — options are
// managed individually via the /modifiers endpoints.
export class UpdateModifierGroupDto extends PartialType(
  CreateModifierGroupDto,
) {}

export interface ResolvedModifierSelection {
  id: string;
  groupId: string;
  groupName: string;
  name: string;
  priceDeltaCents: number;
}

export interface ResolvedSelection {
  selections: ResolvedModifierSelection[];
  deltaCentsPerUnit: number;
}
