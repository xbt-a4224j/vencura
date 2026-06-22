import { Inject, Injectable, Logger } from '@nestjs/common';
import { NATIVE_ASSET, type Hex } from '@vencura/shared';
import { parseEther } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';
import { ChainService } from '../infra/chain/chain.service';
import { LOCK, type Lock } from '../infra/lock/lock';
import { PrismaService } from '../infra/prisma/prisma.service';
import { SIGNER, type Signer } from '../signer/signer';
import { WalletsService } from './wallets.service';

/** Seed funding handed to each freshly provisioned wallet from the master wallet. */
const PROVISION_ETH = parseEther('0.001');

/**
 * One wallet per account. On first sign-in the web calls POST /wallets/provision:
 * we create the user's single wallet (if absent) and seed it with a small amount of
 * ETH from a STATIC master wallet — serialized on the master's nonce via the same
 * advisory lock the send path uses, so concurrent provisioning can't double-spend a nonce.
 */
@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
    private readonly chain: ChainService,
    @Inject(LOCK) private readonly lock: Lock,
    @Inject(SIGNER) private readonly signer: Signer,
  ) {}

  /** The master wallet that funds new accounts: the wallet at the address derived from the
   *  configured master key. Sepolia-only — the key is REQUIRED; we fail fast if it's unset or
   *  invalid rather than silently leaving wallets unfunded. Returns null only when the key is
   *  valid but its wallet row hasn't been seeded yet. */
  async findMaster(): Promise<{ id: string; address: string } | null> {
    const priv = process.env.MASTER_WALLET_PRIVKEY ?? '';
    if (!/^0x[0-9a-fA-F]{64}$/.test(priv)) {
      throw new Error('master wallet key (MASTER_WALLET_PRIVKEY) is not configured');
    }
    const address = privateKeyToAddress(priv as Hex);
    const w = await this.prisma.wallet.findFirst({ where: { address }, select: { id: true, address: true } });
    if (!w) this.logger.warn(`master address ${address} has no wallet row yet`);
    return w;
  }

  /** Idempotent: if the user already has a wallet, return it (no second fund). */
  async provision(userId: string): Promise<{ id: string; address: string }> {
    const existing = await this.prisma.wallet.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, address: true },
    });
    if (existing) return existing;

    const wallet = await this.wallets.create(userId);
    this.logger.log(`provisioned wallet ${wallet.address} for user ${userId}`);
    await this.fundFromMaster(wallet.address as Hex);
    return wallet;
  }

  /** SYSTEM transfer of PROVISION_ETH from the master wallet to `to`, serialized on the
   *  master wallet's nonce. Best-effort: a gasless/missing master logs and leaves it unfunded. */
  private async fundFromMaster(to: Hex): Promise<void> {
    const master = await this.findMaster();
    if (!master) {
      this.logger.warn(`no master wallet — leaving ${to} unfunded`);
      return;
    }
    if (master.address.toLowerCase() === to.toLowerCase()) return; // master funding itself: skip

    await this.lock.withWalletLock(master.id, async () => {
      try {
        const w = await this.prisma.wallet.findUnique({ where: { id: master.id } });
        const pending = await this.chain.getPendingNonce(master.address as Hex);
        const nonce = Math.max(pending, w!.nextNonce);
        this.logger.log(`master nonce acquired: ${master.id} → ${nonce}`);

        const request = await this.chain.prepareTransaction({
          from: master.address as Hex,
          to,
          value: PROVISION_ETH,
          nonce,
        });
        const raw = (await this.signer.signTransaction(master.id, request)) as Hex;
        const txHash = await this.chain.sendRawTransaction(raw);
        this.logger.log(`master funded ${to} with 0.001 ETH: ${txHash} (nonce ${nonce})`);

        await this.prisma.transaction.create({
          data: {
            walletId: master.id,
            idempotencyKey: null,
            nonce,
            status: 'pending',
            asset: NATIVE_ASSET,
            amount: PROVISION_ETH.toString(),
            toAddress: to,
            fromAddress: master.address,
            txHash,
          },
        });
        await this.prisma.wallet.update({ where: { id: master.id }, data: { nextNonce: nonce + 1 } });
        this.logger.log(`master nonce released: ${master.id}`);
      } catch (e) {
        this.logger.warn(`master funding failed for ${to}: ${(e as Error).message}`);
      }
    });
  }
}
