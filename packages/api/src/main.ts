import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Auto-generated OpenAPI + Swagger UI at /docs — demoability (CLAUDE.md §5) and
  // the source for the generated SDK (T-025).
  const config = new DocumentBuilder()
    .setTitle('VenCura API')
    .setDescription('Custodial Ethereum wallet platform — Sepolia testnet.')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`VenCura API listening on http://localhost:${port} (docs at /docs)`, 'Bootstrap');
}

void bootstrap();
