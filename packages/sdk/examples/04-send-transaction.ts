/**
 * Example: send a native ETH transaction and wait for it to confirm — in one call.
 *   pnpm --filter @vencura/sdk exec tsx examples/04-send-transaction.ts
 *
 * Broadcasts a real Sepolia tx from the funded demo wallet to itself (a 1-wei self-send, like the
 * admin concurrency demo). `sendAndConfirm` generates an idempotency key (so a retry can't
 * double-broadcast) and polls the confirmation watcher until the tx leaves `pending`.
 */
import { NATIVE_ASSET } from '../src';
import { aWallet, connect } from './_client';

async function main() {
  const v = await connect();
  const wallet = await aWallet(v);

  // 1 wei to self — broadcast and wait for confirmation in one await.
  const tx = await v.transactions.sendAndConfirm({
    walletId: wallet.id,
    to: wallet.address,
    asset: NATIVE_ASSET,
    amount: '1',
  });
  console.log(`confirmed: nonce=${tx.nonce} hash=${tx.txHash} status=${tx.status}`);
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
