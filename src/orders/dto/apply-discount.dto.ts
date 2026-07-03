import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class ApplyDiscountDto {
  @ApiProperty({
    enum: DiscountType,
    example: 'FIXED',
  })
  @IsEnum(DiscountType)
  discountType!: DiscountType;

  @ApiPropertyOptional({
    description: 'Required when discountType is FIXED. Amount in cents.',
    example: 500,
  })
  @ValidateIf((o) => o.discountType === DiscountType.FIXED)
  @IsInt({ message: 'discountCents is required for FIXED discounts' })
  @Min(0)
  discountCents?: number;

  @ApiPropertyOptional({
    description: 'Required when discountType is PERCENTAGE. 0-100.',
    example: 15,
  })
  @ValidateIf((o) => o.discountType === DiscountType.PERCENTAGE)
  @IsInt({ message: 'discountPercent is required for PERCENTAGE discounts' })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiPropertyOptional({
    description: 'Reason for the discount (audit trail)',
    example: 'Loyal customer comp',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  reason?: string;
}
