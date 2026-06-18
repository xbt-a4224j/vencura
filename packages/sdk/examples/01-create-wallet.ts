/**
 * Example: create a custodial wallet.
 *   pnpm --filter @vencura/sdk exec tsx examples/01-create-wallet.ts
 * Point at another API with VENCURA_API_URL (default http://localhost:3000).
 */
import { VencuraClient } from '../src';

async function main() {
  const v = new VencuraClient();

  // A throwaway demo account — register() stores the bearer token on the client.
  const email = `demo+${Date.now()}@example.com`;
  await v.register(email, 'password123');
  console.log('registered:', email);

  // The platform generates + encrypts the private key server-side; you get an address.
  const wallet = await v.createWallet();
  console.log('wallet id:  ', wallet.id);
  console.log('address:    ', wallet.address);
  console.log('\nFund this address from a Sepolia faucet to enable live sends.');
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
