import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MenuModule } from '../menu/menu.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuditModule, RealtimeModule, MenuModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
