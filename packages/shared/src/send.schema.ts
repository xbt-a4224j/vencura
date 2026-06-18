import { z } from 'zod';

export const SendTransactionSchema = z.object({
  to: z.string().min(1),
  asset: z.string().min(1), // 'ETH' or an ERC-20 contract address
  amount: z.string().regex(/^\d+$/), // base units (wei / token units)
});
export type SendTransactionInput = z.infer<typeof SendTransactionSchema>;
