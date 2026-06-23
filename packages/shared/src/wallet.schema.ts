import { z } from 'zod';

export const CreateWalletSchema = z.object({
  scheme: z.enum(['encrypted', 'shamir']).default('encrypted'),
});
export type CreateWalletInput = z.infer<typeof CreateWalletSchema>;
