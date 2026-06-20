/**
 * Example: send a native ETH transaction and wait for it to confirm — in one call.
 *   pnpm --filter @vencura/api db:seed          # first: seed funded demo wallets (anvil)
 *   pnpm --filter @vencura/sdk exec tsx examples/04-send-transaction.ts
 *
 * Uses the seeded demo user, whose wallets are funded on the local anvil node.
 * Amounts are ALWAYS base units (wei) as strings — never floats. `sendAndConfirm`
 * generates an idempotency key (so a retry can't double-broadcast) and polls the
 * confirmation watcher until the tx leaves `pending`.
 */
import { parseEther } from 'viem';
import { NATIVE_ASSET, Vencura } from '../src';

async function main() {
  const v = new Vencura();
  await v.auth.login({ email: 'admin@vencura.local', password: 'demo-password' });

  const wallets = await v.wallets.list();
  if (wallets.length < 2) throw new Error('run `pnpm --filter @vencura/api db:seed` first');
  const [sender, recipient] = wallets;

  // Broadcast 0.01 ETH (in wei) and wait for confirmation — one await.
  const tx = await v.transactions.sendAndConfirm({
    walletId: sender.id,
    to: recipient.address,
    asset: NATIVE_ASSET,
    amount: parseEther('0.01').toString(),
  });
  console.log(`confirmed: nonce=${tx.nonce} hash=${tx.txHash} status=${tx.status}`);
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
