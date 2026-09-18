/**
 * Normalizes a name for uniqueness comparison: trims leading/trailing
 * whitespace, collapses runs of internal whitespace to a single space, and
 * lowercases the result.
 *
 * "Mesa 1", " mesa   1 ", and "MESA 1" all normalize to "mesa 1" and are
 * therefore treated as the same name, while "mesa1" (no space) normalizes to
 * "mesa1" and remains a genuinely different name.
 */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
