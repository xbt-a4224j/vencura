import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { PolicyEngine } from '@/policy/policy.engine';

const prismaMock = {
  walletPolicy: { findUnique: vi.fn() },
  transaction: { findMany: vi.fn() },
};

describe('PolicyEngine', () => {
  let engine: PolicyEngine;
  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.transaction.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [PolicyEngine, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    engine = moduleRef.get(PolicyEngine);
  });

  const send = { to: '0xRecipient', asset: 'ETH', amount: '1000' };

  it('allows when no policy row exists', async () => {
    prismaMock.walletPolicy.findUnique.mockResolvedValue(null);
    await expect(engine.assertAllowed('w1', send)).resolves.toBeUndefined();
  });

  it('denies a native amount over the per-tx limit', async () => {
    prismaMock.walletPolicy.findUnique.mockResolvedValue({ perTxLimit: '500', dailyLimit: null });
    await expect(engine.assertAllowed('w1', send)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies when today + this send exceeds the daily limit', async () => {
    prismaMock.walletPolicy.findUnique.mockResolvedValue({ perTxLimit: null, dailyLimit: '1500' });
    prismaMock.transaction.findMany.mockResolvedValue([{ amount: '1000' }]); // already sent today
    await expect(engine.assertAllowed('w1', send)).rejects.toBeInstanceOf(ForbiddenException); // 1000+1000 > 1500
  });

  it('allows within limits', async () => {
    prismaMock.walletPolicy.findUnique.mockResolvedValue({ perTxLimit: '2000', dailyLimit: '5000' });
    await expect(engine.assertAllowed('w1', send)).resolves.toBeUndefined();
  });

  it('excludes failed txs from the daily total (status != failed)', async () => {
    // dailyLimit 1500; a failed 1000 send must NOT count, so this 1000 send is allowed.
    prismaMock.walletPolicy.findUnique.mockResolvedValue({ perTxLimit: null, dailyLimit: '1500' });
    await expect(engine.assertAllowed('w1', send)).resolves.toBeUndefined();
    // The query must filter out failed rows so they never reach the sum.
    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: 'failed' } }) }),
    );
  });
});
