import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DateQueryDto } from './date-query.dto';

describe('DateQueryDto', () => {
  it('should validate with only date (limit optional)', async () => {
    const dto = plainToInstance(DateQueryDto, { date: '2026-07-08' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should validate with a valid limit', async () => {
    const dto = plainToInstance(DateQueryDto, { date: '2026-07-08', limit: 5 });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.limit).toBe(5);
  });

  it('should reject a limit below 1', async () => {
    const dto = plainToInstance(DateQueryDto, { date: '2026-07-08', limit: 0 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject an invalid date format', async () => {
    const dto = plainToInstance(DateQueryDto, { date: 'not-a-date' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
