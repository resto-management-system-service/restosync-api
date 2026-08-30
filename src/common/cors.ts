import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Browser CORS policy for the API.
 *
 * `CORS_ORIGINS` is a comma-separated allow-list of exact origins. Each entry
 * may contain `*` as a single-label wildcard (e.g. `https://*.vercel.app`
 * matches preview deploys but not `https://a.b.vercel.app`).
 *
 * - list non-empty  -> only those origins (credentials allowed)
 * - list empty + non-production -> reflect any origin (local dev convenience)
 * - list empty + production      -> closed; a warning is logged at boot
 *
 * Requests with no `Origin` header (curl, server-to-server, health checks) are
 * always allowed — CORS only governs browsers.
 */
export function buildCorsOptions(config: ConfigService): CorsOptions {
  const origins = config.get<string[]>('cors.origins') ?? [];
  const isProd = config.get<string>('env') === 'production';

  if (origins.length === 0) {
    if (isProd) {
      // eslint-disable-next-line no-console
      console.warn(
        '[cors] CORS_ORIGINS is not set in production — browser clients will be blocked.',
      );
      return { origin: false };
    }
    return { origin: true, credentials: true };
  }

  const matchers = origins.map((pattern) => {
    if (!pattern.includes('*')) return (origin: string) => origin === pattern;
    // Escape regex metacharacters (not `*`), then turn each `*` into a
    // single-label wildcard.
    const rx = new RegExp(
      '^' +
        pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+') +
        '$',
    );
    return (origin: string) => rx.test(origin);
  });

  return {
    origin: (origin, callback) => {
      if (!origin || matchers.some((match) => match(origin))) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  };
}

/** Applies {@link buildCorsOptions} to the app. */
export function enableCors(app: INestApplication, config: ConfigService): void {
  app.enableCors(buildCorsOptions(config));
}
