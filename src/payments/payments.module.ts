import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway.interface';
import { StripeGateway } from './gateway/stripe.gateway';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [OrdersModule, InventoryModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    { provide: PAYMENT_GATEWAY, useClass: StripeGateway },
  ],
})
export class PaymentsModule {}
