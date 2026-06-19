import { Inject, Injectable } from '@nestjs/common';
import type { Abi, PublicClient } from 'viem';
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

  /** Generic view-function read (eth_call + decode) for an arbitrary contract (#32). */
  readContract(input: { address: Hex; abi: unknown; functionName: string; args: unknown[] }): Promise<unknown> {
    return this.client.readContract({
      address: input.address,
      abi: input.abi as Abi,
      functionName: input.functionName,
      args: input.args,
    });
  }

  getPendingNonce(address: Hex): Promise<number> {
    return this.client.getTransactionCount({ address, blockTag: 'pending' });
  }

  prepareTransaction(params: {
    from: Hex;
    to: Hex;
    value?: bigint;
    data?: Hex;
    nonce: number;
  }): Promise<Record<string, unknown>> {
    const { from, ...rest } = params;
    // `chain: null` = use the client's chain (none configured → viem fetches eth_chainId).
    return this.client.prepareTransactionRequest({ account: from, chain: null, ...rest }) as Promise<
      Record<string, unknown>
    >;
  }

  sendRawTransaction(serializedTransaction: Hex): Promise<Hex> {
    return this.client.sendRawTransaction({ serializedTransaction });
  }

  async getTransactionReceipt(hash: Hex) {
    try {
      return await this.client.getTransactionReceipt({ hash });
    } catch {
      return null; // not mined yet
    }
  }
}
