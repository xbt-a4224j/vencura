import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Hex } from '@vencura/shared';
import { ChainService } from '../infra/chain/chain.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { BalancesService } from '../balances/balances.service';

const CONFIRMATIONS = 1; // anvil instant-mine; raise for a public network

@Injectable()
export class ConfirmationWatcher {
  private readonly logger = new Logger(ConfirmationWatcher.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
    private readonly balances: BalancesService,
  ) {}

  @Interval(5_000)
  async reconcile(): Promise<void> {
    const pending = await this.prisma.transaction.findMany({
      where: { status: 'pending', txHash: { not: null } },
    });
    if (pending.length === 0) return;
    const head = await this.chain.getBlockNumber();
    for (const tx of pending) {
      const receipt = await this.chain.getTransactionReceipt(tx.txHash as Hex);
      if (!receipt) continue;
      if (head - receipt.blockNumber < BigInt(CONFIRMATIONS)) continue; // reorg-aware
      const status = receipt.status === 'success' ? 'confirmed' : 'failed';
      await this.prisma.transaction.update({ where: { id: tx.id }, data: { status } });
      this.logger.log(`tx ${tx.txHash} → ${status}`);
      const w = await this.prisma.wallet.findUnique({
        where: { id: tx.walletId },
        select: { address: true },
      });
      if (w) await this.balances.refresh(tx.walletId, w.address as Hex).catch(() => undefined);
    }
  }
}
