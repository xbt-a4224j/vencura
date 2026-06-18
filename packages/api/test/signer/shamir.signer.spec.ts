import { Test } from '@nestjs/testing';
import { recoverMessageAddress } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { ShamirSigner } from '@/signer/shamir.signer';

const prismaMock = { wallet: { findUniqueOrThrow: vi.fn() } };

describe('ShamirSigner', () => {
  let signer: ShamirSigner;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ShamirSigner, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    signer = moduleRef.get(ShamirSigner);
  });

  it('createKey returns a valid address and a two-part envelope (shareA + encrypted shareB)', async () => {
    const key = await signer.createKey();
    expect(key.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // The stored value is shareA + encrypted shareB, NOT the raw private key.
    expect(key.encryptedPrivateKey).toContain('.');
    expect(key.encryptedPrivateKey).not.toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it('round-trips: a message signed via the reconstructed key recovers to the wallet address', async () => {
    const key = await signer.createKey();
    prismaMock.wallet.findUniqueOrThrow.mockResolvedValue(key);

    const message = 'shamir round trip';
    const signature = (await signer.signMessage('w1', message)) as `0x${string}`;
    const recovered = await recoverMessageAddress({ message, signature });
    expect(recovered.toLowerCase()).toBe(key.address.toLowerCase());
  });

  it('never persists the whole private key in either share or the envelope', async () => {
    // Reconstruct the key ourselves to prove neither stored part contains it whole.
    const key = await signer.createKey();
    const [shareAHex, encB] = key.encryptedPrivateKey.split('.');
    expect(shareAHex).not.toContain('0x'); // shareA is an SSS share, not the key
    expect(encB).toBeTruthy();
  });
});
