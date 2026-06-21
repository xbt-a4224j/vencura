import { describe, expect, it, vi } from 'vitest';
import { EventsService } from '@/infra/events/events.service';

// PrismaService stub: only auditLog.create is exercised by record().
function makeService() {
  const create = vi.fn().mockResolvedValue(undefined);
  const svc = new EventsService({ auditLog: { create } } as never);
  return { svc, create };
}

describe('EventsService', () => {
  it('assigns strictly increasing seq numbers', () => {
    const { svc } = makeService();
    const a = svc.emit('one');
    const b = svc.emit('two');
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
  });

  it('since(after) returns only lines newer than the cursor, plus the head seq', () => {
    const { svc } = makeService();
    svc.emit('a');
    svc.emit('b');
    const { lines, seq } = svc.since(1);
    expect(lines.map((l) => l.msg)).toEqual(['b']);
    expect(seq).toBe(2);
  });

  it('since(0) returns the whole buffer', () => {
    const { svc } = makeService();
    svc.emit('a');
    svc.emit('b');
    expect(svc.since(0).lines).toHaveLength(2);
  });

  it('evicts oldest lines past the 200-line cap but keeps seq monotonic', () => {
    const { svc } = makeService();
    for (let i = 0; i < 250; i++) svc.emit(`line ${i}`);
    const { lines, seq } = svc.since(0);
    expect(lines).toHaveLength(200); // capped
    expect(seq).toBe(250); // seq keeps counting past evictions
    expect(lines[0].msg).toBe('line 50'); // first 50 evicted
  });

  it('record() persists an audit row and also surfaces it on the live ring', async () => {
    const { svc, create } = makeService();
    await svc.record({ userId: 'u1', walletId: 'w1', type: 'wallet.created', msg: 'wallet created' });
    expect(create).toHaveBeenCalledWith({
      data: { userId: 'u1', walletId: 'w1', type: 'wallet.created', detail: undefined },
    });
    expect(svc.since(0).lines.at(-1)?.msg).toBe('wallet created');
  });
});
