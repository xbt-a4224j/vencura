import { z } from 'zod';

const bigintStringOrNull = z.string().regex(/^\d+$/).nullable();
export const PolicySchema = z.object({
  allowlist: z.array(z.string()).default([]),
  perTxLimit: bigintStringOrNull.default(null),
  dailyLimit: bigintStringOrNull.default(null),
});
export type PolicyInput = z.infer<typeof PolicySchema>;
