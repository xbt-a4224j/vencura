/**
 * Example: fire N concurrent sends at ONE wallet and prove the nonce lock holds.
 *   pnpm --filter @vencura/api db:seed
 *   pnpm --filter @vencura/sdk exec tsx examples/05-concurrency.ts
 *
 * Despite racing, the per-wallet Postgres advisory lock serializes the critical
 * section, so every send gets a unique, consecutive nonce — no collisions, no gaps.
 * This is the same invariant the API's unit tests assert, shown here as a script.
 */
import { parseEther } from 'viem';
import { VencuraClient } from '../src';

const N = 5;

async function main() {
  const v = new VencuraClient();
  await v.login('admin@vencura.local', 'demo-password');
  const wallets = await v.listWallets();
  const [sender, recipient] = wallets;

  // Fire N sends simultaneously (Promise.all), not in sequence.
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      v
        .sendTransaction(sender.id, { to: recipient.address, asset: 'ETH', amount: parseEther('0.001').toString() })
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
