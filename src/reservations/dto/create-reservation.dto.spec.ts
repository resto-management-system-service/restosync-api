import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ReservationType } from '@prisma/client';
import { CreateReservationDto } from './create-reservation.dto';

function baseDto(overrides: Record<string, unknown> = {}) {
  return plainToInstance(CreateReservationDto, {
    customerName: 'Jane Doe',
    customerPhone: '+51999999999',
    partySize: 4,
    reservedFor: '2026-07-18T14:00:00',
    reservationType: ReservationType.INFORMAL,
    ...overrides,
  });
}

describe('CreateReservationDto — reservedFor', () => {
  it('accepts a correctly-formatted naive local datetime string (with seconds)', async () => {
    const dto = baseDto({ reservedFor: '2026-07-18T14:00:00' });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'reservedFor')).toBeUndefined();
  });

  it('accepts a correctly-formatted naive local datetime string (without seconds)', async () => {
    const dto = baseDto({ reservedFor: '2026-07-18T14:00' });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'reservedFor')).toBeUndefined();
  });

  it('rejects a value with a Z (UTC) suffix', async () => {
    const dto = baseDto({ reservedFor: '2026-07-18T14:00:00Z' });
    const errors = await validate(dto);
    const err = errors.find((e) => e.property === 'reservedFor');
    expect(err).toBeDefined();
    expect(Object.values(err!.constraints || {}).join(' ')).toMatch(
      /do not include Z or an offset/,
    );
  });

  it('rejects a value with an explicit positive offset', async () => {
    const dto = baseDto({ reservedFor: '2026-07-18T14:00:00+05:00' });
    const errors = await validate(dto);
    const err = errors.find((e) => e.property === 'reservedFor');
    expect(err).toBeDefined();
  });

  it('rejects a value with an explicit negative offset', async () => {
    const dto = baseDto({ reservedFor: '2026-07-18T14:00:00-05:00' });
    const errors = await validate(dto);
    const err = errors.find((e) => e.property === 'reservedFor');
    expect(err).toBeDefined();
  });

  it('rejects a bare date with no time component', async () => {
    const dto = baseDto({ reservedFor: '2026-07-18' });
    const errors = await validate(dto);
    const err = errors.find((e) => e.property === 'reservedFor');
    expect(err).toBeDefined();
  });
});
