import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { NATIVE_ASSET, type Hex, type SendTransactionInput } from '@vencura/shared';
import { encodeFunctionData, erc20Abi } from 'viem';
import { ChainService } from '../infra/chain/chain.service';
import { LOCK, type Lock } from '../infra/lock/lock';
import { PrismaService } from '../infra/prisma/prisma.service';
import { PolicyEngine } from '../policy/policy.engine';
import { SIGNER, type Signer } from '../signer/signer';
import { WalletsService } from '../wallets/wallets.service';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
    private readonly policy: PolicyEngine,
    private readonly wallets: WalletsService,
    @Inject(LOCK) private readonly lock: Lock,
    @Inject(SIGNER) private readonly signer: Signer,
  ) {}

  async send(walletId: string, userId: string, dto: SendTransactionInput, idempotencyKey?: string) {
    const wallet = await this.wallets.findOwnedOrThrow(walletId, userId);
    await this.policy.assertAllowed(walletId, dto);

    return this.lock.withWalletLock(walletId, async () => {
      // Idempotency check INSIDE the lock: serialized with the create below, so two
      // concurrent requests with the same key can't both broadcast (the second sees
      // the first's row and returns it). The @unique constraint is the backstop.
      if (idempotencyKey) {
        const existing = await this.prisma.transaction.findUnique({ where: { idempotencyKey } });
        if (existing) return this.shape(existing);
      }
      const w = await this.prisma.wallet.findUnique({ where: { id: walletId } });
      const pending = await this.chain.getPendingNonce(wallet.address as Hex);
      const nonce = Math.max(pending, w!.nextNonce);
      this.logger.log(`nonce acquired: ${walletId} → ${nonce}`);

      const built =
        dto.asset === NATIVE_ASSET
          ? { from: wallet.address as Hex, to: dto.to as Hex, value: BigInt(dto.amount), nonce }
          : {
              from: wallet.address as Hex,
              to: dto.asset as Hex, // token contract
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transfer',
                args: [dto.to as Hex, BigInt(dto.amount)],
              }),
              nonce,
            };

      const request = await this.chain.prepareTransaction(built);
      const raw = (await this.signer.signTransaction(walletId, request)) as Hex;
      let txHash: Hex;
      try {
        txHash = await this.chain.sendRawTransaction(raw);
      } catch (e) {
        this.logger.warn(`broadcast failed (nonce ${nonce} not consumed): ${(e as Error).message}`);
        throw new BadRequestException((e as Error).message);
      }
      this.logger.log(`tx broadcast: ${txHash} (nonce ${nonce})`);

      const row = await this.prisma.transaction.create({
        data: {
          walletId,
          idempotencyKey: idempotencyKey ?? null,
          nonce,
          status: 'pending',
          asset: dto.asset,
          amount: dto.amount,
          toAddress: dto.to,
          fromAddress: wallet.address,
          txHash,
        },
      });
      await this.prisma.wallet.update({ where: { id: walletId }, data: { nextNonce: nonce + 1 } });
      this.logger.log(`nonce released: ${walletId}`);
      return this.shape(row);
    });
  }

  list(walletId: string, userId: string) {
    return this.wallets
      .findOwnedOrThrow(walletId, userId)
      .then(() =>
        this.prisma.transaction.findMany({ where: { walletId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      );
  }

  private shape(t: { id: string; txHash: string | null; status: string; nonce: number | null }) {
    return { id: t.id, txHash: t.txHash, status: t.status, nonce: t.nonce };
  }
}
