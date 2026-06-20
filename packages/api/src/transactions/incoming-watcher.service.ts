import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import type { Hex } from '@vencura/shared';
import { ChainService } from '../infra/chain/chain.service';
import { PrismaService } from '../infra/prisma/prisma.service';

const CURSOR = 'incoming'; // chain_cursor row name
// First-run lookback so an already-funded demo wallet's recent deposits get backfilled (Sepolia
// ≈ 7200 blocks/day). Each tick advances at most MAX_PER_TICK blocks so a cold start doesn't
// hammer the RPC in one shot — it catches up over a few ticks, then tracks the head.
const lookback = (): bigint => BigInt(process.env.INCOMING_LOOKBACK_BLOCKS ?? 7200);
const maxPerTick = (): bigint => BigInt(process.env.INCOMING_MAX_BLOCKS_PER_TICK ?? 200);

/**
 * Indexes INBOUND transfers (ETH + ERC-20) credited to a managed wallet that VenCura didn't send.
 * A tx is recorded under the sender's wallet, so without this a recipient's activity feed never
 * shows funds received — diverging from the block explorer. This watcher closes that gap: it scans
 * new blocks for ETH `to` our wallets and queries ERC-20 Transfer logs `to` our wallets, persisting
 * each as a `ReceivedTransfer`. The `@@unique(walletId,txHash,logIndex)` makes re-scans idempotent.
 */
@Injectable()
export class IncomingWatcher {
  private readonly logger = new Logger(IncomingWatcher.name);
  private running = false; // skip overlapping ticks (a wide cold-start range can outlast the interval)

  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
  ) {}

  @Interval(15_000)
  async scan(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tick();
    } catch (e) {
      this.logger.warn(`incoming scan failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async tick(): Promise<void> {
    const wallets = await this.prisma.wallet.findMany({ select: { id: true, address: true } });
    if (wallets.length === 0) return;
    const byAddr = new Map(wallets.map((w) => [w.address.toLowerCase(), w.id]));
    const addresses = wallets.map((w) => w.address as Hex);

    const head = await this.chain.getBlockNumber();
    const cursor = await this.prisma.chainCursor.findUnique({ where: { name: CURSOR } });
    const from = cursor ? cursor.value + 1n : head > lookback() ? head - lookback() : 0n;
    if (from > head) return;
    const to = head - from + 1n > maxPerTick() ? from + maxPerTick() - 1n : head;

    let count = 0;
    const blockTime = new Map<bigint, Date>(); // blockNumber → on-chain timestamp (the real event time)

    // Native ETH inbound — scan each block's txs (native transfers emit no logs). We fetch every
    // block in range anyway, so record its timestamp for the ERC-20 pass too (no extra RPC).
    for (let b = from; b <= to; b++) {
      const block = await this.chain.getBlockWithTxs(b);
      blockTime.set(b, new Date(Number(block.timestamp) * 1000));
      for (const tx of block.transactions) {
        if (!tx.to || tx.value <= 0n) continue;
        if (tx.from.toLowerCase() === tx.to.toLowerCase()) continue; // self-send: already our own tx
        const walletId = byAddr.get(tx.to.toLowerCase());
        if (!walletId) continue;
        count += await this.record({
          walletId,
          txHash: tx.hash,
          logIndex: -1, // native transfer — no log
          asset: 'ETH',
          amount: tx.value.toString(),
          fromAddress: tx.from,
          blockNumber: b,
          occurredAt: blockTime.get(b)!,
        });
      }
    }

    // ERC-20 inbound — one server-side-filtered query over the whole range.
    const logs = await this.chain.getInboundErc20Logs(addresses, from, to);
    for (const log of logs) {
      const fromAddr = (log.args.from ?? '') as string;
      const toAddr = (log.args.to ?? '') as string;
      if (fromAddr.toLowerCase() === toAddr.toLowerCase()) continue; // self-send: already our own tx
      const walletId = byAddr.get(toAddr.toLowerCase());
      if (!walletId || !log.transactionHash || log.blockNumber == null) continue;
      count += await this.record({
        walletId,
        txHash: log.transactionHash,
        logIndex: Number(log.logIndex ?? 0),
        asset: log.address.toLowerCase(),
        amount: (log.args.value ?? 0n).toString(),
        fromAddress: fromAddr,
        blockNumber: log.blockNumber,
        occurredAt: blockTime.get(log.blockNumber) ?? new Date(), // in-range blocks are all mapped
      });
    }

    await this.prisma.chainCursor.upsert({
      where: { name: CURSOR },
      create: { name: CURSOR, value: to },
      update: { value: to },
    });
    if (count > 0) this.logger.log(`indexed ${count} inbound transfer(s) [blocks ${from}..${to}]`);
  }

  /** Insert one received transfer; returns 1 if new, 0 if it was already indexed (unique conflict).
   *  `occurredAt` (the on-chain block time) becomes `createdAt` — NOT now() — so a backfilled
   *  transfer from yesterday sorts/shows as yesterday, not as its indexing moment. */
  private async record(t: {
    walletId: string;
    txHash: string;
    logIndex: number;
    asset: string;
    amount: string;
    fromAddress: string;
    blockNumber: bigint;
    occurredAt: Date;
  }): Promise<number> {
    const { occurredAt, ...row } = t;
    try {
      await this.prisma.receivedTransfer.create({ data: { ...row, createdAt: occurredAt } });
      return 1;
    } catch (e) {
      // Only a P2002 unique conflict means "already indexed" (idempotent re-scan) → skip quietly.
      // Any other error (transient DB failure, etc.) must propagate so the tick aborts WITHOUT
      // advancing the cursor — otherwise this block range is never re-scanned and the transfer is
      // lost. Mirrors TransactionsService.onUniqueConflict.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 0;
      throw e;
    }
  }
}
