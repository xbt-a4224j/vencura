import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainService } from '@/infra/chain/chain.service';
import { LOCK } from '@/infra/lock/lock';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { SIGNER } from '@/signer/signer';
import { ProvisioningService } from '@/wallets/provisioning.service';
import { WalletsService } from '@/wallets/wallets.service';

// A real in-process serializing lock double (mirrors transactions.service.spec.ts).
class SerialLock {
  private chain: Promise<unknown> = Promise.resolve();
  withWalletLock<T>(_id: string, fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(() => fn());
    this.chain = run.catch(() => undefined);
    return run;
  }
}

const chainMock = {
  getPendingNonce: vi.fn().mockResolvedValue(0),
  prepareTransaction: vi.fn().mockResolvedValue({ to: '0xto', value: 1n }),
  sendRawTransaction: vi.fn().mockResolvedValue('0xhash'),
};
const signerMock = { signTransaction: vi.fn().mockResolvedValue('0xraw') };

function build(prisma: unknown, wallets: unknown) {
  return Test.createTestingModule({
    providers: [
      ProvisioningService,
      { provide: PrismaService, useValue: prisma },
      { provide: WalletsService, useValue: wallets },
      { provide: ChainService, useValue: chainMock },
      { provide: LOCK, useValue: new SerialLock() },
      { provide: SIGNER, useValue: signerMock },
    ],
  })
    .compile()
    .then((m) => m.get(ProvisioningService));
}

describe('ProvisioningService.provision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DEMO_FUNDED_PRIVKEY;
  });

  it('is idempotent: a second call returns the same wallet and does NOT fund again', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'w-new', address: '0xnew' });
    // first findFirst (user has no wallet) → null; afterward the wallet exists.
    let userWallet: { id: string; address: string } | null = null;
    const prisma = {
      wallet: {
        findFirst: vi.fn().mockImplementation(({ where }: { where: { userId?: string; address?: string } }) => {
          if (where.userId === 'user-1') return Promise.resolve(userWallet); // caller's wallet
          if (where.userId === 'demo-user') return Promise.resolve({ id: 'master', address: '0xmaster' });
          return Promise.resolve(null);
        }),
        findUnique: vi.fn().mockResolvedValue({ nextNonce: 0, address: '0xmaster' }),
        update: vi.fn().mockResolvedValue({}),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'demo-user' }) },
      transaction: { create: vi.fn().mockResolvedValue({}) },
    };
    const wallets = {
      create: vi.fn().mockImplementation(() => {
        userWallet = { id: 'w-new', address: '0xnew' };
        return create();
      }),
    };
    const svc = await build(prisma, wallets);

    const first = await svc.provision('user-1');
    const second = await svc.provision('user-1');

    expect(first).toEqual({ id: 'w-new', address: '0xnew' });
    expect(second).toEqual({ id: 'w-new', address: '0xnew' });
    expect(wallets.create).toHaveBeenCalledTimes(1);
    expect(chainMock.sendRawTransaction).toHaveBeenCalledTimes(1); // funded exactly once
  });
});
