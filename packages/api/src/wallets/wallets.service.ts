import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { EventsService } from '../infra/events/events.service';
import { SIGNER, type Signer } from '../signer/signer';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SIGNER) private readonly signer: Signer,
    private readonly events: EventsService,
  ) {}

  async create(userId: string): Promise<{ id: string; address: string }> {
    // createKey returns { address, encryptedPrivateKey, encryptionIv, encryptionAuthTag } —
    // the column shape, so it spreads straight into the wallet row.
    const key = await this.signer.createKey();
    const wallet = await this.prisma.wallet.create({
      data: { userId, ...key },
      select: { id: true, address: true },
    });
    this.logger.log(`wallet created: ${wallet.address} (user ${userId})`);
    await this.events.record({
      userId,
      walletId: wallet.id,
      type: 'wallet.created',
      detail: { address: wallet.address },
      msg: `wallet created: ${wallet.address}`,
    });
    return wallet;
  }

  list(userId: string) {
    return this.prisma.wallet.findMany({
      where: { userId },
      select: { id: true, address: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Every wallet across all users (address + owner email) — the admin's holder picker for the
   *  token flow, so the operator can pick a real platform holder instead of pasting an address. */
  async listHolders(): Promise<{ address: string; email: string }[]> {
    const wallets = await this.prisma.wallet.findMany({
      select: { address: true, user: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return wallets.map((w) => ({ address: w.address, email: w.user.email }));
  }

  /** Authz seam: resolve a wallet only if it belongs to the user. 404 (not 403) → no ownership
   *  enumeration. Reused by balances + transactions so the ownership check lives in one place. */
  async findOwnedOrThrow(walletId: string, userId: string): Promise<{ id: string; address: string }> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, userId },
      select: { id: true, address: true },
    });
    if (!wallet) throw new NotFoundException('wallet not found');
    return wallet;
  }
}
