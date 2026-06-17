import { describe, expect, it } from 'vitest';
import { NATIVE_ASSET } from './index';

// Proves the Vitest harness runs across the workspace (T-001 acceptance).
describe('shared', () => {
  it('names the native asset as ETH', () => {
    expect(NATIVE_ASSET).toBe('ETH');
  });
});
