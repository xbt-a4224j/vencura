import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BalancesModule } from './balances/balances.module';
import { HealthModule } from './health/health.module';
import { ChainModule } from './infra/chain/chain.module';
import { LockModule } from './infra/lock/lock.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { PolicyModule } from './policy/policy.module';
import { SignerModule } from './signer/signer.module';
import { TransactionsModule } from './transactions/transactions.module';
import { WalletsModule } from './wallets/wallets.module';

// Composition root. Feature modules (auth, wallets, transactions, …) are imported
// here as they land — one module per box in the architecture diagram (CLAUDE.md §6.1).
@Module({
  imports: [
    // Global rate limit (per-IP) — abuse control for a shared, openly-registerable app.
    // 100 req / 60s default; auth routes tighten this via @Throttle (see auth.controller).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    ChainModule,
    LockModule,
    AuthModule,
    SignerModule,
    WalletsModule,
    BalancesModule,
    PolicyModule,
    TransactionsModule,
    AdminModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
