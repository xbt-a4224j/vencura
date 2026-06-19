import { describe, expect, it } from 'vitest';
import { SendTransactionSchema } from './send.schema';

// The `to` field is address-validated so a bad recipient is a clean 400 (ValidationPipe),
// not a 500 from viem deep in the send path (ux-redressal Finding #3).
describe('SendTransactionSchema.to', () => {
  const base = { asset: 'ETH', amount: '1' };

  it('accepts a valid 0x 40-hex address', () => {
    const r = SendTransactionSchema.safeParse({ ...base, to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' });
    expect(r.success).toBe(true);
  });

  it('rejects a non-address recipient (→ 400, not 500)', () => {
    expect(SendTransactionSchema.safeParse({ ...base, to: 'not-an-address' }).success).toBe(false);
    expect(SendTransactionSchema.safeParse({ ...base, to: '0x123' }).success).toBe(false);
    expect(SendTransactionSchema.safeParse({ ...base, to: '' }).success).toBe(false);
  });
});
