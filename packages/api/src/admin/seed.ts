// Demo seed routine: one user with one wallet. Idempotent on the demo email.
// Reused by `pnpm db:seed` (prisma/seed.ts) and the dev-gated POST /admin/seed.
// Funding is NOT done here — the master wallet is funded externally via a Sepolia faucet.
import type { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { ADMIN_EMAIL, DEMO_PASSWORD, type Hex, type SeedResult } from '@vencura/shared';
import { encrypt } from '../signer/aes-256-gcm';

const WALLET_COUNT = 1; // one wallet per account

function masterKey(): Buffer {
  const hex = process.env.MASTER_ENCRYPTION_KEY ?? '';
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('MASTER_ENCRYPTION_KEY must be 32 bytes of hex (64 hex chars)');
  return key;
}

/** A fixed demo private key (DEMO_FUNDED_PRIVKEY) so the demo wallet's address is stable
 *  across re-seeds and stays funded; null if unset/invalid → fall back to a random key. */
function demoFundedKey(): Hex | null {
  const k = process.env.DEMO_FUNDED_PRIVKEY ?? '';
  return /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : null;
}

/** Create the demo user + wallets. Idempotent: wipes the demo user's wallets first. */
export async function seedDemo(prisma: PrismaClient): Promise<SeedResult> {
  const key = masterKey();
  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: { email: ADMIN_EMAIL, passwordHash, isDemo: true },
    update: { passwordHash, isDemo: true },
  });
  // Re-seed cleanly: drop any prior demo wallets (cascades txs/balances).
  await prisma.wallet.deleteMany({ where: { userId: user.id } });

  const wallets: SeedResult['wallets'] = [];
  for (let i = 0; i < WALLET_COUNT; i++) {
    // Wallet 0 (the funded sender wallet) uses a fixed key from DEMO_FUNDED_PRIVKEY when set,
    // so its address is STABLE across re-seeds/resets — fund it once on a faucet and the funds
    // persist (they live on-chain at the address, not in the DB). Other wallets stay random.
    const privateKey = i === 0 ? (demoFundedKey() ?? generatePrivateKey()) : generatePrivateKey();
    const address = privateKeyToAddress(privateKey);
    const wallet = await prisma.wallet.create({
      data: { userId: user.id, address, ...encrypt(privateKey, key) },
      select: { id: true, address: true },
    });
    wallets.push(wallet);
  }

  return { email: ADMIN_EMAIL, password: DEMO_PASSWORD, wallets };
}
