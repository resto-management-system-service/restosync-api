export const DEFAULT_TIMEZONE = 'America/Lima';

function getTimezoneOffsetMinutes(dateStr: string, timezone: string): number {
  const utcMidnight = new Date(dateStr + 'T00:00:00Z');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(utcMidnight);

  const offsetStr = parts.find((p) => p.type === 'timeZoneName')?.value;
  if (!offsetStr) return 0;

  const match = offsetStr.match(/GMT([+-]\d{2}):(\d{2})/);
  if (!match) return 0;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return hours * 60 + (hours >= 0 ? minutes : -minutes);
}

export function dayRangeInTimezone(
  date: string,
  timezone: string = DEFAULT_TIMEZONE,
): { gte: Date; lt: Date } {
  const offsetMinutes = getTimezoneOffsetMinutes(date, timezone);

  const utcMidnight = Date.UTC(
    parseInt(date.slice(0, 4)),
    parseInt(date.slice(5, 7)) - 1,
    parseInt(date.slice(8, 10)),
  );

  const gte = new Date(utcMidnight - offsetMinutes * 60 * 1000);
  const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000);

  return { gte, lt };
}
