// class-transformer's @Transform (used internally by validateEnv for
// TAX_RATE) relies on the reflect-metadata polyfill, which the real app
// gets for free via @nestjs/core's own import side-effect at bootstrap.
// This spec exercises validateEnv() in isolation, so it must be loaded
// explicitly here.
import 'reflect-metadata';
import { validateEnv } from './env.validation';

// Minimal set of required env vars so we can isolate TAX_RATE behavior
// without unrelated required-field errors polluting the test.
function baseEnv(overrides: Record<string, string> = {}) {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    ...overrides,
  };
}

describe('validateEnv — TAX_RATE', () => {
  it('does not throw when TAX_RATE is missing and NODE_ENV is development', () => {
    expect(() =>
      validateEnv(baseEnv({ NODE_ENV: 'development' })),
    ).not.toThrow();
  });

  it('does not throw when TAX_RATE is missing and NODE_ENV is unset (defaults to dev-like)', () => {
    expect(() => validateEnv(baseEnv())).not.toThrow();
  });

  it('does not throw when TAX_RATE is missing and NODE_ENV is test', () => {
    expect(() => validateEnv(baseEnv({ NODE_ENV: 'test' }))).not.toThrow();
  });

  it('throws when TAX_RATE is missing and NODE_ENV is production', () => {
    expect(() => validateEnv(baseEnv({ NODE_ENV: 'production' }))).toThrow(
      /TAX_RATE is required when NODE_ENV=production/,
    );
  });

  it('does not throw when TAX_RATE is set and NODE_ENV is production', () => {
    expect(() =>
      validateEnv(baseEnv({ NODE_ENV: 'production', TAX_RATE: '0.18' })),
    ).not.toThrow();
  });

  it('accepts the Peru IGV rate (0.18) in production', () => {
    expect(() =>
      validateEnv(baseEnv({ NODE_ENV: 'production', TAX_RATE: '0.18' })),
    ).not.toThrow();
  });

  it('accepts the Spain IVA general rate (0.21) in production', () => {
    expect(() =>
      validateEnv(baseEnv({ NODE_ENV: 'production', TAX_RATE: '0.21' })),
    ).not.toThrow();
  });

  it('accepts boundary value 0', () => {
    expect(() =>
      validateEnv(baseEnv({ NODE_ENV: 'production', TAX_RATE: '0' })),
    ).not.toThrow();
  });

  it('accepts boundary value 1', () => {
    expect(() =>
      validateEnv(baseEnv({ NODE_ENV: 'production', TAX_RATE: '1' })),
    ).not.toThrow();
  });

  it('throws when TAX_RATE is above 1 (out of range), even outside production', () => {
    expect(() =>
      validateEnv(baseEnv({ NODE_ENV: 'development', TAX_RATE: '1.5' })),
    ).toThrow(/TAX_RATE must be between 0 and 1/);
  });

  it('throws when TAX_RATE is negative (out of range), even outside production', () => {
    expect(() =>
      validateEnv(baseEnv({ NODE_ENV: 'development', TAX_RATE: '-0.1' })),
    ).toThrow(/TAX_RATE must be between 0 and 1/);
  });

  it('throws when TAX_RATE is not a valid number', () => {
    expect(() =>
      validateEnv(baseEnv({ NODE_ENV: 'development', TAX_RATE: 'abc' })),
    ).toThrow(/TAX_RATE must be a valid number/);
  });

  it('throws when TAX_RATE is out of range in production too', () => {
    expect(() =>
      validateEnv(baseEnv({ NODE_ENV: 'production', TAX_RATE: '2' })),
    ).toThrow(/TAX_RATE must be between 0 and 1/);
  });
});
