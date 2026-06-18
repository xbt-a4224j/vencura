import 'reflect-metadata';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { config as loadEnv } from 'dotenv';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

// One root .env for the monorepo. Anchor to this file's compiled location (not cwd)
// so it loads the same whether started via `nest start` or `node dist/main.js`.
loadEnv({ path: resolve(__dirname, '../../../.env') });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validate every request body/param against the zod schema on its DTO (nestjs-zod).
  // One schema is both the runtime validator and the OpenAPI definition (CLAUDE.md §3.1).
  app.useGlobalPipes(new ZodValidationPipe());

  // One consistent JSON error shape (RFC-7807-ish) for every uncaught error, with
  // chain-error mapping and no stack-trace/secret leakage (CLAUDE.md §10).
  app.useGlobalFilters(new AllExceptionsFilter());

  // Auto-generated OpenAPI + Swagger UI at /docs — demoability (CLAUDE.md §5) and
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
