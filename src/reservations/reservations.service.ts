import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DiscountType,
  OrderType,
  Prisma,
  ReservationStatus,
  ReservationType,
  TableStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from '../orders/dto/create-order.dto';
import { OrdersService } from '../orders/orders.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ListReservationsQueryDto } from './dto/list-reservations-query.dto';
import { SeatReservationDto } from './dto/seat-reservation.dto';

// Only PENDING/CONFIRMED reservations can still be confirmed, seated,
// cancelled, or marked as a no-show — anything terminal (SEATED, NO_SHOW,
// CANCELLED) is final.
const TERMINABLE_STATUSES: ReservationStatus[] = [
  ReservationStatus.PENDING,
  ReservationStatus.CONFIRMED,
];

// Reservations with more money already committed (a pre-order or a
// deposit) reasonably get more patience before staff decide on a
// no-show. Purely a DEFAULT — staff can always override with any value
// at creation time, with no min/max restriction beyond the DTO's base
// validation.
const DEFAULT_TOLERANCE_BY_TYPE: Record<ReservationType, number> = {
  [ReservationType.INFORMAL]: 10,
  [ReservationType.DEPOSIT_ONLY]: 20,
  [ReservationType.WITH_PREORDER]: 30,
};

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateReservationDto, actorId: string) {
    if (dto.reservationType === ReservationType.INFORMAL) {
      if (dto.tableId || dto.items) {
        throw new BadRequestException(
          'tableId and items are not allowed for INFORMAL reservations',
        );
      }
      return this.prisma.reservation.create({
        data: this.baseReservationData(dto, actorId),
      });
    }

    // WITH_PREORDER and DEPOSIT_ONLY both commit a specific table once the
    // deposit is confirmed later — but the table stays AVAILABLE right now.
    const table = await this.prisma.table.findUnique({
      where: { id: dto.tableId },
    });
    if (!table) {
      throw new NotFoundException('Table not found');
    }
    if (table.status !== TableStatus.AVAILABLE) {
      throw new BadRequestException(
        `Table is ${table.status} and cannot be reserved`,
      );
    }

    let orderId: string | null = null;
    let depositCents: number;

    if (dto.reservationType === ReservationType.WITH_PREORDER) {
      // Reuse OrdersService.create() entirely (price-snapshot logic lives
      // there) — pass type TAKEAWAY so no table gets committed yet; the
      // Reservation's own `tableId` tracks the desired table separately.
      const order = await this.ordersService.create({
        type: OrderType.TAKEAWAY,
        items: dto.items,
      } as CreateOrderDto);
      orderId = order.id;
      depositCents = Math.floor(order.totalCents / 2);
    } else {
      if (dto.items) {
        throw new BadRequestException(
          'items are not allowed for DEPOSIT_ONLY reservations',
        );
      }
      depositCents =
        this.config.get<number>('reservations.depositCents') ?? 1000;
    }

    return this.prisma.reservation.create({
      data: {
        ...this.baseReservationData(dto, actorId),
        tableId: dto.tableId,
        orderId,
        depositCents,
      },
    });
  }

  async findAll(query: ListReservationsQueryDto) {
    const where: Prisma.ReservationWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.date) {
      const start = new Date(`${query.date}T00:00:00.000Z`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      where.reservedFor = { gte: start, lt: end };
    }

    return this.prisma.reservation.findMany({
      where,
      skip: query.skip,
      take: query.limit,
      orderBy: { reservedFor: 'asc' },
    });
  }

  async findOne(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
    });
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    return reservation;
  }

  async confirm(id: string, actorId: string) {
    const reservation = await this.findOne(id);
    if (reservation.status !== ReservationStatus.PENDING) {
      throw new BadRequestException(
        `Cannot confirm a reservation with status ${reservation.status}`,
      );
    }

    if (reservation.reservationType === ReservationType.INFORMAL) {
      return this.prisma.reservation.update({
        where: { id },
        data: { status: ReservationStatus.CONFIRMED },
      });
    }

    // WITH_PREORDER / DEPOSIT_ONLY: the deposit has just been confirmed
    // received by staff — this is the moment the table is actually
    // committed (AVAILABLE -> RESERVED).
    return this.prisma.$transaction(async (tx) => {
      if (reservation.tableId) {
        await tx.table.update({
          where: { id: reservation.tableId },
          data: { status: TableStatus.RESERVED },
        });
      }
      return tx.reservation.update({
        where: { id },
        data: {
          status: ReservationStatus.CONFIRMED,
          depositConfirmedBy: actorId,
          depositConfirmedAt: new Date(),
        },
      });
    });
  }

  async seat(id: string, dto: SeatReservationDto, actorId: string) {
    const reservation = await this.findOne(id);
    if (reservation.status !== ReservationStatus.CONFIRMED) {
      throw new BadRequestException(
        `Reservation must be CONFIRMED before seating (current: ${reservation.status})`,
      );
    }

    switch (reservation.reservationType) {
      case ReservationType.WITH_PREORDER:
        return this.seatWithPreorder(reservation);
      case ReservationType.DEPOSIT_ONLY:
        return this.seatDepositOnly(reservation, actorId);
      case ReservationType.INFORMAL:
        return this.seatInformal(reservation, dto);
      default:
        throw new BadRequestException('Unknown reservation type');
    }
  }

  private async seatWithPreorder(reservation: {
    id: string;
    orderId: string | null;
    tableId: string | null;
  }) {
    if (!reservation.orderId || !reservation.tableId) {
      throw new BadRequestException(
        'Reservation is missing its pre-order or table',
      );
    }

    const [, , order] = await this.prisma.$transaction([
      this.prisma.table.update({
        where: { id: reservation.tableId },
        data: { status: TableStatus.OCCUPIED },
      }),
      this.prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: ReservationStatus.SEATED },
      }),
      this.prisma.order.update({
        where: { id: reservation.orderId },
        data: { tableId: reservation.tableId },
        include: { items: true },
      }),
    ]);

    return order;
  }

  private async seatDepositOnly(
    reservation: {
      id: string;
      tableId: string | null;
      depositCents: number;
    },
    actorId: string,
  ) {
    if (!reservation.tableId) {
      throw new BadRequestException('Reservation has no table assigned');
    }

    // Reuses OrdersService.create()'s existing table-occupied-check logic
    // (throws if the table went away, sets it OCCUPIED in one transaction).
    const order = await this.ordersService.create({
      type: OrderType.DINE_IN,
      tableId: reservation.tableId,
      items: [],
    } as CreateOrderDto);

    await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { orderId: order.id, status: ReservationStatus.SEATED },
    });

    // The order is created empty (DEPOSIT_ONLY has no pre-order), so its
    // subtotal is $0 right now. OrdersService.applyDiscount() enforces a
    // shared, non-negotiable safety rule ("discount cannot exceed
    // subtotal") used by every consumer of discounts across the app — we
    // must not weaken it just for this flow. So the deposit is only
    // auto-applied once the order actually has items (subtotalCents > 0);
    // otherwise it isn't reflected as a discount yet. Staff can apply it
    // manually later via the existing PATCH /orders/:id/discount endpoint
    // (using this reservation's depositCents) once food has been ordered.
    const subtotalCents = (order.items ?? []).reduce(
      (sum: number, item: { priceCents: number; quantity: number }) =>
        sum + item.priceCents * item.quantity,
      0,
    );

    if (reservation.depositCents > 0 && subtotalCents > 0) {
      // Reuses the existing discount mechanism (validation + audit trail)
      // rather than a bespoke deposit-application code path.
      return this.ordersService.applyDiscount(
        order.id,
        {
          discountType: DiscountType.FIXED,
          discountCents: reservation.depositCents,
          reason: 'Reservation deposit applied',
        },
        actorId,
      );
    }

    return order;
  }

  private async seatInformal(
    reservation: { id: string },
    dto: SeatReservationDto,
  ) {
    if (!dto.tableId) {
      throw new BadRequestException(
        'tableId is required to seat an INFORMAL reservation',
      );
    }

    const order = await this.ordersService.create({
      type: OrderType.DINE_IN,
      tableId: dto.tableId,
      items: [],
    } as CreateOrderDto);

    await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        tableId: dto.tableId,
        orderId: order.id,
        status: ReservationStatus.SEATED,
      },
    });

    return order;
  }

  async noShow(id: string) {
    return this.terminate(id, ReservationStatus.NO_SHOW);
  }

  async cancel(id: string) {
    return this.terminate(id, ReservationStatus.CANCELLED);
  }

  // Deposits (if any) are intentionally NOT refunded or reapplied here —
  // they're simply forfeited, left as a historical record on the row.
  private async terminate(id: string, nextStatus: ReservationStatus) {
    const reservation = await this.findOne(id);
    if (!TERMINABLE_STATUSES.includes(reservation.status)) {
      throw new BadRequestException(
        `Cannot mark reservation as ${nextStatus} from status ${reservation.status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (reservation.tableId) {
        const table = await tx.table.findUnique({
          where: { id: reservation.tableId },
        });
        if (table?.status === TableStatus.RESERVED) {
          await tx.table.update({
            where: { id: reservation.tableId },
            data: { status: TableStatus.AVAILABLE },
          });
        }
      }
      return tx.reservation.update({
        where: { id },
        data: { status: nextStatus },
      });
    });
  }

  private baseReservationData(
    dto: CreateReservationDto,
    actorId: string,
  ): Prisma.ReservationUncheckedCreateInput {
    return {
      customerName: dto.customerName,
      customerPhone: dto.customerPhone,
      customerEmail: dto.customerEmail,
      partySize: dto.partySize,
      reservedFor: new Date(dto.reservedFor),
      toleranceMinutes:
        dto.toleranceMinutes ?? DEFAULT_TOLERANCE_BY_TYPE[dto.reservationType],
      allergies: dto.allergies,
      specialOccasion: dto.specialOccasion,
      reservationType: dto.reservationType,
      status: ReservationStatus.PENDING,
      createdBy: actorId,
    };
  }
}
