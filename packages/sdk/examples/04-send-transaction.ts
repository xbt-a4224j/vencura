/**
 * Example: send a native ETH transaction between two wallets, then watch it confirm.
 *   pnpm --filter @vencura/api db:seed          # first: seed funded demo wallets (anvil)
 *   pnpm --filter @vencura/sdk exec tsx examples/04-send-transaction.ts
 *
 * Uses the seeded demo user, whose wallets are funded on the local anvil node.
 * Amounts are ALWAYS base units (wei) as strings — never floats. The first demo
 * wallet has a policy allowing sends to the others.
 */
import { parseEther } from 'viem';
import { VencuraClient } from '../src';

async function main() {
  const v = new VencuraClient();
  await v.login('admin@vencura.local', 'demo-password');

  const wallets = await v.listWallets();
  if (wallets.length < 2) throw new Error('run `pnpm --filter @vencura/api db:seed` first');
  const [sender, recipient] = wallets;

  // 0.01 ETH expressed in wei. An Idempotency-Key makes a retry safe (one broadcast).
  const tx = await v.sendTransaction(
    sender.id,
    { to: recipient.address, asset: 'ETH', amount: parseEther('0.01').toString() },
    `example-${Date.now()}`,
  );
  console.log(`broadcast: nonce=${tx.nonce} hash=${tx.txHash} status=${tx.status}`);

  // Poll the activity feed until the confirmation watcher flips it to confirmed.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const latest = (await v.listActivity(sender.id)).find((a) => a.kind === 'transaction' && a.id === tx.id);
    if (latest && latest.kind === 'transaction') {
      console.log(`  status: ${latest.status}`);
      if (latest.status !== 'pending') break;
    }
  }
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
