import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Hex } from '@vencura/shared';
import { ChainService } from '../infra/chain/chain.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { BalancesService } from '../balances/balances.service';
import { PollingStateService } from '../infra/chain/polling-state.service';

// Confirmations required before finalizing. Default 1 (anvil instant-mine = confirm once
// the tx is in a block); a public network raises it via the CONFIRMATIONS env var.
const requiredConfirmations = (): bigint => BigInt(process.env.CONFIRMATIONS ?? 1);

@Injectable()
export class ConfirmationWatcher {
  private readonly logger = new Logger(ConfirmationWatcher.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
    private readonly balances: BalancesService,
    private readonly polling: PollingStateService,
  ) {}

  @Interval(5_000)
  async reconcile(): Promise<void> {
    if (!this.polling.isLive()) return;
    const pending = await this.prisma.transaction.findMany({
      where: { status: 'pending', txHash: { not: null } },
    });
    if (pending.length === 0) return;
    const head = await this.chain.getBlockNumber();
    for (const tx of pending) {
      const receipt = await this.chain.getTransactionReceipt(tx.txHash as Hex);
      if (!receipt) continue;
      // A tx in the head block already has 1 confirmation (count = head − block + 1),
      // so confirm once `head − block + 1 >= CONFIRMATIONS`. Without the +1, an
      // on-demand-mining node (anvil) leaves head == block and the tx never confirms.
      const confirmations = head - receipt.blockNumber + 1n;
      if (confirmations < requiredConfirmations()) continue; // reorg-aware
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
