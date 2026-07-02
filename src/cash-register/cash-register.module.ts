import { Module } from '@nestjs/common';
import { CashRegisterController } from './cash-register.controller';
import { CashRegisterService } from './cash-register.service';

@Module({
  controllers: [CashRegisterController],
  providers: [CashRegisterService],
})
export class CashRegisterModule {}
