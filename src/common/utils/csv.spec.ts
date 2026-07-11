import { toCsv } from './csv';

describe('toCsv', () => {
  it('converts a simple array of rows, inferring columns from the first row', () => {
    const rows = [
      { name: 'Burger', quantitySold: 2, revenueCents: 2400 },
      { name: 'Fries', quantitySold: 1, revenueCents: 800 },
    ];

    const csv = toCsv(rows);

    expect(csv).toBe(
      ['name,quantitySold,revenueCents', 'Burger,2,2400', 'Fries,1,800'].join(
        '\r\n',
      ),
    );
  });

  it('uses explicit columns for header row and ordering', () => {
    const rows = [{ b: 2, a: 1 }];

    const csv = toCsv(rows, ['a', 'b']);

    expect(csv).toBe(['a,b', '1,2'].join('\r\n'));
  });

  it('only includes explicit columns even if rows have extra keys', () => {
    const rows = [{ a: 1, b: 2, c: 3 }];

    const csv = toCsv(rows, ['a', 'c']);

    expect(csv).toBe(['a,c', '1,3'].join('\r\n'));
  });

  it('escapes fields containing commas by wrapping them in double quotes', () => {
    const rows = [{ name: 'Burger, deluxe', amountCents: 100 }];

    const csv = toCsv(rows);

    expect(csv).toBe(['name,amountCents', '"Burger, deluxe",100'].join('\r\n'));
  });

  it('escapes fields containing double quotes by doubling them', () => {
    const rows = [{ name: 'The "Best" Burger' }];

    const csv = toCsv(rows);

    expect(csv).toBe(['name', '"The ""Best"" Burger"'].join('\r\n'));
  });

  it('escapes fields containing newlines by wrapping them in double quotes', () => {
    const rows = [{ note: 'Line one\nLine two' }];

    const csv = toCsv(rows);

    expect(csv).toBe(['note', '"Line one\nLine two"'].join('\r\n'));
  });

  it('treats null and undefined values as empty strings', () => {
    const rows = [{ a: null, b: undefined, c: 0 }];

    const csv = toCsv(rows);

    expect(csv).toBe(['a,b,c', ',,0'].join('\r\n'));
  });

  it('returns just the header row when rows is empty but columns are given', () => {
    const csv = toCsv([], ['a', 'b']);

    expect(csv).toBe('a,b');
  });

  it('returns an empty string when rows is empty and columns cannot be inferred', () => {
    const csv = toCsv([]);

    expect(csv).toBe('');
  });
});
