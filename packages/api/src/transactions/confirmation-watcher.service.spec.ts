import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainService } from '../infra/chain/chain.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { BalancesService } from '../balances/balances.service';
import { ConfirmationWatcher } from './confirmation-watcher.service';

const prismaMock = {
  transaction: { findMany: vi.fn(), update: vi.fn() },
  wallet: { findUnique: vi.fn() },
};
const chainMock = { getBlockNumber: vi.fn(), getTransactionReceipt: vi.fn() };
const balancesMock = { refresh: vi.fn() };

const pendingTx = { id: 'tx1', walletId: 'w1', txHash: '0xhash' };

describe('ConfirmationWatcher', () => {
  let watcher: ConfirmationWatcher;
  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.transaction.findMany.mockResolvedValue([pendingTx]);
    prismaMock.transaction.update.mockResolvedValue({});
    prismaMock.wallet.findUnique.mockResolvedValue({ address: '0xabc' });
    balancesMock.refresh.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConfirmationWatcher,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ChainService, useValue: chainMock },
        { provide: BalancesService, useValue: balancesMock },
      ],
    }).compile();
    watcher = moduleRef.get(ConfirmationWatcher);
  });

  it('marks a successful receipt with enough confirmations as confirmed + refreshes balance', async () => {
    chainMock.getBlockNumber.mockResolvedValue(11n);
    chainMock.getTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 10n });
    await watcher.reconcile();
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx1' },
      data: { status: 'confirmed' },
    });
    expect(balancesMock.refresh).toHaveBeenCalledWith('w1', '0xabc');
  });

  it('marks a reverted receipt as failed', async () => {
    chainMock.getBlockNumber.mockResolvedValue(11n);
    chainMock.getTransactionReceipt.mockResolvedValue({ status: 'reverted', blockNumber: 10n });
    await watcher.reconcile();
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx1' },
      data: { status: 'failed' },
    });
  });

  it('does not update when there are too few confirmations', async () => {
    chainMock.getBlockNumber.mockResolvedValue(10n);
    chainMock.getTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 10n });
    await watcher.reconcile();
    expect(prismaMock.transaction.update).not.toHaveBeenCalled();
    expect(balancesMock.refresh).not.toHaveBeenCalled();
  });

  it('does not update when the receipt is null (not mined)', async () => {
    chainMock.getBlockNumber.mockResolvedValue(11n);
    chainMock.getTransactionReceipt.mockResolvedValue(null);
    await watcher.reconcile();
    expect(prismaMock.transaction.update).not.toHaveBeenCalled();
  });
});
