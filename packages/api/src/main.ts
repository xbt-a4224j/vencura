import 'reflect-metadata';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { config as loadEnv } from 'dotenv';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { httpLogging } from './common/http-logging.middleware';
import { EventsService } from './infra/events/events.service';
import { RingLogger } from './infra/events/ring-logger';

// One root .env for the monorepo. Anchor to this file's compiled location (not cwd)
// so it loads the same whether started via `nest start` or `node dist/main.js`.
loadEnv({ path: resolve(__dirname, '../../../.env') });

async function bootstrap() {
  // bufferLogs holds early logs until we install the logger below, so nothing is lost.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Tee the NestJS logger into the EventsService ring buffer so the in-app "Live system log" shows
  // the operational narration (nonce acquired, tx broadcast, confirmations…) the services already
  // emit — no new call sites. Logged lines never contain key material/secrets.
  app.useLogger(new RingLogger(app.get(EventsService)));

  // Validate every request body/param against the zod schema on its DTO (nestjs-zod).
  // One schema is both the runtime validator and the OpenAPI definition.
  app.useGlobalPipes(new ZodValidationPipe());

  // One consistent JSON error shape (RFC-7807-ish) for every uncaught error, with
  // chain-error mapping and no stack-trace/secret leakage.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Log one line per API call (method/path/status/duration) — the per-request narration the live
  // system log and demo rely on. Outermost middleware (before guards) so every request is logged,
  // including 401/403/404 that never reach a handler. Path/method/status only; never request bodies.
  app.use(httpLogging);

  // Auto-generated OpenAPI + Swagger UI at /docs — demoability and
  // the source for the generated SDK (T-025). cleanupOpenApiDoc finalizes the zod-derived
  // schemas in the document (nestjs-zod v5).
  const config = new DocumentBuilder()
    .setTitle('VenCura API')
    .setDescription('Custodial Ethereum wallet platform — Sepolia testnet.')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`VenCura API listening on http://localhost:${port} (docs at /docs)`, 'Bootstrap');
}

void bootstrap();
