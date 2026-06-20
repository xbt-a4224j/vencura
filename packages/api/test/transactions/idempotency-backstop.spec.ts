import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainService } from '@/infra/chain/chain.service';
import { EventsService } from '@/infra/events/events.service';
import { LOCK } from '@/infra/lock/lock';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { PolicyEngine } from '@/policy/policy.engine';
import { SIGNER } from '@/signer/signer';
import { WalletsService } from '@/wallets/wallets.service';
import { TransactionsService } from '@/transactions/transactions.service';

// CC-3: the @unique idempotencyKey constraint is the documented "backstop", but create()
// had no try/catch — a Prisma P2002 fell through to a generic 500. The backstop must instead
// re-read the winning row and return it idempotently. This forces the P2002 path directly.
const passThroughLock = { withWalletLock: <T>(_id: string, fn: () => Promise<T>) => fn() };

const existing = { id: 'tx-existing', txHash: '0xexisting', status: 'pending', nonce: 0 };

function makePrisma() {
  return {
    wallet: {
      findUnique: vi.fn().mockResolvedValue({ nextNonce: 0, address: '0xabc' }),
      update: vi.fn().mockResolvedValue({}),
    },
    transaction: {
      // First lookup (in-lock dedup) misses; the re-read after P2002 returns the winner.
      findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(existing),
      create: vi.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      ),
    },
  };
}

const chainMock = {
  getPendingNonce: vi.fn().mockResolvedValue(0),
  prepareTransaction: vi.fn().mockResolvedValue({ to: '0xRecipient', value: 1n }),
  sendRawTransaction: vi.fn().mockResolvedValue('0xhash'),
};
const signerMock = { signTransaction: vi.fn().mockResolvedValue('0xraw') };
const policyMock = { assertAllowed: vi.fn().mockResolvedValue(undefined) };

async function build(prisma: ReturnType<typeof makePrisma>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      TransactionsService,
      { provide: PrismaService, useValue: prisma },
      { provide: ChainService, useValue: chainMock },
      { provide: PolicyEngine, useValue: policyMock },
      { provide: WalletsService, useValue: { findOwnedOrThrow: vi.fn().mockResolvedValue({ id: 'w1', address: '0xabc' }) } },
      { provide: EventsService, useValue: { record: vi.fn(), emit: vi.fn() } },
      { provide: LOCK, useValue: passThroughLock },
      { provide: SIGNER, useValue: signerMock },
    ],
  }).compile();
  return moduleRef.get(TransactionsService);
}

describe('TransactionsService idempotency P2002 backstop', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the existing row (not a 500) when create() hits a unique-key conflict', async () => {
    const prisma = makePrisma();
    const svc = await build(prisma);
    const result = await svc.send('w1', 'user-1', { to: '0xRecipient', asset: 'ETH', amount: '1' }, 'dup-key');
    expect(result).toEqual({ id: 'tx-existing', txHash: '0xexisting', status: 'pending', nonce: 0 });
    // The re-read happened after the conflict.
    expect(prisma.transaction.findUnique).toHaveBeenLastCalledWith({ where: { idempotencyKey: 'dup-key' } });
  });
});
