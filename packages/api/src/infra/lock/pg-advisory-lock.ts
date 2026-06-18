import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { advisoryKey } from './advisory-key';
import type { Lock } from './lock';

/** Transaction-scoped advisory lock: auto-releases on commit/rollback, so a crashed
 *  request can't strand it. Holds a DB connection for the duration of fn (incl. broadcast). */
@Injectable()
export class PgAdvisoryLock implements Lock {
  constructor(private readonly prisma: PrismaService) {}

  withWalletLock<T>(walletId: string, fn: () => Promise<T>): Promise<T> {
    const key = advisoryKey(walletId);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key})`;
        return fn();
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
  }
}
