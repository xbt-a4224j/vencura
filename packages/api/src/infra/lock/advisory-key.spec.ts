import { describe, expect, it } from 'vitest';
import { advisoryKey } from './advisory-key';

describe('advisoryKey', () => {
  it('is deterministic and fits a positive signed-64-bit range', () => {
    const k = advisoryKey('wallet-1');
    expect(advisoryKey('wallet-1')).toBe(k);
    expect(k).toBeGreaterThan(0n);
    expect(k).toBeLessThan(2n ** 63n);
  });
  it('differs per wallet', () => {
    expect(advisoryKey('a')).not.toBe(advisoryKey('b'));
  });
});
