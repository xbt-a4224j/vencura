import { z } from 'zod';

export const SignMessageSchema = z.object({ message: z.string().min(1) });
export type SignMessageInput = z.infer<typeof SignMessageSchema>;
