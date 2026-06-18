import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { type ActivityItem, mergeActivity } from './activity-merge';

/**
 * Unified on/off-chain activity history for a wallet (the "transaction history
 * (on/off-chain)" requirement). Two reads — on-chain `transactions` and off-chain
 * `signed_messages` — merged newest-first. No separate audit store: the history IS
 * the audit.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
  ) {}

  async recent(walletId: string, userId: string): Promise<ActivityItem[]> {
    await this.wallets.findOwnedOrThrow(walletId, userId); // authz: caller must own the wallet
    const [txs, sigs] = await Promise.all([
      this.prisma.transaction.findMany({ where: { walletId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.signedMessage.findMany({ where: { walletId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return mergeActivity(txs, sigs);
  }
}
