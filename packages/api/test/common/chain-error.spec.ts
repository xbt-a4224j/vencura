import { describe, expect, it } from 'vitest';
import { mapChainError } from '@/common/chain-error';

describe('mapChainError', () => {
  it('maps insufficient funds to 400 with a code', () => {
    const mapped = mapChainError(new Error('insufficient funds for gas * price + value'));
    expect(mapped).toMatchObject({
      status: 400,
      detail: expect.stringMatching(/insufficient funds/i),
      code: 'INSUFFICIENT_FUNDS',
    });
  });

  it('maps nonce too low to 409', () => {
    const mapped = mapChainError(new Error('nonce too low'));
    expect(mapped?.status).toBe(409);
    expect(mapped?.detail).toMatch(/nonce/i);
  });

  it('maps replacement transaction underpriced to 409', () => {
    const mapped = mapChainError(new Error('replacement transaction underpriced'));
    expect(mapped?.status).toBe(409);
    expect(mapped?.detail).toMatch(/replacement/i);
  });

  it.each(['fetch failed', 'connect ECONNREFUSED 127.0.0.1:8545', 'request timed out', 'HTTP request failed'])(
    'maps RPC failure %q to 503',
    (msg) => {
      const mapped = mapChainError(new Error(msg));
      expect(mapped?.status).toBe(503);
      expect(mapped?.detail).toMatch(/rpc/i);
    },
  );

  it('maps a transferFrom allowance revert to 400 INSUFFICIENT_ALLOWANCE', () => {
    const mapped = mapChainError(new Error('execution reverted: allowance'));
    expect(mapped).toMatchObject({ status: 400, code: 'INSUFFICIENT_ALLOWANCE' });
    expect(mapped?.detail).toMatch(/allowance/i);
  });

  it('maps a token balance revert to 400 INSUFFICIENT_TOKEN_BALANCE', () => {
    const mapped = mapChainError(new Error('execution reverted: balance'));
    expect(mapped).toMatchObject({ status: 400, code: 'INSUFFICIENT_TOKEN_BALANCE' });
  });

  it('maps a reasonless revert to 400 EXECUTION_REVERTED', () => {
    const mapped = mapChainError(new Error('execution reverted'));
    expect(mapped).toMatchObject({ status: 400, code: 'EXECUTION_REVERTED' });
  });

  it('returns null for an unknown error', () => {
    expect(mapChainError(new Error('something totally unexpected'))).toBeNull();
  });

  it('returns null for a non-Error value', () => {
    expect(mapChainError(undefined)).toBeNull();
  });
});
