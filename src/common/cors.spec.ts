import type { ConfigService } from '@nestjs/config';
import { buildCorsOptions } from './cors';

function makeConfig(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

type OriginFn = (
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean) => void,
) => void;

const allows = (fn: OriginFn, origin: string | undefined): boolean => {
  let result = false;
  fn(origin, (_err, allow) => {
    result = Boolean(allow);
  });
  return result;
};

describe('buildCorsOptions', () => {
  it('reflects any origin when unset and not production', () => {
    const opts = buildCorsOptions(
      makeConfig({ 'cors.origins': [], env: 'development' }),
    );
    expect(opts).toEqual({ origin: true, credentials: true });
  });

  it('blocks all when unset in production', () => {
    const opts = buildCorsOptions(
      makeConfig({ 'cors.origins': [], env: 'production' }),
    );
    expect(opts).toEqual({ origin: false });
  });

  it('allows exactly the configured origins', () => {
    const opts = buildCorsOptions(
      makeConfig({
        'cors.origins': ['https://app.example.com', 'http://localhost:3001'],
        env: 'production',
      }),
    );
    const fn = opts.origin as OriginFn;
    expect(allows(fn, 'https://app.example.com')).toBe(true);
    expect(allows(fn, 'http://localhost:3001')).toBe(true);
    expect(allows(fn, 'https://evil.example.com')).toBe(false);
    expect(opts.credentials).toBe(true);
  });

  it('always allows requests with no Origin header', () => {
    const opts = buildCorsOptions(
      makeConfig({
        'cors.origins': ['https://app.example.com'],
        env: 'production',
      }),
    );
    expect(allows(opts.origin as OriginFn, undefined)).toBe(true);
  });

  it('supports a single-label wildcard for preview deploys', () => {
    const opts = buildCorsOptions(
      makeConfig({
        'cors.origins': ['https://*.vercel.app'],
        env: 'production',
      }),
    );
    const fn = opts.origin as OriginFn;
    expect(allows(fn, 'https://web-abc123.vercel.app')).toBe(true);
    expect(allows(fn, 'https://web.vercel.app')).toBe(true);
    expect(allows(fn, 'https://a.b.vercel.app')).toBe(false);
    expect(allows(fn, 'https://vercel.app.evil.com')).toBe(false);
  });
});
