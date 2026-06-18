import { describe, expect, it } from 'vitest';
import { explorerAddress, explorerTx } from '@/explorer';

describe('explorer links (Sepolia)', () => {
  it('builds an address URL on sepolia.etherscan.io', () => {
    expect(explorerAddress('0xabc')).toBe('https://sepolia.etherscan.io/address/0xabc');
  });

  it('builds a tx URL on sepolia.etherscan.io', () => {
    expect(explorerTx('0xdeadbeef')).toBe('https://sepolia.etherscan.io/tx/0xdeadbeef');
  });
});
