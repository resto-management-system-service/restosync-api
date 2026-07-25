import { localToUtc, utcToLocalDisplay } from './local-time';

describe('localToUtc', () => {
  it('converts a known America/Lima local time to the correct UTC value (fixed UTC-5, no DST)', () => {
    const result = localToUtc('2026-07-18T14:00:00', 'America/Lima');
    expect(result.toISOString()).toBe('2026-07-18T19:00:00.000Z');
  });

  it('works correctly for a DST timezone (America/New_York) in summer (EDT, UTC-4)', () => {
    // July is EDT (UTC-4) in New York.
    const result = localToUtc('2026-07-18T14:00:00', 'America/New_York');
    expect(result.toISOString()).toBe('2026-07-18T18:00:00.000Z');
  });

  it('works correctly for a DST timezone (America/New_York) in winter (EST, UTC-5)', () => {
    // January is EST (UTC-5) in New York.
    const result = localToUtc('2026-01-18T14:00:00', 'America/New_York');
    expect(result.toISOString()).toBe('2026-01-18T19:00:00.000Z');
  });

  it('accepts a datetime string without seconds', () => {
    const result = localToUtc('2026-07-18T14:00', 'America/Lima');
    expect(result.toISOString()).toBe('2026-07-18T19:00:00.000Z');
  });
});

describe('utcToLocalDisplay', () => {
  it('formats a stored UTC Date back into America/Lima local wall-clock time', () => {
    const utcDate = new Date('2026-07-18T19:00:00.000Z');
    expect(utcToLocalDisplay(utcDate, 'America/Lima')).toBe(
      '2026-07-18T14:00:00',
    );
  });

  it('is the inverse of localToUtc for a DST timezone', () => {
    const local = '2026-07-18T14:00:00';
    const utc = localToUtc(local, 'America/New_York');
    expect(utcToLocalDisplay(utc, 'America/New_York')).toBe(local);
  });
});
