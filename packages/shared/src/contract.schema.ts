import { z } from 'zod';

// A generic contract interaction. `abi` is a viem-style ABI fragment array; `args` are the
// call arguments. Read does an eth_call + decode; write encodes the call and routes it
// through the existing send path (sign + broadcast under the per-wallet nonce lock).
const abi = z.array(z.unknown()).min(1);
const args = z.array(z.unknown()).default([]);

export const ContractReadSchema = z.object({
  address: z.string().min(1),
  abi,
  functionName: z.string().min(1),
  args,
});
export type ContractReadInput = z.infer<typeof ContractReadSchema>;

export const ContractWriteSchema = z.object({
  address: z.string().min(1),
  abi,
  functionName: z.string().min(1),
  args,
  value: z.string().regex(/^\d+$/).default('0'), // wei sent with the call (usually 0)
});
export type ContractWriteInput = z.infer<typeof ContractWriteSchema>;
