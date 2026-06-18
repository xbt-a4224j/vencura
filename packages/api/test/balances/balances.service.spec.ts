import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { ChainService } from '@/infra/chain/chain.service';
import { WalletsService } from '@/wallets/wallets.service';
import { BalancesService, GAS_RESERVE_WEI } from '@/balances/balances.service';

const prismaMock = {
  walletBalance: { findMany: vi.fn(), upsert: vi.fn() },
  transaction: { findMany: vi.fn() },
};
const chainMock = { getBlockNumber: vi.fn(), getNativeBalance: vi.fn(), getErc20Balance: vi.fn() };
const walletsMock = { findOwnedOrThrow: vi.fn() };

describe('BalancesService', () => {
  let service: BalancesService;
  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.transaction.findMany.mockResolvedValue([]); // no pending sends by default
    const moduleRef = await Test.createTestingModule({
      providers: [
        BalancesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ChainService, useValue: chainMock },
        { provide: WalletsService, useValue: walletsMock },
      ],
    }).compile();
    service = moduleRef.get(BalancesService);
  });

  it('cache hit: confirmed minus the native gas reserve, no chain read', async () => {
    walletsMock.findOwnedOrThrow.mockResolvedValue({ id: 'w1', address: '0xabc' });
    const confirmed = GAS_RESERVE_WEI + 1000n; // comfortably above the reserve
    prismaMock.walletBalance.findMany.mockResolvedValue([
      { walletId: 'w1', asset: 'ETH', confirmed: confirmed.toString(), asOfBlock: 5, updatedAt: new Date() },
    ]);
    const view = await service.getBalances('w1', 'user-1');
    expect(view.balances[0]).toMatchObject({
      asset: 'ETH',
      symbol: 'ETH',
      confirmed: confirmed.toString(),
      available: (confirmed - GAS_RESERVE_WEI).toString(),
    });
    expect(chainMock.getNativeBalance).not.toHaveBeenCalled();
  });

  it('available = confirmed − pending(outgoing, same asset) − gas reserve (ETH)', async () => {
    walletsMock.findOwnedOrThrow.mockResolvedValue({ id: 'w1', address: '0xabc' });
    const confirmed = GAS_RESERVE_WEI + 1000n;
    prismaMock.walletBalance.findMany.mockResolvedValue([
      { walletId: 'w1', asset: 'ETH', confirmed: confirmed.toString(), asOfBlock: 5, updatedAt: new Date() },
    ]);
    prismaMock.transaction.findMany.mockResolvedValue([{ amount: '300' }]); // one pending outgoing ETH tx
    const view = await service.getBalances('w1', 'user-1');
    expect(view.balances[0]).toMatchObject({
      confirmed: confirmed.toString(),
      available: (confirmed - 300n - GAS_RESERVE_WEI).toString(),
    });
    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith({
      where: { walletId: 'w1', status: 'pending', asset: 'ETH' },
      select: { amount: true },
    });
  });

  it('clamps available at 0 when pending + reserve exceed confirmed', async () => {
    walletsMock.findOwnedOrThrow.mockResolvedValue({ id: 'w1', address: '0xabc' });
    prismaMock.walletBalance.findMany.mockResolvedValue([
      { walletId: 'w1', asset: 'ETH', confirmed: '100', asOfBlock: 5, updatedAt: new Date() },
    ]);
    const view = await service.getBalances('w1', 'user-1');
    expect(view.balances[0].available).toBe('0');
  });

  it('cache miss: refreshes from chain then returns the freshly cached view', async () => {
    walletsMock.findOwnedOrThrow.mockResolvedValue({ id: 'w1', address: '0xabc' });
    prismaMock.walletBalance.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ walletId: 'w1', asset: 'ETH', confirmed: '777', asOfBlock: 9, updatedAt: new Date() }]);
    chainMock.getBlockNumber.mockResolvedValue(9n);
    chainMock.getNativeBalance.mockResolvedValue(777n);

    const view = await service.getBalances('w1', 'user-1');
    expect(chainMock.getNativeBalance).toHaveBeenCalledWith('0xabc');
    expect(prismaMock.walletBalance.upsert).toHaveBeenCalled();
    expect(view.balances[0].confirmed).toBe('777');
  });

  it('propagates 404 when the wallet is not owned', async () => {
    walletsMock.findOwnedOrThrow.mockRejectedValue(new NotFoundException());
    await expect(service.getBalances('w1', 'other')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('503 on a cold read when the chain is unreachable', async () => {
    walletsMock.findOwnedOrThrow.mockResolvedValue({ id: 'w1', address: '0xabc' });
    prismaMock.walletBalance.findMany.mockResolvedValue([]);
    chainMock.getBlockNumber.mockRejectedValue(new Error('rpc down'));
    await expect(service.getBalances('w1', 'user-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
