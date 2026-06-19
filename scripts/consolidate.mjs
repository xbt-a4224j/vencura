#!/usr/bin/env node
/**
 * consolidate.mjs — manual ops tool (NOT wired into the app).
 *
 * Sweeps spendable native ETH from every NON-master wallet back to the master wallet,
 * leaving a gas reserve behind. Useful after a demo to reclaim the seed funding handed
 * out by POST /wallets/provision (PROVISION_ETH per account).
 *
 * The master wallet is the one at privateKeyToAddress(DEMO_FUNDED_PRIVKEY) when that env
 * is set; otherwise the demo user's oldest wallet (matches ProvisioningService.findMaster).
 *
 * Reads private keys straight from Postgres and decrypts them with MASTER_ENCRYPTION_KEY
 * (AES-256-GCM), exactly like the API's signer — so it needs the same env the API uses.
 *
 * Usage (from repo root):
 *   node --env-file=.env scripts/consolidate.mjs            # dry run (prints plan)
 *   node --env-file=.env scripts/consolidate.mjs --execute  # actually sweep
 *
 * Requires: DATABASE_URL, RPC_URL, MASTER_ENCRYPTION_KEY, and (optionally) DEMO_FUNDED_PRIVKEY.
 */
import { createDecipheriv } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createPublicClient, createWalletClient, formatEther, http } from 'viem';
import { privateKeyToAccount, privateKeyToAddress } from 'viem/accounts';

const EXECUTE = process.argv.includes('--execute');
const GAS_RESERVE = 2_000_000_000_000_000n; // 0.002 ETH kept behind for gas

function masterKeyBuf() {
  const hex = process.env.MASTER_ENCRYPTION_KEY ?? '';
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('MASTER_ENCRYPTION_KEY must be 32 bytes of hex');
  return key;
}

function decryptKey(row, master) {
  const decipher = createDecipheriv('aes-256-gcm', master, Buffer.from(row.encryptionIv, 'hex'));
  decipher.setAuthTag(Buffer.from(row.encryptionAuthTag, 'hex'));
  const out = Buffer.concat([
    decipher.update(Buffer.from(row.encryptedPrivateKey, 'hex')),
    decipher.final(),
  ]);
  return out.toString('utf8');
}

async function masterAddress(prisma) {
  const priv = process.env.DEMO_FUNDED_PRIVKEY ?? '';
  if (/^0x[0-9a-fA-F]{64}$/.test(priv)) return privateKeyToAddress(priv).toLowerCase();
  const demo = await prisma.user.findUnique({ where: { email: 'demo@vencura.local' } });
  if (!demo) return null;
  const w = await prisma.wallet.findFirst({ where: { userId: demo.id }, orderBy: { createdAt: 'asc' } });
  return w ? w.address.toLowerCase() : null;
}

async function main() {
  const master = masterKeyBuf();
  const prisma = new PrismaClient();
  const transport = http(process.env.RPC_URL);
  const pub = createPublicClient({ transport });

  const masterAddr = await masterAddress(prisma);
  if (!masterAddr) throw new Error('could not locate a master wallet');
  console.log(`master: ${masterAddr}`);
  console.log(`mode: ${EXECUTE ? 'EXECUTE' : 'dry-run (pass --execute to sweep)'}\n`);

  const wallets = await prisma.wallet.findMany();
  let swept = 0n;
  for (const w of wallets) {
    if (w.address.toLowerCase() === masterAddr) continue;
    const balance = await pub.getBalance({ address: w.address });
    const spendable = balance - GAS_RESERVE;
    if (spendable <= 0n) {
      console.log(`skip  ${w.address}  balance=${formatEther(balance)} ETH (below gas reserve)`);
      continue;
    }
    console.log(`sweep ${w.address}  ${formatEther(spendable)} ETH → master`);
    swept += spendable;
    if (!EXECUTE) continue;

    const account = privateKeyToAccount(decryptKey(w, master));
    const client = createWalletClient({ account, transport });
    const gas = 21_000n;
    const gasPrice = await pub.getGasPrice();
    const value = spendable - gas * gasPrice;
    if (value <= 0n) {
      console.log(`  -> not enough to cover gas, skipping`);
      continue;
    }
    const hash = await client.sendTransaction({ to: masterAddr, value, gas, gasPrice, chain: null });
    console.log(`  -> ${hash}`);
  }

  console.log(`\n${EXECUTE ? 'swept' : 'would sweep'} ~${formatEther(swept)} ETH to master across ${wallets.length - 1} wallet(s)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
