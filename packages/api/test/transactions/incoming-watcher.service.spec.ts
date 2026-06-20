import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainService } from '@/infra/chain/chain.service';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IncomingWatcher } from '@/transactions/incoming-watcher.service';

const prismaMock = {
  wallet: { findMany: vi.fn() },
  chainCursor: { findUnique: vi.fn(), upsert: vi.fn() },
  receivedTransfer: { create: vi.fn() },
};
const chainMock = {
  getBlockNumber: vi.fn(),
  getInboundErc20Logs: vi.fn(),
  getBlockWithTxs: vi.fn(),
};

const OURS = '0xaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAA'; // a managed wallet
const OTHER = '0xbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBB';

describe('IncomingWatcher', () => {
  let watcher: IncomingWatcher;
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.INCOMING_MAX_BLOCKS_PER_TICK = '10';
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'w1', address: OURS }]);
    prismaMock.chainCursor.findUnique.mockResolvedValue({ name: 'incoming', value: 99n }); // scan from 100
    prismaMock.chainCursor.upsert.mockResolvedValue({});
    prismaMock.receivedTransfer.create.mockResolvedValue({});
    chainMock.getBlockNumber.mockResolvedValue(100n);
    chainMock.getInboundErc20Logs.mockResolvedValue([]);
    chainMock.getBlockWithTxs.mockResolvedValue({ transactions: [] });
    const moduleRef = await Test.createTestingModule({
      providers: [
        IncomingWatcher,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ChainService, useValue: chainMock },
      ],
    }).compile();
    watcher = moduleRef.get(IncomingWatcher);
  });

  it('records a native ETH transfer received by a managed wallet', async () => {
    chainMock.getBlockWithTxs.mockResolvedValue({
      transactions: [{ hash: '0xnative', to: OURS, from: OTHER, value: 5n }],
    });
    await watcher.scan();
    expect(prismaMock.receivedTransfer.create).toHaveBeenCalledWith({
      data: { walletId: 'w1', txHash: '0xnative', logIndex: -1, asset: 'ETH', amount: '5', fromAddress: OTHER, blockNumber: 100n },
    });
    expect(prismaMock.chainCursor.upsert).toHaveBeenCalled(); // cursor advanced
  });

  it('records an inbound ERC-20 transfer from getLogs', async () => {
    chainMock.getInboundErc20Logs.mockResolvedValue([
      {
        transactionHash: '0xerc20',
        blockNumber: 100n,
        logIndex: 2,
        address: '0xToKeN',
        args: { from: OTHER, to: OURS, value: 1000n },
      },
    ]);
    await watcher.scan();
    expect(prismaMock.receivedTransfer.create).toHaveBeenCalledWith({
      data: { walletId: 'w1', txHash: '0xerc20', logIndex: 2, asset: '0xtoken', amount: '1000', fromAddress: OTHER, blockNumber: 100n },
    });
  });

  it('skips self-sends (from === to) — already recorded as our own outgoing tx', async () => {
    chainMock.getBlockWithTxs.mockResolvedValue({
      transactions: [{ hash: '0xself', to: OURS, from: OURS, value: 5n }],
    });
    await watcher.scan();
    expect(prismaMock.receivedTransfer.create).not.toHaveBeenCalled();
  });

  it('ignores transfers to addresses we do not manage', async () => {
    chainMock.getBlockWithTxs.mockResolvedValue({
      transactions: [{ hash: '0xout', to: OTHER, from: OURS, value: 5n }],
    });
    await watcher.scan();
    expect(prismaMock.receivedTransfer.create).not.toHaveBeenCalled();
  });

  it('does nothing when no wallets exist', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([]);
    await watcher.scan();
    expect(chainMock.getBlockNumber).not.toHaveBeenCalled();
    expect(prismaMock.chainCursor.upsert).not.toHaveBeenCalled();
  });
});
