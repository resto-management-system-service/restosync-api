import { OrderStatus } from '@prisma/client';
import { canTransition } from './order-status';

describe('order status machine', () => {
  it('allows the happy path PENDING -> CONFIRMED -> PREPARING -> READY -> COMPLETED', () => {
    expect(canTransition(OrderStatus.PENDING, OrderStatus.CONFIRMED)).toBe(
      true,
    );
    expect(canTransition(OrderStatus.CONFIRMED, OrderStatus.PREPARING)).toBe(
      true,
    );
    expect(canTransition(OrderStatus.PREPARING, OrderStatus.READY)).toBe(true);
    expect(canTransition(OrderStatus.READY, OrderStatus.COMPLETED)).toBe(true);
  });

  it('rejects illegal jumps', () => {
    expect(canTransition(OrderStatus.PENDING, OrderStatus.READY)).toBe(false);
    expect(canTransition(OrderStatus.COMPLETED, OrderStatus.PENDING)).toBe(
      false,
    );
    expect(canTransition(OrderStatus.CANCELLED, OrderStatus.CONFIRMED)).toBe(
      false,
    );
  });

  it('allows cancellation only before READY', () => {
    expect(canTransition(OrderStatus.PENDING, OrderStatus.CANCELLED)).toBe(
      true,
    );
    expect(canTransition(OrderStatus.PREPARING, OrderStatus.CANCELLED)).toBe(
      true,
    );
    expect(canTransition(OrderStatus.READY, OrderStatus.CANCELLED)).toBe(false);
  });
});
