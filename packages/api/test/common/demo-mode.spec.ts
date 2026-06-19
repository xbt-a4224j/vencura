import { describe, expect, it } from 'vitest';
import { maskEmail } from '@/common/demo-mode';

describe('maskEmail', () => {
  it('keeps the first two chars + domain, masks the rest', () => {
    expect(maskEmail('alice@gmail.com')).toBe('al***@gmail.com');
  });
  it('always masks at least one char for short locals', () => {
    expect(maskEmail('ab@x.io')).toBe('ab*@x.io');
    expect(maskEmail('a@x.io')).toBe('a*@x.io');
  });
  it('does not leak a malformed (domainless) value', () => {
    expect(maskEmail('notanemail')).toBe('***');
  });
});
