import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Hex } from '@vencura/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { BalancesService } from './balances.service';
import { PollingStateService } from '../infra/chain/polling-state.service';

/** Keeps the balance cache warm. At scale this becomes per-wallet queued jobs (Block 4 queue). */
@Injectable()
export class BalanceRefresher {
  private readonly logger = new Logger(BalanceRefresher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly balances: BalancesService,
    private readonly polling: PollingStateService,
  ) {}

  @Interval(30_000)
  async refreshAll(): Promise<void> {
    if (!this.polling.isLive()) return;
    const wallets = await this.prisma.wallet.findMany({ select: { id: true, address: true } });
    for (const w of wallets) {
      await this.balances
        .refresh(w.id, w.address as Hex)
        .catch((e) => this.logger.warn(`refresh ${w.id} failed: ${e.message}`));
    }
  }
}
