import { parseAbi } from 'viem';
import type { Hex } from '@vencura/shared';

/** DI token for the viem public client, so services inject a mockable client. */
export const PUBLIC_CLIENT = Symbol('PUBLIC_CLIENT');

/** The only ERC-20 method we read for balances. */
export const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

export interface TrackedToken {
  address: Hex;
  symbol: string;
  decimals: number;
}

/** ERC-20s the balance endpoint reports, with metadata from config (no extra RPC).
 *  Empty is valid (e.g. a fresh anvil node has no tokens). Add Sepolia test tokens here. */
export const TRACKED_TOKENS: TrackedToken[] = [];
