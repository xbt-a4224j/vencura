import { Inject, Injectable } from '@nestjs/common';
import { type Abi, parseAbiItem, type PublicClient } from 'viem';
import type { Hex } from '@vencura/shared';
import { ERC20_ABI, PUBLIC_CLIENT } from './chain.constants';

// Standard ERC-20 Transfer event — used to find inbound token transfers to our wallets via getLogs
// (indexed `to` lets the node filter server-side; no per-block scan needed for tokens).
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

/** Narrow, mockable reads against the chain. The client is injected (PUBLIC_CLIENT). */
@Injectable()
export class ChainService {
  constructor(@Inject(PUBLIC_CLIENT) private readonly client: PublicClient) {}

  getBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  getGasPrice(): Promise<bigint> {
    return this.client.getGasPrice();
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
    to?: Hex; // omitted = contract creation (deploy)
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

  /** Wait for a tx to mine and return its receipt (used by contract deploy to read the new
   *  contract address). */
  waitForReceipt(hash: Hex) {
    return this.client.waitForTransactionReceipt({ hash });
  }

  async getTransactionReceipt(hash: Hex) {
    try {
      return await this.client.getTransactionReceipt({ hash });
    } catch {
      return null; // not mined yet
    }
  }

  /** Inbound ERC-20 Transfer logs to any of `addresses` over a block range (one filtered query,
   *  not a per-block scan). Used by IncomingWatcher to index received token transfers. */
  getInboundErc20Logs(addresses: Hex[], fromBlock: bigint, toBlock: bigint) {
    return this.client.getLogs({ event: TRANSFER_EVENT, args: { to: addresses }, fromBlock, toBlock });
  }

  /** A block with full tx objects — native ETH transfers emit no logs, so inbound ETH is found by
   *  scanning block transactions for `to ∈ our wallets`. */
  getBlockWithTxs(blockNumber: bigint) {
    return this.client.getBlock({ blockNumber, includeTransactions: true });
  }
}
