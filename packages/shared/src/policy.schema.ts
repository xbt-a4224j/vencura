import { z } from 'zod';

const bigintStringOrNull = z.string().regex(/^\d+$/).nullable();
// Spending limits only (per-tx + daily). The recipient allowlist was removed — gating who can
// receive funds is now demonstrated on-chain via ERC-20 approve/allowance, not an off-chain
// whitelist.
export const PolicySchema = z.object({
  perTxLimit: bigintStringOrNull.default(null),
  dailyLimit: bigintStringOrNull.default(null),
});
export type PolicyInput = z.infer<typeof PolicySchema>;
