import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { BalancesModule } from './balances/balances.module';
import { HealthModule } from './health/health.module';
import { ChainModule } from './infra/chain/chain.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { SignerModule } from './signer/signer.module';
import { WalletsModule } from './wallets/wallets.module';

// Composition root. Feature modules (auth, wallets, transactions, …) are imported
// here as they land — one module per box in the architecture diagram (CLAUDE.md §6.1).
@Module({
  imports: [
    PrismaModule,
    ChainModule,
    AuthModule,
    SignerModule,
    WalletsModule,
    BalancesModule,
    HealthModule,
  ],
})
export class AppModule {}
