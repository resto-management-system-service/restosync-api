import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateIntentDto {
  @ApiProperty({ format: 'uuid', description: 'Order to pay for' })
  @IsUUID()
  orderId!: string;
}
