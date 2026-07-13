import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReservationType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OrderLineDto } from '../../orders/dto/create-order.dto';

export class CreateReservationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  customerName!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  customerPhone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiProperty({ example: 4, minimum: 1 })
  @IsInt()
  @Min(1)
  partySize!: number;

  @ApiProperty({ description: 'Date/time the customer is expected' })
  @IsDateString()
  reservedFor!: string;

  // Fully optional and freely editable by staff — if omitted, the service
  // applies a type-appropriate default (INFORMAL: 10, DEPOSIT_ONLY: 20,
  // WITH_PREORDER: 30 minutes), reflecting that reservations with more
  // money already committed reasonably get more patience before being
  // marked no-show. If provided, the given value is used exactly as-is,
  // with no clamping beyond this base validation.
  @ApiPropertyOptional({
    description:
      'Grace period in minutes before staff decides on a no-show. Defaults ' +
      'vary by reservationType when omitted (INFORMAL: 10, DEPOSIT_ONLY: ' +
      '20, WITH_PREORDER: 30) but any explicit value is honored exactly.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  toleranceMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  allergies?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialOccasion?: string;

  @ApiProperty({ enum: ReservationType })
  @IsEnum(ReservationType)
  reservationType!: ReservationType;

  // Required (and must reference an AVAILABLE table) for WITH_PREORDER and
  // DEPOSIT_ONLY — a specific table is committed once the deposit is
  // confirmed. NOT accepted for INFORMAL (no table is chosen until the
  // customer actually arrives) — enforced in the service, since rejecting
  // an unexpected value for a *different* type isn't expressible with a
  // single bare @ValidateIf on this field without conflicting with the
  // "required for these two types" condition below.
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(
    (o) =>
      o.reservationType === ReservationType.WITH_PREORDER ||
      o.reservationType === ReservationType.DEPOSIT_ONLY,
  )
  @IsUUID(undefined, { message: 'tableId must be a valid UUID' })
  @IsNotEmpty({
    message:
      'tableId is required for WITH_PREORDER and DEPOSIT_ONLY reservations',
  })
  tableId?: string;

  // Required for WITH_PREORDER (the phone pre-order). NOT accepted for
  // DEPOSIT_ONLY or INFORMAL — enforced in the service (see note above).
  @ApiPropertyOptional({ type: [OrderLineDto] })
  @ValidateIf((o) => o.reservationType === ReservationType.WITH_PREORDER)
  @IsArray()
  @ArrayMinSize(1, {
    message: 'items is required for WITH_PREORDER reservations',
  })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items?: OrderLineDto[];
}
