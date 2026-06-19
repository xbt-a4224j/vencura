import { z } from 'zod';

export const PollingSchema = z.object({ live: z.boolean() });
export type PollingInput = z.infer<typeof PollingSchema>;
