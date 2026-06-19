import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { BalancesService } from '@/balances/balances.service';
import { PollingStateService } from '@/infra/chain/polling-state.service';
import { BalanceRefresher } from '@/balances/balance-refresher.service';

const prismaMock = { wallet: { findMany: vi.fn() } };
const balancesMock = { refresh: vi.fn().mockResolvedValue(undefined) };
const pollingMock = { isLive: vi.fn().mockReturnValue(true), setLive: vi.fn() };

describe('BalanceRefresher', () => {
  let refresher: BalanceRefresher;
  beforeEach(async () => {
    vi.clearAllMocks();
    pollingMock.isLive.mockReturnValue(true);
    balancesMock.refresh.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        BalanceRefresher,
        { provide: PrismaService, useValue: prismaMock },
        { provide: BalancesService, useValue: balancesMock },
        { provide: PollingStateService, useValue: pollingMock },
      ],
    }).compile();
    refresher = moduleRef.get(BalanceRefresher);
  });

  it('is a no-op when polling is OFF', async () => {
    pollingMock.isLive.mockReturnValue(false);
    await refresher.refreshAll();
    expect(prismaMock.wallet.findMany).not.toHaveBeenCalled();
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
