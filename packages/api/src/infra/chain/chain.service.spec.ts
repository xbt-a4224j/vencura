import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainService } from './chain.service';
import { ERC20_ABI, PUBLIC_CLIENT } from './chain.constants';

const clientMock = { getBlockNumber: vi.fn(), getBalance: vi.fn(), readContract: vi.fn() };

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
});
