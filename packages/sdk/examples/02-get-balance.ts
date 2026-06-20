/**
 * Example: read a wallet's balance (confirmed + available).
 *   pnpm --filter @vencura/sdk exec tsx examples/02-get-balance.ts
 *
 * Balance is read from chain and cached; `available` = confirmed − pending − gas reserve.
 */
import { aWallet, connect } from './_client';

async function main() {
  const v = await connect();
  const wallet = await aWallet(v);

  const { balances } = await v.wallets.getBalance({ walletId: wallet.id });
  console.log('wallet', wallet.address);
  for (const b of balances) {
    console.log(`  ${b.symbol}: available=${b.available} confirmed=${b.confirmed} (as of block ${b.asOfBlock ?? '—'})`);
  }
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
