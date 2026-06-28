import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { swaggerConfig } from '../src/swagger.config';

// Boots the Nest app just enough to scan routes/decorators, then writes the
// OpenAPI spec to site/openapi.json for static hosting (Cloudflare Pages).
async function generate() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  const outDir = join(process.cwd(), 'site');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'openapi.json'), JSON.stringify(document, null, 2));

  await app.close();
  // eslint-disable-next-line no-console
  console.log('Wrote site/openapi.json');
  process.exit(0);
}

generate().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
