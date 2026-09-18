import { normalizeName } from './normalize-name';

describe('normalizeName', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeName('  Mesa 1  ')).toBe('mesa 1');
  });

  it('collapses multiple internal spaces to a single space', () => {
    expect(normalizeName(' mesa   1 ')).toBe('mesa 1');
  });

  it('lowercases the name', () => {
    expect(normalizeName('MESA 1')).toBe('mesa 1');
  });

  it('treats whitespace/casing variations as the same name', () => {
    expect(normalizeName('Mesa 1')).toBe(normalizeName(' mesa   1 '));
    expect(normalizeName('Mesa 1')).toBe(normalizeName('MESA 1'));
  });

  it('keeps a no-space variant distinct from a spaced variant', () => {
    expect(normalizeName('mesa1')).not.toBe(normalizeName('Mesa 1'));
  });

  it('does not remove all spaces, only collapses them', () => {
    expect(normalizeName('Mesa  1')).toBe('mesa 1');
    expect(normalizeName('Mesa1')).toBe('mesa1');
  });
});
