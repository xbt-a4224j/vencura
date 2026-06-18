import { describe, expect, it } from 'vitest';
import { mergeActivity } from './activity-merge';

const tx = (id: string, t: string) => ({
  id,
  status: 'confirmed',
  asset: 'ETH',
  amount: '1',
  toAddress: '0xto',
  txHash: '0xhash',
  createdAt: new Date(t),
});
const sig = (id: string, t: string) => ({ id, message: 'hi', signature: '0xsig', createdAt: new Date(t) });

describe('mergeActivity', () => {
  it('interleaves txs and signatures newest-first', () => {
    const out = mergeActivity(
      [tx('t1', '2026-06-18T10:00:00Z'), tx('t2', '2026-06-18T12:00:00Z')],
      [sig('s1', '2026-06-18T11:00:00Z')],
    );
    expect(out.map((i) => i.id)).toEqual(['t2', 's1', 't1']);
  });

  it('tags each item with its kind and maps the right fields', () => {
    const [txItem] = mergeActivity([tx('t1', '2026-06-18T10:00:00Z')], []);
    const [sigItem] = mergeActivity([], [sig('s1', '2026-06-18T10:00:00Z')]);
    expect(txItem).toMatchObject({ kind: 'transaction', to: '0xto', txHash: '0xhash' });
    expect(sigItem).toMatchObject({ kind: 'signature', message: 'hi', signature: '0xsig' });
  });

  it('returns an empty list when there is no activity', () => {
    expect(mergeActivity([], [])).toEqual([]);
  });
});
