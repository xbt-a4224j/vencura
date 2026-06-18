import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

describe('clientIp', () => {
  it('prefers x-vercel-forwarded-for (the real client behind a Vercel rewrite)', () => {
    // Vercel overwrites x-forwarded-for with its own rotating edge IP and puts the
    // true client in x-vercel-forwarded-for.
    expect(
      clientIp({
        headers: { 'x-vercel-forwarded-for': '66.44.44.157', 'x-forwarded-for': '3.93.199.50, 10.0.0.1' },
        ip: '10.0.0.1',
      }),
    ).toBe('66.44.44.157');
  });

  it('uses the leftmost X-Forwarded-For entry (the original client) when no Vercel header', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' }, ip: '10.0.0.2' })).toBe(
      '203.0.113.7',
    );
  });

  it('trims whitespace around the entry', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '  203.0.113.7 ,10.0.0.1' }, ip: '10.0.0.2' })).toBe(
      '203.0.113.7',
    );
  });

  it('falls back to req.ip when there is no X-Forwarded-For', () => {
    expect(clientIp({ headers: {}, ip: '198.51.100.5' })).toBe('198.51.100.5');
  });

  it('falls back to req.ip when X-Forwarded-For is empty', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '' }, ip: '198.51.100.5' })).toBe('198.51.100.5');
  });
});
