import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { SIGNER, type Signer } from '../signer/signer';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SIGNER) private readonly signer: Signer,
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
    return wallet;
  }

  list(userId: string) {
    return this.prisma.wallet.findMany({
      where: { userId },
      select: { id: true, address: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
