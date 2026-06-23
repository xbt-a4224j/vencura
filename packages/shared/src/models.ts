/**
 * Response models — the shapes the API returns. Centralized here so the API services, the SDK,
 * and the web all import ONE definition (no drift). Request shapes live in the *.schema.ts Zod
 * files; these are the read side. Plain interfaces (not Zod): responses are produced by the
 * server and don't need client-side runtime validation, only shared types.
 */
import type { Account } from './auth.schema';

export interface AuthResult {
  accessToken: string;
  user: Account;
}

export interface Wallet {
  id: string;
  address: string;
  signerScheme: string;
  createdAt?: string;
}

/** Admin operator console: every platform wallet with owner email, cached ETH balance (wei bigint
 *  string), and whether it's the operator's own wallet — the only one the operator can act on. */
export interface WalletOverview {
  id: string;
  address: string;
  email: string;
  self: boolean;
  confirmed: string;
  asOfBlock: number | null;
  signerScheme: string;
}

/** A platform wallet for the admin holder picker (address + owner email). */
export interface Holder {
  address: string;
  email: string;
}

export interface BalanceLine {
  asset: string;
  symbol: string;
  confirmed: string; // base units (wei / token units) — never a float
  available: string; // confirmed − pending
  asOfBlock: number | null;
}
export interface BalanceView {
  walletId: string;
  balances: BalanceLine[];
}

export type TransactionStatus = 'pending' | 'confirmed' | 'failed';
export interface Transaction {
  id: string;
  asset: string; // 'ETH', an ERC-20 address, or 'CALL' for a contract write
  amount: string;
  toAddress: string;
  status: TransactionStatus;
  txHash: string | null;
  nonce: number | null;
  createdAt: string;
}

/** Unified on/off-chain + audit activity item (GET /wallets/:id/activity · GET /activity). */
export type ActivityItem =
  | {
      kind: 'transaction';
      id: string;
      status: string;
      asset: string;
      amount: string;
      method?: string | null; // contract write: the function called (e.g. 'approve')
      to: string;
      txHash: string | null;
      walletId?: string;
      createdAt: string;
    }
  | { kind: 'signature'; id: string; message: string; signature: string; walletId?: string; createdAt: string }
  | { kind: 'audit'; id: string; type: string; detail: unknown; walletId: string | null; createdAt: string }
  | {
      kind: 'received';
      id: string;
      asset: string;
      amount: string;
      from: string;
      txHash: string;
      walletId?: string;
      createdAt: string;
    };

/** One line of the live "system log" ring buffer (GET /events?after=seq). */
export interface LogLine {
  seq: number;
  at: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export interface ChainHead {
  network: string;
  blockNumber: number;
  gasGwei: number;
}

/** The fixed ERC-20 the app operates on: address + owner/spender (the master wallet). */
export interface TokenInfo {
  address: string;
  owner: string;
}

/** Result of a generic contract read (eth_call + decode). */
export interface ContractReadResult {
  result: unknown;
}

/** Admin seed/reset result. */
export interface SeedResult {
  email: string;
  password: string;
  wallets: { id: string; address: string }[];
}
