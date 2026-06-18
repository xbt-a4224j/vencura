import { Injectable, Logger } from '@nestjs/common';
import sss from 'shamirs-secret-sharing';
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from 'viem/accounts';
import type { Hex } from '@vencura/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { decrypt, encrypt } from './aes-256-gcm';
import type { NewKey, Signer } from './signer';

/**
 * Bonus custody model (drop-in behind the `Signer` seam): the private key is split
 * into a **2-of-2 Shamir share pair**, so the whole key is NEVER stored — only the two
 * shares are, and a single share reveals nothing (information-theoretic, unlike an
 * encrypted blob). It's reconstructed in memory only at sign time, then zeroized.
 *
 * Storage reuses the existing envelope columns (no schema change): `encryptedPrivateKey`
 * holds `shareA . encrypted(shareB)` — shareA as plaintext (useless alone), shareB
 * encrypted with the master key (the iv/authTag columns are shareB's). So a DB dump alone
 * can't reconstruct (it lacks the master key for shareB) and the master key alone can't
 * (it lacks the DB). The honest next step toward real trust-domain separation is MPC/HSM
 * (see docs/SECURITY.md) — this demonstrates the primitive and that the seam swaps cleanly.
 */
@Injectable()
export class ShamirSigner implements Signer {
  private readonly logger = new Logger(ShamirSigner.name);
  private readonly masterKey: Buffer;

  constructor(private readonly prisma: PrismaService) {
    const hex = process.env.MASTER_ENCRYPTION_KEY ?? '';
    this.masterKey = Buffer.from(hex, 'hex');
    if (this.masterKey.length !== 32) {
      throw new Error('MASTER_ENCRYPTION_KEY must be 32 bytes of hex (64 hex chars)');
    }
  }

  async createKey(): Promise<NewKey> {
    const privateKey = generatePrivateKey();
    const address = privateKeyToAddress(privateKey);
    const [shareA, shareB] = sss.split(Buffer.from(privateKey, 'utf8'), { shares: 2, threshold: 2 });
    // Encrypt only shareB with the master key; shareA stays plaintext (an SSS share is opaque).
    const encB = encrypt(shareB.toString('hex'), this.masterKey);
    this.logger.log(`generated 2-of-2 Shamir key for ${address}`);
    return {
      address,
      encryptedPrivateKey: `${shareA.toString('hex')}.${encB.encryptedPrivateKey}`,
      encryptionIv: encB.encryptionIv,
      encryptionAuthTag: encB.encryptionAuthTag,
    };
  }

  async getAddress(walletId: string): Promise<string> {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { id: walletId },
      select: { address: true },
    });
    return wallet.address;
  }

  signMessage(walletId: string, message: string): Promise<string> {
    return this.withReconstructedKey(walletId, (account) => account.signMessage({ message }));
  }

  signTransaction(walletId: string, request: unknown): Promise<string> {
    return this.withReconstructedKey(walletId, (account) =>
      account.signTransaction(request as Parameters<typeof account.signTransaction>[0]),
    );
  }

  /** Reconstruct the key from its two shares transiently, run fn, then zeroize. */
  private async withReconstructedKey<T>(
    walletId: string,
    fn: (account: ReturnType<typeof privateKeyToAccount>) => Promise<T>,
  ): Promise<T> {
    const row = await this.prisma.wallet.findUniqueOrThrow({
      where: { id: walletId },
      select: { encryptedPrivateKey: true, encryptionIv: true, encryptionAuthTag: true },
    });
    const [shareAHex, encryptedShareB] = row.encryptedPrivateKey.split('.');
    const shareA = Buffer.from(shareAHex, 'hex');
    const shareB = Buffer.from(
      decrypt({ ...row, encryptedPrivateKey: encryptedShareB }, this.masterKey).toString('utf8'),
      'hex',
    );
    const keyBuf = sss.combine([shareA, shareB]); // the private key, transiently
    try {
      const account = privateKeyToAccount(keyBuf.toString('utf8') as Hex);
      this.logger.log(`signed via reconstructed Shamir key: ${walletId}`);
      return await fn(account);
    } finally {
      keyBuf.fill(0);
      shareB.fill(0);
    }
  }
}
