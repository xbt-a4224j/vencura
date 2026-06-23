import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NATIVE_ASSET, type WalletOverview } from '@vencura/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { EventsService } from '../infra/events/events.service';
import { SignerRegistry } from '../signer/signer-registry.service';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SignerRegistry,
    private readonly events: EventsService,
  ) {}

  async create(userId: string, scheme = 'encrypted'): Promise<{ id: string; address: string; signerScheme: string }> {
    const key = await this.registry.get(scheme).createKey();
    const wallet = await this.prisma.wallet.create({
      data: { userId, signerScheme: scheme, ...key },
      select: { id: true, address: true, signerScheme: true },
    });
    this.logger.log(`wallet created: ${wallet.address} (user ${userId}, scheme ${scheme})`);
    await this.events.record({
      userId,
      walletId: wallet.id,
      type: 'wallet.created',
      detail: { address: wallet.address, scheme },
      msg: `wallet created: ${wallet.address}`,
    });
    return wallet;
  }

  list(userId: string) {
    return this.prisma.wallet.findMany({
      where: { userId },
      select: { id: true, address: true, signerScheme: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Admin operator console: every platform wallet with owner email, cached ETH balance, and a
   *  `self` flag (the operator's own wallet — the only one it can act on). Read-only projection
   *  from Postgres; no chain calls. Gated to the admin identity at the controller. */
  async listAll(adminUserId: string): Promise<WalletOverview[]> {
    const wallets = await this.prisma.wallet.findMany({
      select: {
        id: true,
        address: true,
        userId: true,
        signerScheme: true,
        user: { select: { email: true } },
        balances: { where: { asset: NATIVE_ASSET }, select: { confirmed: true, asOfBlock: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return wallets.map((w) => ({
      id: w.id,
      address: w.address,
      email: w.user.email,
      self: w.userId === adminUserId,
      confirmed: w.balances[0]?.confirmed ?? '0',
      asOfBlock: w.balances[0]?.asOfBlock ?? null,
      signerScheme: w.signerScheme,
    }));
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
  async findOwnedOrThrow(walletId: string, userId: string): Promise<{ id: string; address: string; signerScheme: string }> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, userId },
      select: { id: true, address: true, signerScheme: true },
    });
    if (!wallet) throw new NotFoundException('wallet not found');
    return wallet;
  }
}
