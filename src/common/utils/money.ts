export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function centsToFloat(cents: number): number {
  return cents / 100;
}

export function roundCents(cents: number): number {
  return Math.round(cents);
}
