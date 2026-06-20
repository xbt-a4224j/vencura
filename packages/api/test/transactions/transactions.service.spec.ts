import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { ChainService } from '@/infra/chain/chain.service';
import { PolicyEngine } from '@/policy/policy.engine';
import { WalletsService } from '@/wallets/wallets.service';
import { EventsService } from '@/infra/events/events.service';
import { LOCK } from '@/infra/lock/lock';
import { SIGNER } from '@/signer/signer';
import { TransactionsService } from '@/transactions/transactions.service';

// A real in-process serializing lock double — proves the service's nonce logic under serialization.
class SerialLock {
  private chain: Promise<unknown> = Promise.resolve();
  withWalletLock<T>(_id: string, fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(() => fn());
    this.chain = run.catch(() => undefined);
    return run;
  }
}

function makePrisma() {
  let nextNonce = 0;
  const txs: Array<{ idempotencyKey?: string | null; nonce: number }> = [];
  return {
    _txs: txs,
    wallet: {
      findFirst: vi.fn().mockResolvedValue({ id: 'w1', address: '0xabc' }),
      findUnique: vi.fn().mockImplementation(() => Promise.resolve({ nextNonce, address: '0xabc' })),
      update: vi.fn().mockImplementation(({ data }) => {
        nextNonce = data.nextNonce;
        return Promise.resolve({});
      }),
    },
    transaction: {
      findUnique: vi.fn().mockImplementation(({ where }) =>
        Promise.resolve(txs.find((t) => t.idempotencyKey === where.idempotencyKey) ?? null),
      ),
      create: vi.fn().mockImplementation(({ data }) => {
        txs.push(data);
        return Promise.resolve({ id: `tx${txs.length}`, ...data });
      }),
    },
  };
}

const chainMock = {
  getPendingNonce: vi.fn().mockResolvedValue(0),
  getNativeBalance: vi.fn().mockResolvedValue(10n ** 21n), // plenty
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
      { provide: WalletsService, useValue: { findOwnedOrThrow: prisma.wallet.findFirst } },
      { provide: EventsService, useValue: { record: vi.fn(), emit: vi.fn() } },
      { provide: LOCK, useValue: new SerialLock() },
      { provide: SIGNER, useValue: signerMock },
    ],
  }).compile();
  return moduleRef.get(TransactionsService);
}

describe('TransactionsService concurrency + idempotency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('N concurrent sends get unique, monotonic nonces', async () => {
    const prisma = makePrisma();
    const svc = await build(prisma);
    await Promise.all(
      Array.from({ length: 5 }, () => svc.send('w1', 'user-1', { to: '0xRecipient', asset: 'ETH', amount: '1' })),
    );
    const nonces = prisma._txs.map((t) => t.nonce).sort((a, b) => a - b);
    expect(nonces).toEqual([0, 1, 2, 3, 4]);
  });

  it('same idempotency key broadcasts once', async () => {
    const prisma = makePrisma();
    const svc = await build(prisma);
    await svc.send('w1', 'user-1', { to: '0xRecipient', asset: 'ETH', amount: '1' }, 'key-1');
    await svc.send('w1', 'user-1', { to: '0xRecipient', asset: 'ETH', amount: '1' }, 'key-1');
    expect(chainMock.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('CONCURRENT sends with the same idempotency key broadcast once (check is inside the lock)', async () => {
    const prisma = makePrisma();
    const svc = await build(prisma);
    await Promise.all([
      svc.send('w1', 'user-1', { to: '0xRecipient', asset: 'ETH', amount: '1' }, 'key-1'),
      svc.send('w1', 'user-1', { to: '0xRecipient', asset: 'ETH', amount: '1' }, 'key-1'),
    ]);
    expect(chainMock.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  // #32: a generic contract write routes raw calldata through the SAME locked send path.
  it('send with `data` builds the tx with that calldata (generic contract write)', async () => {
    const prisma = makePrisma();
    const svc = await build(prisma);
    await svc.send('w1', 'user-1', { to: '0xContract', asset: 'CALL', amount: '0', data: '0xdeadbeef' });
    const built = chainMock.prepareTransaction.mock.calls[0][0];
    expect(built.to).toBe('0xContract');
    expect(built.data).toBe('0xdeadbeef');
    expect(built.value).toBe(0n);
  });
});
