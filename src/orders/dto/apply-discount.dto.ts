import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ApplyDiscountDto {
  @ApiProperty({
    description: 'Discount amount in cents',
    example: 500,
  })
  @IsInt()
  @Min(0)
  discountCents!: number;
}
