import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CheckoutDto {
  @ApiProperty({ format: 'uuid', description: 'Order to check out' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ enum: PaymentMethod, description: 'Payment method used' })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiProperty({ description: 'Amount physically received, in cents' })
  @IsInt()
  @Min(0)
  amountPaidCents!: number;

  @ApiPropertyOptional({ description: 'Optional notes for this payment' })
  @IsString()
  @IsOptional()
  notes?: string;
}
