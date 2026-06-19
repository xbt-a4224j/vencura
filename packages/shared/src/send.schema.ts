import { z } from 'zod';

export const SendTransactionSchema = z.object({
  // A 0x-prefixed 20-byte hex address. Validating here turns a bad recipient into a clean
  // 400 (via the ValidationPipe) instead of a 500 from viem deep in the send path.
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'to must be a 0x-prefixed 40-hex address'),
  asset: z.string().min(1), // 'ETH' or an ERC-20 contract address
  amount: z.string().regex(/^\d+$/), // base units (wei / token units)
});
export type SendTransactionInput = z.infer<typeof SendTransactionSchema>;
