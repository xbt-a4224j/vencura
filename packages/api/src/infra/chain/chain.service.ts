import { Inject, Injectable } from '@nestjs/common';
import type { PublicClient } from 'viem';
import type { Hex } from '@vencura/shared';
import { ERC20_ABI, PUBLIC_CLIENT } from './chain.constants';

/** Narrow, mockable reads against the chain. The client is injected (PUBLIC_CLIENT). */
@Injectable()
export class ChainService {
  constructor(@Inject(PUBLIC_CLIENT) private readonly client: PublicClient) {}

  getBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  getNativeBalance(address: Hex): Promise<bigint> {
    return this.client.getBalance({ address });
  }

  getErc20Balance(token: Hex, address: Hex): Promise<bigint> {
    return this.client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address],
    });
  }
}
