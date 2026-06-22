// Seed routine: the system admin/master account + its single wallet. Idempotent on ADMIN_EMAIL.
// Reused by `pnpm db:seed` (prisma/seed.ts) and the dev-gated POST /admin/reset.
// Funding is NOT done here — the master wallet is funded externally via a Sepolia faucet.
import type { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { ADMIN_EMAIL, SEED_PASSWORD, type Hex, type SeedResult } from '@vencura/shared';
import { encrypt } from '../signer/aes-256-gcm';

const WALLET_COUNT = 1; // one wallet per account

function masterKey(): Buffer {
  const hex = process.env.MASTER_ENCRYPTION_KEY ?? '';
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('MASTER_ENCRYPTION_KEY must be 32 bytes of hex (64 hex chars)');
  return key;
}

/** The fixed master wallet private key (MASTER_WALLET_PRIVKEY) so its address is stable across
 *  re-seeds and stays faucet-funded; null if unset/invalid → fall back to a random key. */
function masterWalletKey(): Hex | null {
  const k = process.env.MASTER_WALLET_PRIVKEY ?? '';
  return /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : null;
}

/** Create the admin/master account + wallet. Idempotent: wipes its prior wallets first. */
export async function seedMaster(prisma: PrismaClient): Promise<SeedResult> {
  const key = masterKey();
  const passwordHash = await argon2.hash(SEED_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: { email: ADMIN_EMAIL, passwordHash, isSystem: true },
    update: { passwordHash, isSystem: true },
  });
  // Re-seed cleanly: drop any prior wallets (cascades txs/balances).
  await prisma.wallet.deleteMany({ where: { userId: user.id } });

  const wallets: SeedResult['wallets'] = [];
  for (let i = 0; i < WALLET_COUNT; i++) {
    // Wallet 0 (the funded sender wallet) uses a fixed key from MASTER_WALLET_PRIVKEY when set,
    // so its address is STABLE across re-seeds/resets — fund it once on a faucet and the funds
    // persist (they live on-chain at the address, not in the DB). Other wallets stay random.
    const privateKey = i === 0 ? (masterWalletKey() ?? generatePrivateKey()) : generatePrivateKey();
    const address = privateKeyToAddress(privateKey);
    const wallet = await prisma.wallet.create({
      data: { userId: user.id, address, ...encrypt(privateKey, key) },
      select: { id: true, address: true },
    });
    wallets.push(wallet);
  }

  return { email: ADMIN_EMAIL, password: SEED_PASSWORD, wallets };
}
