import { Injectable, Logger } from '@nestjs/common';
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from 'viem/accounts';
import type { Hex } from '@vencura/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { decrypt, encrypt } from './aes-256-gcm';
import type { NewKey, Signer } from './signer';

/** Default custody model: the private key is AES-256-GCM-encrypted with the env
 *  master key and stored decomposed on the wallet row. Decrypted in memory only at
 *  sign time (T-012+), never logged, never returned by the API. */
@Injectable()
export class EncryptedKeySigner implements Signer {
  private readonly logger = new Logger(EncryptedKeySigner.name);
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
    const envelope = encrypt(privateKey, this.masterKey);
    this.logger.log(`generated encrypted key for ${address}`);
    return { address, ...envelope };
  }

  async getAddress(walletId: string): Promise<string> {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { id: walletId },
      select: { address: true },
    });
    return wallet.address;
  }

  async signMessage(walletId: string, message: string): Promise<string> {
    const envelope = await this.prisma.wallet.findUniqueOrThrow({
      where: { id: walletId },
      select: { encryptedPrivateKey: true, encryptionIv: true, encryptionAuthTag: true },
    });
    const keyBuf = decrypt(envelope, this.masterKey);
    try {
      const account = privateKeyToAccount(keyBuf.toString('utf8') as Hex);
      this.logger.log(`message signed: ${walletId}`);
      return await account.signMessage({ message });
    } finally {
      keyBuf.fill(0); // zeroize the decrypted key buffer after signing
    }
  }

  async signTransaction(walletId: string, request: unknown): Promise<string> {
    const envelope = await this.prisma.wallet.findUniqueOrThrow({
      where: { id: walletId },
      select: { encryptedPrivateKey: true, encryptionIv: true, encryptionAuthTag: true },
    });
    const keyBuf = decrypt(envelope, this.masterKey);
    try {
      const account = privateKeyToAccount(keyBuf.toString('utf8') as Hex);
      // request is a prepared viem transaction request
      this.logger.log(`transaction signed: ${walletId}`);
      return await account.signTransaction(request as Parameters<typeof account.signTransaction>[0]);
    } finally {
      keyBuf.fill(0); // zeroize the decrypted key buffer after signing
    }
  }
}
