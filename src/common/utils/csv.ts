/**
 * Escapes a single CSV field per RFC 4180: any field containing a comma,
 * double quote, or newline is wrapped in double quotes, and internal
 * double quotes are escaped by doubling them.
 */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue =
    value instanceof Date ? value.toISOString() : String(value);

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Converts an array of flat row objects into a CSV string.
 *
 * - If `columns` is provided, it defines the header row and column order.
 * - If not provided, columns are inferred from the keys of the first row.
 * - Rows are joined with "\r\n" per RFC 4180; the final line has no
 *   trailing line break.
 * - An empty `rows` array produces just the header row when `columns`
 *   is given, or an empty string when columns cannot be inferred.
 */
export function toCsv(
  rows: Record<string, unknown>[],
  columns?: string[],
): string {
  const headers = columns ?? (rows.length > 0 ? Object.keys(rows[0]) : []);

  if (headers.length === 0) {
    return '';
  }

  const lines: string[] = [headers.map(escapeCsvField).join(',')];

  for (const row of rows) {
    lines.push(headers.map((key) => escapeCsvField(row[key])).join(','));
  }

  return lines.join('\r\n');
}
