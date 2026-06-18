import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainService } from './chain.service';
import { ERC20_ABI, PUBLIC_CLIENT } from './chain.constants';

const clientMock = {
  getBlockNumber: vi.fn(),
  getBalance: vi.fn(),
  readContract: vi.fn(),
  getTransactionCount: vi.fn(),
  prepareTransactionRequest: vi.fn(),
  sendRawTransaction: vi.fn(),
  getTransactionReceipt: vi.fn(),
};

describe('ChainService', () => {
  let service: ChainService;
  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ChainService, { provide: PUBLIC_CLIENT, useValue: clientMock }],
    }).compile();
    service = moduleRef.get(ChainService);
  });

  it('reads native balance via getBalance', async () => {
    clientMock.getBalance.mockResolvedValue(123n);
    await expect(service.getNativeBalance('0xabc')).resolves.toBe(123n);
    expect(clientMock.getBalance).toHaveBeenCalledWith({ address: '0xabc' });
  });

  it('reads ERC-20 balance via readContract balanceOf', async () => {
    clientMock.readContract.mockResolvedValue(50n);
    await expect(service.getErc20Balance('0xtoken', '0xabc')).resolves.toBe(50n);
    expect(clientMock.readContract).toHaveBeenCalledWith({
      address: '0xtoken',
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: ['0xabc'],
    });
  });

  it('reads the pending nonce via getTransactionCount with blockTag pending', async () => {
    clientMock.getTransactionCount.mockResolvedValue(7);
    await expect(service.getPendingNonce('0xabc')).resolves.toBe(7);
    expect(clientMock.getTransactionCount).toHaveBeenCalledWith({ address: '0xabc', blockTag: 'pending' });
  });

  it('sendRawTransaction passes the serialized tx through', async () => {
    clientMock.sendRawTransaction.mockResolvedValue('0xhash');
    await expect(service.sendRawTransaction('0xraw')).resolves.toBe('0xhash');
    expect(clientMock.sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: '0xraw' });
  });

  it('getTransactionReceipt returns null when the client throws (not mined yet)', async () => {
    clientMock.getTransactionReceipt.mockRejectedValue(new Error('not found'));
    await expect(service.getTransactionReceipt('0xhash')).resolves.toBeNull();
  });
});
