import { z } from 'zod';

// Internal account↔account transfer: move funds between two wallets the same user owns.
// It reuses the send path (lock / nonce / policy / idempotency) — `to` is resolved from
// the destination wallet's address server-side.
export const TransferSchema = z.object({
  toWalletId: z.string().min(1),
  asset: z.string().min(1), // 'ETH' or an ERC-20 contract address
  amount: z.string().regex(/^\d+$/), // base units (wei / token units)
});
export type TransferInput = z.infer<typeof TransferSchema>;
