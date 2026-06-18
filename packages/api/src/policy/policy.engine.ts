import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { NATIVE_ASSET } from '@vencura/shared';
import { PrismaService } from '../infra/prisma/prisma.service';

interface SendIntent {
  to: string;
  asset: string;
  amount: string; // base units
}

@Injectable()
export class PolicyEngine {
  private readonly logger = new Logger(PolicyEngine.name);
  constructor(private readonly prisma: PrismaService) {}

  async assertAllowed(walletId: string, intent: SendIntent): Promise<void> {
    const policy = await this.prisma.walletPolicy.findUnique({ where: { walletId } });
    if (!policy) return; // no policy = unrestricted

    if (policy.allowlist.length > 0 && !policy.allowlist.includes(intent.to)) {
      this.deny(walletId, `recipient ${intent.to} not on allowlist`);
    }

    // Amount limits apply to native ETH only (token amount-limits = future extension).
    if (intent.asset === NATIVE_ASSET) {
      const amount = BigInt(intent.amount);
      if (policy.perTxLimit !== null && amount > BigInt(policy.perTxLimit)) {
        this.deny(walletId, `amount exceeds per-tx limit`);
      }
      if (policy.dailyLimit !== null) {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        // amount is a String column, so Prisma's numeric _sum can't aggregate it;
        // pull today's native sends and reduce with BigInt instead.
        // Exclude failed txs (VC4-04): a reverted send didn't move value, so it must not
        // count toward the daily cap and wrongly throttle the wallet.
        const sent = await this.prisma.transaction.findMany({
          select: { amount: true },
          where: { walletId, asset: NATIVE_ASSET, status: { not: 'failed' }, createdAt: { gte: start } },
        });
        const today = sent.reduce((sum, t) => sum + BigInt(t.amount), 0n);
        if (today + amount > BigInt(policy.dailyLimit)) {
          this.deny(walletId, `amount exceeds daily limit`);
        }
      }
    }
    this.logger.log(`policy pass: ${walletId} → ${intent.to}`);
  }

  private deny(walletId: string, reason: string): never {
    this.logger.warn(`policy deny: ${walletId} (${reason})`);
    throw new ForbiddenException(`policy violation: ${reason}`);
  }
}
