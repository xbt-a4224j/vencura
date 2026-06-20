/**
 * Example: fire N concurrent sends at ONE wallet and prove the nonce lock holds.
 *   pnpm --filter @vencura/sdk exec tsx examples/05-concurrency.ts
 *
 * Despite racing, the per-wallet Postgres advisory lock serializes the critical section, so every
 * send gets a unique, consecutive nonce — no collisions, no gaps. Same invariant the API's unit
 * tests assert, shown here as a script (N real 1-wei self-sends on Sepolia).
 */
import { NATIVE_ASSET } from '../src';
import { aWallet, connect } from './_client';

const N = 5;

async function main() {
  const v = await connect();
  const wallet = await aWallet(v);

  // Fire N self-sends simultaneously (Promise.all), not in sequence.
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      v.transactions
        .send({ walletId: wallet.id, to: wallet.address, asset: NATIVE_ASSET, amount: '1' })
        .then((tx) => tx.nonce)
        .catch((e) => `error: ${e.message}`),
    ),
  );

  const nonces = results.filter((r): r is number => typeof r === 'number').sort((a, b) => a - b);
  const unique = new Set(nonces).size === nonces.length;
  const consecutive = nonces.every((n, i) => i === 0 || n === nonces[i - 1] + 1);

  console.log('nonces:', nonces.join(', '));
  console.log(`unique: ${unique} · consecutive: ${consecutive}`);
  console.log(unique && consecutive ? '✓ nonce lock held under concurrency' : '✗ collision detected');
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
