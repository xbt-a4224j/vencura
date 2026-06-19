import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import type { PollingStateService } from '@/infra/chain/polling-state.service';
import { AdminController } from '@/admin/admin.controller';
import * as seed from '@/admin/seed';

// seedDemo is heavy (argon2 + viem); stub it — we're testing reset's control flow,
// not the seed routine (covered elsewhere).
const seedResult = { email: 'demo@vencura.local', password: 'demo-password', wallets: [] };

describe('AdminController.reset', () => {
  const prisma = { user: { deleteMany: vi.fn() } } as unknown as PrismaService;
  const polling = { isLive: vi.fn().mockReturnValue(false), setLive: vi.fn() } as unknown as PollingStateService;
  let controller: AdminController;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(seed, 'seedDemo').mockResolvedValue(seedResult);
    controller = new AdminController(prisma, polling);
  });

  it('wipes all users (cascades to wallets/txs/balances/policies) then re-seeds', async () => {
    const result = await controller.reset();
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({});
    expect(seed.seedDemo).toHaveBeenCalledWith(prisma);
    expect(result).toBe(seedResult);
  });
});
