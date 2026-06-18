import { ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../infra/prisma/prisma.service';
import { AdminController } from './admin.controller';
import * as seed from './seed';

// seedDemo is heavy (argon2 + viem); stub it — we're testing reset's control flow,
// not the seed routine (covered elsewhere).
const seedResult = { email: 'demo@vencura.local', password: 'demo-password', wallets: [] };

describe('AdminController.reset', () => {
  const prisma = { user: { deleteMany: vi.fn() } } as unknown as PrismaService;
  let controller: AdminController;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(seed, 'seedDemo').mockResolvedValue(seedResult);
    controller = new AdminController(prisma);
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('refuses in production without touching the database', async () => {
    process.env.NODE_ENV = 'production';
    await expect(controller.reset()).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    expect(seed.seedDemo).not.toHaveBeenCalled();
  });

  it('wipes all users (cascades) then re-seeds outside production', async () => {
    process.env.NODE_ENV = 'development';
    const result = await controller.reset();
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({});
    expect(seed.seedDemo).toHaveBeenCalledWith(prisma);
    expect(result).toBe(seedResult);
  });
});
