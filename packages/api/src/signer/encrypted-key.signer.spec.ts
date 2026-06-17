import { Test } from '@nestjs/testing';
import { privateKeyToAddress } from 'viem/accounts';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../infra/prisma/prisma.service';
import { decrypt } from './aes-256-gcm';
import { EncryptedKeySigner } from './encrypted-key.signer';

const prismaMock = { wallet: { findUniqueOrThrow: vi.fn() } };
const MASTER = 'a'.repeat(64); // 32 bytes hex

describe('EncryptedKeySigner', () => {
  let signer: EncryptedKeySigner;

  beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = MASTER;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [EncryptedKeySigner, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    signer = moduleRef.get(EncryptedKeySigner);
  });

  it('createKey returns a valid address whose key decrypts back', async () => {
    const key = await signer.createKey();
    expect(key.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const privateKey = decrypt(key, Buffer.from(MASTER, 'hex')).toString('utf8');
    expect(privateKeyToAddress(privateKey as `0x${string}`)).toBe(key.address);
  });

  it('getAddress reads the stored address and never returns key material', async () => {
    prismaMock.wallet.findUniqueOrThrow.mockResolvedValue({ address: '0xabc' });
    await expect(signer.getAddress('w1')).resolves.toBe('0xabc');
  });

  it('fails fast when MASTER_ENCRYPTION_KEY is malformed', async () => {
    process.env.MASTER_ENCRYPTION_KEY = 'too-short';
    // Nest instantiates singleton providers eagerly during compile(), so the
    // constructor's key-length check rejects the compile promise.
    await expect(
      Test.createTestingModule({
        providers: [EncryptedKeySigner, { provide: PrismaService, useValue: prismaMock }],
      }).compile(),
    ).rejects.toThrow();
    process.env.MASTER_ENCRYPTION_KEY = MASTER;
  });
});
