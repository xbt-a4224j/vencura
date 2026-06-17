import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

// Composition root. Feature modules (auth, wallets, transactions, …) are imported
// here as they land — one module per box in the architecture diagram (CLAUDE.md §6.1).
@Module({ imports: [HealthModule] })
export class AppModule {}
