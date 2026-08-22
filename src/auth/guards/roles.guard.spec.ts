import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { InventoryController } from '../../inventory/inventory.controller';
import { OrdersController } from '../../orders/orders.controller';
import { PaymentsController } from '../../payments/payments.controller';
import { ReportsController } from '../../reports/reports.controller';
import { RolesGuard } from './roles.guard';

function executionContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controller: any,
  methodName: string,
  role: Role,
): ExecutionContext {
  return {
    getHandler: () => controller.prototype[methodName],
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ user: { role } }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard (RBAC)', () => {
  let guard: RolesGuard;

  beforeEach(() => {
    guard = new RolesGuard(new Reflector());
  });

  it('allows KITCHEN on GET /orders and PATCH /orders/:id/status', () => {
    expect(
      guard.canActivate(
        executionContext(OrdersController, 'findAll', Role.KITCHEN),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        executionContext(OrdersController, 'updateStatus', Role.KITCHEN),
      ),
    ).toBe(true);
  });

  it('keeps existing roles on GET /orders and PATCH /orders/:id/status', () => {
    expect(
      guard.canActivate(
        executionContext(OrdersController, 'findAll', Role.ADMIN),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        executionContext(OrdersController, 'updateStatus', Role.STAFF),
      ),
    ).toBe(true);
  });

  it('rejects KITCHEN on POST /payments/checkout', () => {
    expect(() =>
      guard.canActivate(
        executionContext(PaymentsController, 'checkout', Role.KITCHEN),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects KITCHEN on GET /reports/daily-summary', () => {
    expect(() =>
      guard.canActivate(
        executionContext(ReportsController, 'getDailySummary', Role.KITCHEN),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects KITCHEN on POST /inventory', () => {
    expect(() =>
      guard.canActivate(
        executionContext(InventoryController, 'create', Role.KITCHEN),
      ),
    ).toThrow(ForbiddenException);
  });
});
