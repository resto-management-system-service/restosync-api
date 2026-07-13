import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DiscountType,
  OrderType,
  ReservationStatus,
  ReservationType,
  TableStatus,
} from '@prisma/client';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from './reservations.service';

type MockPrisma = {
  table: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  reservation: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  order: {
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createMockPrisma(): MockPrisma {
  const txTable = { update: jest.fn().mockResolvedValue({}) };
  const txReservation = { update: jest.fn().mockResolvedValue({}) };
  const txOrder = { update: jest.fn().mockResolvedValue({}) };

  const prisma: MockPrisma = {
    table: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    reservation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    order: {
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  // Supports both callback-style `$transaction(async (tx) => ...)` (used by
  // confirm()/terminate()) and array-style `$transaction([p1, p2, p3])`
  // (used by seatWithPreorder()), mirroring the real Prisma client's dual
  // signature.
  prisma.$transaction.mockImplementation((arg) => {
    if (typeof arg === 'function') {
      return arg({
        table: txTable,
        reservation: txReservation,
        order: txOrder,
      });
    }
    return Promise.all(arg);
  });

  return prisma;
}

describe('ReservationsService', () => {
  let service: ReservationsService;
  let prisma: MockPrisma;
  let ordersService: {
    create: jest.Mock;
    applyDiscount: jest.Mock;
  };
  let config: { get: jest.Mock };

  const actorId = 'user-1';
  const tableId = 'table-1';
  const reservationId = 'reservation-1';
  const menuItemId = 'menu-item-1';

  const availableTable = { id: tableId, status: TableStatus.AVAILABLE };

  beforeEach(() => {
    prisma = createMockPrisma();
    ordersService = {
      create: jest.fn(),
      applyDiscount: jest.fn(),
    };
    config = {
      get: jest.fn((key: string) =>
        key === 'reservations.depositCents' ? 1000 : undefined,
      ),
    };
    service = new ReservationsService(
      prisma as unknown as PrismaService,
      ordersService as unknown as OrdersService,
      config as unknown as ConfigService,
    );
  });

  describe('create', () => {
    const baseDto = {
      customerName: 'Jane Doe',
      customerPhone: '+51999999999',
      partySize: 4,
      reservedFor: '2026-08-01T20:00:00.000Z',
    };

    it('WITH_PREORDER: computes depositCents as floor(order.totalCents / 2) and creates the pre-order via OrdersService', async () => {
      prisma.table.findUnique.mockResolvedValue(availableTable);
      ordersService.create.mockResolvedValue({
        id: 'order-1',
        totalCents: 4501,
      });
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: reservationId, ...data }),
      );

      const dto = {
        ...baseDto,
        reservationType: ReservationType.WITH_PREORDER,
        tableId,
        items: [{ menuItemId, quantity: 2 }],
      };

      const result = await service.create(dto as any, actorId);

      expect(prisma.table.findUnique).toHaveBeenCalledWith({
        where: { id: tableId },
      });
      expect(ordersService.create).toHaveBeenCalledWith({
        type: OrderType.TAKEAWAY,
        items: dto.items,
      });
      // floor(4501 / 2) = 2250
      expect(result.depositCents).toBe(2250);
      expect(result.orderId).toBe('order-1');
      expect(result.tableId).toBe(tableId);
      expect(result.status).toBe(ReservationStatus.PENDING);
      expect(result.createdBy).toBe(actorId);
    });

    it('DEPOSIT_ONLY: uses the configured fixed deposit amount', async () => {
      prisma.table.findUnique.mockResolvedValue(availableTable);
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: reservationId, ...data }),
      );

      const dto = {
        ...baseDto,
        reservationType: ReservationType.DEPOSIT_ONLY,
        tableId,
      };

      const result = await service.create(dto as any, actorId);

      expect(config.get).toHaveBeenCalledWith('reservations.depositCents');
      expect(result.depositCents).toBe(1000);
      expect(result.orderId).toBeNull();
      expect(ordersService.create).not.toHaveBeenCalled();
    });

    it('INFORMAL: no table, no order, depositCents is 0', async () => {
      prisma.reservation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: reservationId, ...data }),
      );

      const dto = {
        ...baseDto,
        reservationType: ReservationType.INFORMAL,
      };

      const result = await service.create(dto as any, actorId);

      expect(prisma.table.findUnique).not.toHaveBeenCalled();
      expect(ordersService.create).not.toHaveBeenCalled();
      expect(result.depositCents).toBeUndefined();
      expect(result.tableId).toBeUndefined();
      expect(result.orderId).toBeUndefined();
    });

    it('rejects INFORMAL reservations that include a tableId', async () => {
      const dto = {
        ...baseDto,
        reservationType: ReservationType.INFORMAL,
        tableId,
      };

      await expect(service.create(dto as any, actorId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects INFORMAL reservations that include items', async () => {
      const dto = {
        ...baseDto,
        reservationType: ReservationType.INFORMAL,
        items: [{ menuItemId, quantity: 1 }],
      };

      await expect(service.create(dto as any, actorId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects DEPOSIT_ONLY reservations that include items', async () => {
      prisma.table.findUnique.mockResolvedValue(availableTable);

      const dto = {
        ...baseDto,
        reservationType: ReservationType.DEPOSIT_ONLY,
        tableId,
        items: [{ menuItemId, quantity: 1 }],
      };

      await expect(service.create(dto as any, actorId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the table does not exist', async () => {
      prisma.table.findUnique.mockResolvedValue(null);

      const dto = {
        ...baseDto,
        reservationType: ReservationType.DEPOSIT_ONLY,
        tableId,
      };

      await expect(service.create(dto as any, actorId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the table is not AVAILABLE', async () => {
      prisma.table.findUnique.mockResolvedValue({
        id: tableId,
        status: TableStatus.OCCUPIED,
      });

      const dto = {
        ...baseDto,
        reservationType: ReservationType.WITH_PREORDER,
        tableId,
        items: [{ menuItemId, quantity: 1 }],
      };

      await expect(service.create(dto as any, actorId)).rejects.toThrow(
        BadRequestException,
      );
    });

    describe('toleranceMinutes defaults (type-aware, overridable)', () => {
      beforeEach(() => {
        prisma.table.findUnique.mockResolvedValue(availableTable);
        prisma.reservation.create.mockImplementation(({ data }) =>
          Promise.resolve({ id: reservationId, ...data }),
        );
        ordersService.create.mockResolvedValue({
          id: 'order-1',
          totalCents: 1000,
        });
      });

      it('defaults to 10 minutes for INFORMAL when omitted', async () => {
        const result = await service.create(
          { ...baseDto, reservationType: ReservationType.INFORMAL } as any,
          actorId,
        );
        expect(result.toleranceMinutes).toBe(10);
      });

      it('defaults to 20 minutes for DEPOSIT_ONLY when omitted', async () => {
        const result = await service.create(
          {
            ...baseDto,
            reservationType: ReservationType.DEPOSIT_ONLY,
            tableId,
          } as any,
          actorId,
        );
        expect(result.toleranceMinutes).toBe(20);
      });

      it('defaults to 30 minutes for WITH_PREORDER when omitted', async () => {
        const result = await service.create(
          {
            ...baseDto,
            reservationType: ReservationType.WITH_PREORDER,
            tableId,
            items: [{ menuItemId, quantity: 1 }],
          } as any,
          actorId,
        );
        expect(result.toleranceMinutes).toBe(30);
      });

      it('honors an explicit toleranceMinutes exactly, regardless of type, with no clamping', async () => {
        const result = await service.create(
          {
            ...baseDto,
            reservationType: ReservationType.INFORMAL,
            toleranceMinutes: 999,
          } as any,
          actorId,
        );
        expect(result.toleranceMinutes).toBe(999);
      });

      it('honors a small explicit override even for WITH_PREORDER (no minimum enforced beyond the DTO)', async () => {
        const result = await service.create(
          {
            ...baseDto,
            reservationType: ReservationType.WITH_PREORDER,
            tableId,
            items: [{ menuItemId, quantity: 1 }],
            toleranceMinutes: 1,
          } as any,
          actorId,
        );
        expect(result.toleranceMinutes).toBe(1);
      });
    });
  });

  describe('confirm', () => {
    it('sets Table.status to RESERVED for WITH_PREORDER/DEPOSIT_ONLY and stamps the deposit confirmation', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.PENDING,
        reservationType: ReservationType.DEPOSIT_ONLY,
        tableId,
      });
      const txTableUpdate = jest.fn().mockResolvedValue({});
      const txReservationUpdate = jest.fn().mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CONFIRMED,
        depositConfirmedBy: actorId,
      });
      prisma.$transaction.mockImplementationOnce((cb) =>
        cb({
          table: { update: txTableUpdate },
          reservation: { update: txReservationUpdate },
        }),
      );

      const result = await service.confirm(reservationId, actorId);

      expect(txTableUpdate).toHaveBeenCalledWith({
        where: { id: tableId },
        data: { status: TableStatus.RESERVED },
      });
      expect(txReservationUpdate).toHaveBeenCalledWith({
        where: { id: reservationId },
        data: expect.objectContaining({
          status: ReservationStatus.CONFIRMED,
          depositConfirmedBy: actorId,
        }),
      });
      expect(result.status).toBe(ReservationStatus.CONFIRMED);
    });

    it('does NOT touch the table for INFORMAL reservations', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.PENDING,
        reservationType: ReservationType.INFORMAL,
        tableId: null,
      });
      prisma.reservation.update.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CONFIRMED,
      });

      const result = await service.confirm(reservationId, actorId);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: reservationId },
        data: { status: ReservationStatus.CONFIRMED },
      });
      expect(result.status).toBe(ReservationStatus.CONFIRMED);
    });

    it('throws BadRequestException if the reservation is not PENDING', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CONFIRMED,
        reservationType: ReservationType.INFORMAL,
      });

      await expect(service.confirm(reservationId, actorId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException if the reservation does not exist', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);

      await expect(service.confirm(reservationId, actorId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('seat', () => {
    it('WITH_PREORDER: links the existing order to the table and sets it OCCUPIED', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CONFIRMED,
        reservationType: ReservationType.WITH_PREORDER,
        orderId: 'order-1',
        tableId,
      });
      prisma.table.update.mockResolvedValue({});
      prisma.reservation.update.mockResolvedValue({});
      prisma.order.update.mockResolvedValue({
        id: 'order-1',
        tableId,
        items: [],
      });

      const result = await service.seat(reservationId, {}, actorId);

      expect(prisma.table.update).toHaveBeenCalledWith({
        where: { id: tableId },
        data: { status: TableStatus.OCCUPIED },
      });
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: reservationId },
        data: { status: ReservationStatus.SEATED },
      });
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { tableId },
        include: { items: true },
      });
      expect(ordersService.create).not.toHaveBeenCalled();
      expect(result.id).toBe('order-1');
    });

    it('DEPOSIT_ONLY: creates a new (empty) order via OrdersService.create and links it, WITHOUT applying the discount yet', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CONFIRMED,
        reservationType: ReservationType.DEPOSIT_ONLY,
        tableId,
        depositCents: 1000,
      });
      // Order is created empty — no pre-order for DEPOSIT_ONLY — so its
      // subtotal is $0 right now. Applying a FIXED discount larger than a
      // $0 subtotal would be rejected by OrdersService.applyDiscount()'s
      // shared "discount cannot exceed subtotal" guard (which must NOT be
      // weakened for this flow), so the deposit is deliberately not
      // auto-applied here.
      ordersService.create.mockResolvedValue({ id: 'order-2', items: [] });

      const result = await service.seat(reservationId, {}, actorId);

      expect(ordersService.create).toHaveBeenCalledWith({
        type: OrderType.DINE_IN,
        tableId,
        items: [],
      });
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: reservationId },
        data: { orderId: 'order-2', status: ReservationStatus.SEATED },
      });
      expect(ordersService.applyDiscount).not.toHaveBeenCalled();
      expect(result.id).toBe('order-2');
    });

    it('DEPOSIT_ONLY: auto-applies the deposit discount once the order already has items (subtotalCents > 0)', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CONFIRMED,
        reservationType: ReservationType.DEPOSIT_ONLY,
        tableId,
        depositCents: 1000,
      });
      ordersService.create.mockResolvedValue({
        id: 'order-2',
        items: [{ priceCents: 5000, quantity: 1 }],
      });
      ordersService.applyDiscount.mockResolvedValue({
        id: 'order-2',
        discountCents: 1000,
      });

      const result = await service.seat(reservationId, {}, actorId);

      expect(ordersService.applyDiscount).toHaveBeenCalledWith(
        'order-2',
        {
          discountType: DiscountType.FIXED,
          discountCents: 1000,
          reason: 'Reservation deposit applied',
        },
        actorId,
      );
      expect(result.discountCents).toBe(1000);
    });

    it('DEPOSIT_ONLY: skips discount application when depositCents is 0, even if the order has items', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CONFIRMED,
        reservationType: ReservationType.DEPOSIT_ONLY,
        tableId,
        depositCents: 0,
      });
      ordersService.create.mockResolvedValue({
        id: 'order-2',
        items: [{ priceCents: 5000, quantity: 1 }],
      });

      await service.seat(reservationId, {}, actorId);

      expect(ordersService.applyDiscount).not.toHaveBeenCalled();
    });

    it('INFORMAL: requires a staff-chosen tableId in the request body', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CONFIRMED,
        reservationType: ReservationType.INFORMAL,
        tableId: null,
      });

      await expect(service.seat(reservationId, {}, actorId)).rejects.toThrow(
        BadRequestException,
      );
      expect(ordersService.create).not.toHaveBeenCalled();
    });

    it('INFORMAL: creates the order on the staff-chosen table and links it', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CONFIRMED,
        reservationType: ReservationType.INFORMAL,
        tableId: null,
      });
      ordersService.create.mockResolvedValue({ id: 'order-3', items: [] });

      const result = await service.seat(
        reservationId,
        { tableId: 'table-9' },
        actorId,
      );

      expect(ordersService.create).toHaveBeenCalledWith({
        type: OrderType.DINE_IN,
        tableId: 'table-9',
        items: [],
      });
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: reservationId },
        data: {
          tableId: 'table-9',
          orderId: 'order-3',
          status: ReservationStatus.SEATED,
        },
      });
      expect(ordersService.applyDiscount).not.toHaveBeenCalled();
      expect(result.id).toBe('order-3');
    });

    it('throws BadRequestException if the reservation is not CONFIRMED', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.PENDING,
        reservationType: ReservationType.INFORMAL,
      });

      await expect(
        service.seat(reservationId, { tableId: 'table-9' }, actorId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('noShow / cancel', () => {
    it('noShow releases a RESERVED table back to AVAILABLE and does not touch the deposit', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CONFIRMED,
        tableId,
        depositCents: 1000,
      });
      const txTableFindUnique = jest
        .fn()
        .mockResolvedValue({ id: tableId, status: TableStatus.RESERVED });
      const txTableUpdate = jest.fn().mockResolvedValue({});
      const txReservationUpdate = jest.fn().mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.NO_SHOW,
      });
      prisma.$transaction.mockImplementationOnce((cb) =>
        cb({
          table: { findUnique: txTableFindUnique, update: txTableUpdate },
          reservation: { update: txReservationUpdate },
        }),
      );

      const result = await service.noShow(reservationId);

      expect(txTableUpdate).toHaveBeenCalledWith({
        where: { id: tableId },
        data: { status: TableStatus.AVAILABLE },
      });
      expect(txReservationUpdate).toHaveBeenCalledWith({
        where: { id: reservationId },
        data: { status: ReservationStatus.NO_SHOW },
      });
      expect(result.status).toBe(ReservationStatus.NO_SHOW);
      // Deposit is left untouched — forfeited, not refunded/reapplied.
      expect(ordersService.applyDiscount).not.toHaveBeenCalled();
    });

    it('cancel releases the table only if it is currently RESERVED', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.PENDING,
        tableId,
        depositCents: 0,
      });
      const txTableFindUnique = jest
        .fn()
        .mockResolvedValue({ id: tableId, status: TableStatus.AVAILABLE });
      const txTableUpdate = jest.fn().mockResolvedValue({});
      const txReservationUpdate = jest.fn().mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.CANCELLED,
      });
      prisma.$transaction.mockImplementationOnce((cb) =>
        cb({
          table: { findUnique: txTableFindUnique, update: txTableUpdate },
          reservation: { update: txReservationUpdate },
        }),
      );

      await service.cancel(reservationId);

      // Table was still AVAILABLE (deposit never confirmed) — nothing to release.
      expect(txTableUpdate).not.toHaveBeenCalled();
    });

    it('rejects cancelling a reservation that is already SEATED/terminal', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: reservationId,
        status: ReservationStatus.SEATED,
        tableId,
      });

      await expect(service.cancel(reservationId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
