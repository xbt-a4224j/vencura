import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { type ActivityItem, mergeActivity } from './activity-merge';

// Logins are operational noise (they live in the system-log ring, not the audit trail), so every
// audit-backed view filters them out — defensive, for legacy rows written before login moved off record().
const EXCLUDE_LOGINS: Prisma.AuditLogWhereInput = { type: { not: 'auth.login' } };

/**
 * Unified activity history: on-chain `transactions` (sends), off-chain `signed_messages`,
 * inbound `received_transfers` (funds received — see IncomingWatcher), and durable `audit_log`
 * governance events, merged newest-first. The three public methods differ only in scope —
 * `assemble` is the one place that fans out the four reads and merges them.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
  ) {}

  /** Per-wallet feed. Audit is scoped to THIS wallet so account-level events (auth.login has
   *  walletId=null) can't flood a single wallet's feed and bury its on-chain history. */
  async recent(walletId: string, userId: string): Promise<ActivityItem[]> {
    await this.wallets.findOwnedOrThrow(walletId, userId); // authz: caller must own the wallet
    return this.assemble({ walletId, audit: { walletId }, take: 50 });
  }

  /** Cross-wallet feed for one user: every event across all wallets they own, newest-first.
   *  Scoped by ownership — never leaks other tenants' rows. */
  async recentForUser(userId: string): Promise<ActivityItem[]> {
    const owned = await this.prisma.wallet.findMany({ where: { userId }, select: { id: true } });
    const walletId = { in: owned.map((w) => w.id) };
    return this.assemble({ walletId, audit: { userId, ...EXCLUDE_LOGINS }, take: 100 });
  }

  /** System-wide feed across EVERY user/wallet — the custodian's operator view. */
  async recentSystemWide(): Promise<ActivityItem[]> {
    return this.assemble({ audit: EXCLUDE_LOGINS, take: 200 });
  }

  /** Fan out the four activity sources in parallel, merge newest-first, cap at `take`. `walletId`
   *  scopes transactions/signatures/received (omit for system-wide); `audit` is scoped separately
   *  since governance rows key off userId and exclude logins. Audit + received reads are best-effort
   *  so a not-yet-migrated table degrades to the rest instead of 500ing. */
  private async assemble(scope: {
    walletId?: string | { in: string[] };
    audit: Prisma.AuditLogWhereInput;
    take: number;
  }): Promise<ActivityItem[]> {
    const { walletId, audit, take } = scope;
    const where = walletId === undefined ? {} : { walletId };
    const orderBy = { createdAt: 'desc' as const };
    const [txs, sigs, audits, received] = await Promise.all([
      this.prisma.transaction.findMany({ where, orderBy, take }),
      this.prisma.signedMessage.findMany({ where, orderBy, take }),
      this.prisma.auditLog.findMany({ where: audit, orderBy, take }).catch(() => []),
      this.prisma.receivedTransfer.findMany({ where, orderBy, take }).catch(() => []),
    ]);
    return mergeActivity(txs, sigs, audits, received).slice(0, take);
  }
}
