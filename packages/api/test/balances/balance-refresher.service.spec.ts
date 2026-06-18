import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { BalancesService } from '@/balances/balances.service';
import { BalanceRefresher } from '@/balances/balance-refresher.service';

const prismaMock = { wallet: { findMany: vi.fn() } };
const balancesMock = { refresh: vi.fn().mockResolvedValue(undefined) };

describe('BalanceRefresher', () => {
  let refresher: BalanceRefresher;
  beforeEach(async () => {
    vi.clearAllMocks();
    balancesMock.refresh.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        BalanceRefresher,
        { provide: PrismaService, useValue: prismaMock },
        { provide: BalancesService, useValue: balancesMock },
      ],
    }).compile();
    refresher = moduleRef.get(BalanceRefresher);
  });

  it('refreshes every known wallet on a tick', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([
      { id: 'w1', address: '0xa' },
      { id: 'w2', address: '0xb' },
    ]);
    await refresher.refreshAll();
    expect(balancesMock.refresh).toHaveBeenCalledTimes(2);
    expect(balancesMock.refresh).toHaveBeenCalledWith('w1', '0xa');
  });

  it('keeps going if one wallet fails', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([
      { id: 'w1', address: '0xa' },
      { id: 'w2', address: '0xb' },
    ]);
    balancesMock.refresh.mockRejectedValueOnce(new Error('rpc down'));
    await expect(refresher.refreshAll()).resolves.toBeUndefined();
    expect(balancesMock.refresh).toHaveBeenCalledTimes(2);
  });
});
