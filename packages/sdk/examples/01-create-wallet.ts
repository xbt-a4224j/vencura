/**
 * Example: provision a custodial wallet (one per account).
 *   pnpm --filter @vencura/sdk exec tsx examples/01-create-wallet.ts
 * Runs against the live deployment by default; set VENCURA_API_URL to point elsewhere.
 */
import { connect } from './_client';

async function main() {
  const v = await connect();

  // The platform generates + encrypts the private key server-side and master-funds the wallet;
  // you get an address. Idempotent — one wallet per account.
  const wallet = await v.wallets.provision();
  console.log('wallet id:  ', wallet.id);
  console.log('address:    ', wallet.address);
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
