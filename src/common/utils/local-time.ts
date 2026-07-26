// Scoped fix for Reservation.reservedFor: converts between a "naive"
// local wall-clock string (no Z/offset suffix — see
// CreateReservationDto.reservedFor) and the UTC `Date` actually stored in
// Postgres, using only Node's built-in Intl API (no new npm dependency).
//
// Deliberately separate from src/common/utils/timezone.ts (an earlier,
// unrelated, currently-dormant effort) — do not merge these.

/**
 * Converts a naive local datetime string (e.g. "2026-07-18T14:00:00", no
 * timezone suffix) into the corresponding UTC `Date`, interpreting it as
 * wall-clock time in `timeZone`.
 *
 * Technique: first parse the naive string as if it were already UTC (a
 * "guess"). Then ask Intl what offset `timeZone` actually has at that
 * instant, and correct the guess by that offset. This converges in one
 * step for all real-world IANA timezones (including DST transitions),
 * since offsets change at most once around any given instant and the
 * guess is already within the same day.
 */
export function localToUtc(localDateTimeStr: string, timeZone: string): Date {
  const guessUtc = new Date(`${localDateTimeStr}Z`);
  const offsetMinutes = getOffsetMinutesAt(guessUtc, timeZone);
  return new Date(guessUtc.getTime() - offsetMinutes * 60 * 1000);
}

/**
 * Formats a UTC `Date` (as stored in the DB) back into a naive local
 * datetime string (no timezone suffix), representing wall-clock time in
 * `timeZone`. Purely a display convenience — never persisted.
 */
export function utcToLocalDisplay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '00';

  // Intl can format hour '24' at midnight for hour12: false in some
  // environments — normalize to '00'.
  const hour = get('hour') === '24' ? '00' : get('hour');

  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get(
    'minute',
  )}:${get('second')}`;
}

// Returns the UTC offset (in minutes, positive = ahead of UTC) that
// `timeZone` observes at the given instant.
function getOffsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(instant);

  const offsetStr = parts.find((p) => p.type === 'timeZoneName')?.value;
  if (!offsetStr) return 0;

  const match = offsetStr.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = parseInt(match[2], 10);
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  return sign * (hours * 60 + minutes);
}
