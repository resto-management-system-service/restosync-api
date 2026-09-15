import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { enableCors } from '../src/common/cors';

// Regression test for the CORS preflight 404 bug: a real browser preflight
// (OPTIONS + Origin + Access-Control-Request-Method) for an allow-listed
// origin must be short-circuited by the `cors` middleware and return 204
// with CORS headers — never fall through to the router (which has no
// OPTIONS route and would 404). This bug was invisible to the existing e2e
// suite because none of the tests enabled CORS at all (see enableCors()
// below, which main.ts applies but the e2e harness did not).
describe('CORS preflight (e2e)', () => {
  let app: INestApplication;

  const ALLOWED_ORIGIN = 'http://localhost:3002';
  const OTHER_ALLOWED_ORIGIN = 'http://localhost:3000';
  const DISALLOWED_ORIGIN = 'http://localhost:9999';

  const originalCorsOrigins = process.env.CORS_ORIGINS;

  beforeAll(async () => {
    // A non-empty allow-list forces buildCorsOptions() to use its origin
    // matcher function (the production code path), regardless of NODE_ENV.
    process.env.CORS_ORIGINS = `${ALLOWED_ORIGIN},${OTHER_ALLOWED_ORIGIN}`;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    // This mirrors main.ts's bootstrap — and is the piece the pre-existing
    // e2e tests never did, which is why the bug shipped unnoticed.
    enableCors(app, app.get(ConfigService));

    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (originalCorsOrigins === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = originalCorsOrigins;
    }
  });

  function preflight(
    path: string,
    origin: string,
    requestMethod: string,
  ): request.Test {
    return request(app.getHttpServer())
      .options(path)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', requestMethod);
  }

  it('allows a browser preflight to POST /api/auth/login from an allow-listed origin', async () => {
    const res = await preflight(
      '/api/auth/login',
      ALLOWED_ORIGIN,
      'POST',
    ).expect(204);

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('allows a browser preflight to POST /api/auth/register from an allow-listed origin', async () => {
    const res = await preflight(
      '/api/auth/register',
      OTHER_ALLOWED_ORIGIN,
      'POST',
    ).expect(204);

    expect(res.headers['access-control-allow-origin']).toBe(
      OTHER_ALLOWED_ORIGIN,
    );
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not regress preflight for existing guarded GET routes (zones, tables)', async () => {
    for (const path of ['/api/zones', '/api/tables']) {
      const res = await preflight(path, ALLOWED_ORIGIN, 'GET').expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
      expect(res.headers['access-control-allow-methods']).toContain('GET');
    }
  });

  it('rejects a preflight from an origin that is NOT allow-listed (no CORS headers, non-2xx)', async () => {
    const res = await preflight(
      '/api/auth/login',
      DISALLOWED_ORIGIN,
      'POST',
    ).expect((res) => res.status >= 400 || res.status < 200);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
