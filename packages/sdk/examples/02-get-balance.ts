/**
 * Example: read a wallet's balance (confirmed + available).
 *   pnpm --filter @vencura/sdk exec tsx examples/02-get-balance.ts
 *
 * Balance is read from chain and cached; `available` = confirmed − pending − gas reserve.
 */
import { VencuraClient } from '../src';

async function main() {
  const v = new VencuraClient();
  await v.register(`demo+${Date.now()}@example.com`, 'password123');
  const wallet = await v.createWallet();

  const { balances } = await v.getBalance(wallet.id);
  for (const b of balances) {
    console.log(`${b.symbol}: available=${b.available} confirmed=${b.confirmed} (as of block ${b.asOfBlock ?? '—'})`);
  }
  // A freshly created wallet is unfunded, so this prints 0 until you faucet-fund the address.
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
