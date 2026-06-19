import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { NATIVE_ASSET, type Hex } from '@vencura/shared';
import { ChainService } from '../infra/chain/chain.service';
import { TRACKED_TOKENS } from '../infra/chain/chain.constants';
import { PrismaService } from '../infra/prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';

const STALE_MS = 15_000; // serve cache; revalidate in the background if older than this

export interface BalanceView {
  walletId: string;
  balances: Array<{
    asset: string;
    symbol: string;
    confirmed: string;
    available: string;
    asOfBlock: number | null;
  }>;
}

@Injectable()
export class BalancesService {
  private readonly logger = new Logger(BalancesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
    private readonly wallets: WalletsService,
  ) {}

  async getBalances(walletId: string, userId: string): Promise<BalanceView> {
    const wallet = await this.wallets.findOwnedOrThrow(walletId, userId);
    let rows = await this.prisma.walletBalance.findMany({ where: { walletId } });

    if (rows.length === 0) {
      this.logger.log(`balance fetched (cache miss): ${walletId}`);
      try {
        await this.refresh(walletId, wallet.address as Hex); // cold read: must await
      } catch (e) {
        // No cache to fall back on and the chain is unreachable → 503 (not a raw 500).
        this.logger.warn(`cold balance read failed for ${walletId}: ${(e as Error).message}`);
        throw new ServiceUnavailableException('balance temporarily unavailable (RPC error)');
      }
      rows = await this.prisma.walletBalance.findMany({ where: { walletId } });
    } else {
      this.logger.log(`balance fetched (cache hit): ${walletId}`);
      const newest = Math.max(...rows.map((r) => r.updatedAt.getTime()));
      if (Date.now() - newest > STALE_MS) {
        void this.refresh(walletId, wallet.address as Hex).catch((e) =>
          this.logger.warn(`background refresh failed for ${walletId}: ${e.message}`),
        );
      }
    }
    return this.toView(walletId, rows);
  }

  /** Sum of outgoing amounts still pending on-chain for a wallet+asset (optimistic debit). */
  private async pendingOutgoing(walletId: string, asset: string): Promise<bigint> {
    const rows = await this.prisma.transaction.findMany({
      where: { walletId, status: 'pending', asset },
      select: { amount: true },
    });
    return rows.reduce((sum, r) => sum + BigInt(r.amount), 0n);
  }

  /** Read live balances and upsert the cache. Idempotent. */
  async refresh(walletId: string, address: Hex): Promise<void> {
    const asOfBlock = Number(await this.chain.getBlockNumber());
    await this.upsert(walletId, NATIVE_ASSET, await this.chain.getNativeBalance(address), asOfBlock);
    for (const token of TRACKED_TOKENS) {
      const balance = await this.chain.getErc20Balance(token.address, address);
      await this.upsert(walletId, token.address, balance, asOfBlock);
    }
  }

  private upsert(walletId: string, asset: string, balance: bigint, asOfBlock: number) {
    const confirmed = balance.toString();
    return this.prisma.walletBalance.upsert({
      where: { walletId_asset: { walletId, asset } },
      create: { walletId, asset, confirmed, asOfBlock },
      update: { confirmed, asOfBlock },
    });
  }

  private async toView(
    walletId: string,
    rows: Array<{ asset: string; confirmed: string; asOfBlock: number | null }>,
  ): Promise<BalanceView> {
    const balances = await Promise.all(
      rows.map(async (r) => {
        // available = confirmed − pending(outgoing, same asset), clamped ≥ 0. No gas reserve: the
        // chain enforces balance ≥ amount + gas at broadcast (mapped to a clean "insufficient
        // funds" error), so we don't hold back a hand-tuned buffer from the displayed balance.
        const pending = await this.pendingOutgoing(walletId, r.asset);
        let available = BigInt(r.confirmed) - pending;
        if (available < 0n) available = 0n;
        return {
          asset: r.asset,
          symbol:
            r.asset === NATIVE_ASSET
              ? 'ETH'
              : (TRACKED_TOKENS.find((t) => t.address === r.asset)?.symbol ?? r.asset),
          confirmed: r.confirmed,
          available: available.toString(),
          asOfBlock: r.asOfBlock,
        };
      }),
    );
    return { walletId, balances };
  }
}
