// Demo seed routine: one user, a few funded wallets, a sample policy. Idempotent on the
// demo email. Reused by `pnpm db:seed` (prisma/seed.ts) and the dev-gated POST /admin/seed.
import type { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createTestClient, http, parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { DEMO_PASSWORD, type Hex } from '@vencura/shared';
import { encrypt } from '../signer/aes-256-gcm';

const DEMO_EMAIL = 'demo@vencura.local';
// Peer demo accounts: so the User-view picker has accounts to switch between and "pay someone"
// has real counterparties. All use the shared demo password (isDemo) → every picker entry works.
// Unfunded by design (there's one funded key) — they receive + demonstrate switching.
const PEER_EMAILS = ['alice@vencura.local', 'bob@vencura.local'];
const WALLET_COUNT = 3;
// A well-known recipient (vitalik.eth) so the allowlist dropdown has an external option.
const KNOWN_RECIPIENT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

export interface SeedResult {
  email: string;
  password: string;
  wallets: { id: string; address: string; funded: boolean }[];
}

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

/** Best-effort fund a wallet on a local anvil node; no-op (logged) on a real RPC. */
async function fundOnAnvil(address: `0x${string}`): Promise<boolean> {
  const test = createTestClient({ mode: 'anvil', transport: http(process.env.RPC_URL!) });
  try {
    await test.setBalance({ address, value: parseEther('10') });
    return true;
  } catch {
    console.log('funding skipped (non-anvil RPC)');
    return false;
  }
}

/** Create the demo user + wallets + policy. Idempotent: wipes the demo user's wallets first. */
export async function seedDemo(prisma: PrismaClient): Promise<SeedResult> {
  const key = masterKey();
  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: { email: DEMO_EMAIL, passwordHash, isDemo: true },
    update: { passwordHash, isDemo: true },
  });
  // Re-seed cleanly: drop any prior demo wallets (cascades policies/txs/balances).
  await prisma.wallet.deleteMany({ where: { userId: user.id } });

  const wallets: SeedResult['wallets'] = [];
  for (let i = 0; i < WALLET_COUNT; i++) {
    // Wallet 0 (the policy/sender wallet) uses a fixed key from DEMO_FUNDED_PRIVKEY when set,
    // so its address is STABLE across re-seeds/resets — fund it once on a faucet and the funds
    // persist (they live on-chain at the address, not in the DB). Other wallets stay random.
    const privateKey = i === 0 ? (demoFundedKey() ?? generatePrivateKey()) : generatePrivateKey();
    const address = privateKeyToAddress(privateKey);
    const wallet = await prisma.wallet.create({
      data: { userId: user.id, address, ...encrypt(privateKey, key) },
      select: { id: true, address: true },
    });
    const funded = await fundOnAnvil(address as `0x${string}`);
    wallets.push({ ...wallet, funded });
  }

  // Policy on the first wallet: allow sends to the other demo wallets + the known recipient.
  const [first, ...rest] = wallets;
  const allowlist = [...rest.map((w) => w.address), KNOWN_RECIPIENT];
  const limits = { perTxLimit: parseEther('5').toString(), dailyLimit: parseEther('8').toString() };
  await prisma.walletPolicy.upsert({
    where: { walletId: first.id },
    create: { walletId: first.id, allowlist, ...limits },
    update: { allowlist, ...limits },
  });

  // Peer demo accounts (alice/bob): one wallet each, unfunded, shared demo password. They give the
  // picker accounts to switch to and populate the "pay someone" directory.
  for (const email of PEER_EMAILS) {
    const peer = await prisma.user.upsert({
      where: { email },
      create: { email, passwordHash, isDemo: true },
      update: { passwordHash, isDemo: true },
    });
    await prisma.wallet.deleteMany({ where: { userId: peer.id } });
    const pk = generatePrivateKey();
    await prisma.wallet.create({
      data: { userId: peer.id, address: privateKeyToAddress(pk), ...encrypt(pk, key) },
    });
  }

  return { email: DEMO_EMAIL, password: DEMO_PASSWORD, wallets };
}
