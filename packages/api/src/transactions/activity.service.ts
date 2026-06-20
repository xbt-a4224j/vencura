import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { type ActivityItem, mergeActivity } from './activity-merge';

/**
 * Unified on/off-chain + audit activity history (the "transaction history (on/off-chain)"
 * requirement, plus the audit trail). Reads — on-chain `transactions`, off-chain
 * `signed_messages`, and durable `audit_log` governance events — merged newest-first.
 * `recent` is per-wallet; `recentForUser` aggregates across all of a user's wallets for the
 * unified Activity view (one query set, not N round-trips).
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
  ) {}

  async recent(walletId: string, userId: string): Promise<ActivityItem[]> {
    await this.wallets.findOwnedOrThrow(walletId, userId); // authz: caller must own the wallet
    const [txs, sigs, audits] = await Promise.all([
      this.prisma.transaction.findMany({ where: { walletId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.signedMessage.findMany({ where: { walletId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.auditLog
        .findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 })
        .catch(() => []),
    ]);
    return mergeActivity(txs, sigs, audits);
  }

  /** Cross-wallet audit trail for one user: every send, signature, and governance event across
   *  all wallets they own, newest-first. Scoped by ownership — never leaks other tenants' rows. */
  async recentForUser(userId: string): Promise<ActivityItem[]> {
    const owned = await this.prisma.wallet.findMany({ where: { userId }, select: { id: true } });
    const walletIds = owned.map((w) => w.id);
    const [txs, sigs, audits] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { walletId: { in: walletIds } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.signedMessage.findMany({
        where: { walletId: { in: walletIds } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      // Best-effort: if the audit_log migration hasn't applied yet, degrade to tx+sig (don't 500).
      this.prisma.auditLog
        .findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 })
        .catch(() => []),
    ]);
    return mergeActivity(txs, sigs, audits).slice(0, 100);
  }

  /** System-wide activity across EVERY user/wallet — the admin console's operator view, so a
   *  custodian sees all tenants' sends, signatures, and governance events (not just their own). */
  async recentSystemWide(): Promise<ActivityItem[]> {
    const [txs, sigs, audits] = await Promise.all([
      this.prisma.transaction.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.signedMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }).catch(() => []),
    ]);
    return mergeActivity(txs, sigs, audits).slice(0, 200);
  }
}
