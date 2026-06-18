import { afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { PgAdvisoryLock } from './pg-advisory-lock';

// Real serialization of pg_advisory_xact_lock against a live Postgres.
// Gated off by default so CI / the normal `test` run stays green without a DB.
// Run locally: RUN_DB_TESTS=1 pnpm --filter @vencura/api exec vitest run src/infra/lock/pg-advisory-lock.int.spec.ts
describe.skipIf(!process.env.RUN_DB_TESTS)('PgAdvisoryLock (DB)', () => {
  const prisma = new PrismaService();
  const lock = new PgAdvisoryLock(prisma);

  afterAll(async () => prisma.$disconnect());

  it('serializes two overlapping withWalletLock calls on the same wallet', async () => {
    const events: string[] = [];
    const slow = lock.withWalletLock('w-int', async () => {
      events.push('a:start');
      await new Promise((r) => setTimeout(r, 100));
      events.push('a:end');
    });
    const fast = lock.withWalletLock('w-int', async () => {
      events.push('b:start');
      events.push('b:end');
    });
    await Promise.all([slow, fast]);
    // b must not start until a finished — no interleaving.
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });
});
