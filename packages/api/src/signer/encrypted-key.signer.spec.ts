import { Test } from '@nestjs/testing';
import { verifyMessage } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../infra/prisma/prisma.service';
import { decrypt, encrypt } from './aes-256-gcm';
import { EncryptedKeySigner } from './encrypted-key.signer';

// Well-known Foundry/Hardhat account #0 — a stable EIP-191 vector.
const KNOWN_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const KNOWN_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const prismaMock = { wallet: { findUniqueOrThrow: vi.fn() } };
const MASTER = 'a'.repeat(64); // 32 bytes hex

describe('EncryptedKeySigner', () => {
  let signer: EncryptedKeySigner;

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

  describe('signMessage', () => {
    beforeEach(() => {
      // store the known key as the wallet's encrypted envelope
      const envelope = encrypt(KNOWN_PK, Buffer.from(MASTER, 'hex'));
      prismaMock.wallet.findUniqueOrThrow.mockResolvedValue(envelope);
    });

    it('produces an EIP-191 signature that recovers to the wallet address', async () => {
      const signature = await signer.signMessage('w1', 'hello vencura');
      expect(
        await verifyMessage({ address: KNOWN_ADDR, message: 'hello vencura', signature: signature as `0x${string}` }),
      ).toBe(true);
    });

    it('is deterministic for the same key + message', async () => {
      const a = await signer.signMessage('w1', 'hello vencura');
      const b = await signer.signMessage('w1', 'hello vencura');
      expect(a).toBe(b);
    });
  });

  describe('signTransaction', () => {
    // A fully-prepared EIP-1559 request (the shape ChainService.prepareTransactionRequest returns).
    const request = {
      type: 'eip1559',
      chainId: 11155111,
      to: KNOWN_ADDR,
      value: 1n,
      nonce: 0,
      gas: 21000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    };

    beforeEach(() => {
      const envelope = encrypt(KNOWN_PK, Buffer.from(MASTER, 'hex'));
      prismaMock.wallet.findUniqueOrThrow.mockResolvedValue(envelope);
    });

    it('returns a deterministic 0x-serialized signed transaction', async () => {
      const a = await signer.signTransaction('w1', request);
      const b = await signer.signTransaction('w1', request);
      expect(a).toMatch(/^0x[0-9a-fA-F]+$/);
      expect(a).toBe(b);
    });
  });
});
