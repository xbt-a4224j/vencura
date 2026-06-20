import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NATIVE_ASSET, type Hex, type SendTransactionInput } from '@vencura/shared';
import { ChainService } from '@/infra/chain/chain.service';
import { PgAdvisoryLock } from '@/infra/lock/pg-advisory-lock';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { PolicyEngine } from '@/policy/policy.engine';
import { TransactionsService } from '@/transactions/transactions.service';

// CC-1: the policy daily-limit must hold under same-wallet concurrency. This exercises the
// REAL PgAdvisoryLock + REAL prisma against the local Postgres; only the chain broadcast is
// faked. Gated like pg-advisory-lock.int.spec.ts so CI / the normal `test` run stays DB-free.
// Run locally: RUN_DB_TESTS=1 pnpm --filter @vencura/api exec vitest run src/transactions/policy-race.int.spec.ts
describe.skipIf(!process.env.RUN_DB_TESTS)('TransactionsService policy daily-limit (DB race)', () => {
  const prisma = new PrismaService();
  const lock = new PgAdvisoryLock(prisma);
  const policy = new PolicyEngine(prisma);

  // Fresh fake address + incrementing nonce per test; broadcast just returns a unique hash.
  let nextNonce = 0;
  const chain = {
    getPendingNonce: async () => nextNonce++,
    prepareTransaction: async (b: Record<string, unknown>) => b,
    signTransaction: async () => '0xraw' as Hex,
    sendRawTransaction: async () => `0x${randomUUID().replace(/-/g, '')}` as Hex,
  } as unknown as ChainService;
  // Bypass private-key signing — the signer is irrelevant to the policy race.
  const signer = { signTransaction: async () => '0xraw' as Hex };

  let userId: string;
  let walletId: string;
  const address = '0x000000000000000000000000000000000000c0c1';
  const recipient = '0x000000000000000000000000000000000000d00d';

  // Wallet ownership is checked via WalletsService; stub it to the seeded wallet.
  const wallets = { findOwnedOrThrow: async () => ({ id: walletId, address }) } as never;

  const events = { record: async () => undefined, emit: () => undefined } as never;
  const service = () =>
    new TransactionsService(prisma, chain, policy, wallets, events, lock, signer as never);

  beforeEach(async () => {
    nextNonce = 0;
    const user = await prisma.user.create({
      data: { email: `race-${randomUUID()}@test.local`, passwordHash: 'x' },
    });
    userId = user.id;
    const wallet = await prisma.wallet.create({
      data: {
        userId,
        address,
        encryptedPrivateKey: 'x',
        encryptionIv: 'x',
        encryptionAuthTag: 'x',
      },
    });
    walletId = wallet.id;
    // dailyLimit = 1.0 ETH; two 0.6 ETH sends must not both succeed.
    await prisma.walletPolicy.create({
      data: { walletId, perTxLimit: null, dailyLimit: (10n ** 18n).toString() },
    });
  });

  afterEach(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  afterEach(async () => prisma.$disconnect());

  it('rejects the second of two concurrent same-wallet native sends over the daily cap', async () => {
    const svc = service();
    const dto: SendTransactionInput = {
      to: recipient,
      asset: NATIVE_ASSET,
      amount: (6n * 10n ** 17n).toString(), // 0.6 ETH
    };

    const results = await Promise.allSettled([
      svc.send(walletId, userId, { ...dto }),
      svc.send(walletId, userId, { ...dto }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/daily limit/i);

    // The committed native spend stays at or under the 1.0 ETH cap.
    const rows = await prisma.transaction.findMany({ where: { walletId, asset: NATIVE_ASSET } });
    const total = rows.reduce((sum, t) => sum + BigInt(t.amount), 0n);
    expect(rows).toHaveLength(1);
    expect(total).toBeLessThanOrEqual(10n ** 18n);
  });
});
