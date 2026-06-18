/**
 * Example: sign a message with the wallet's key, then verify the signature locally.
 *   pnpm --filter @vencura/sdk exec tsx examples/03-sign-message.ts
 *
 * Signing never exposes the private key — the server decrypts it in memory only.
 * This is "off-chain" activity: no broadcast, no tx hash. It still shows in the
 * wallet's unified activity history (see example 05's tail / GET /activity).
 */
import { recoverMessageAddress } from 'viem';
import { VencuraClient } from '../src';

async function main() {
  const v = new VencuraClient();
  await v.register(`demo+${Date.now()}@example.com`, 'password123');
  const wallet = await v.createWallet();

  const message = 'I authorize this VenCura demo.';
  const { signature } = await v.signMessage(wallet.id, message);
  console.log('signature:', signature);

  // EIP-191 recovery should yield the wallet's own address.
  const recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
  console.log('recovered:', recovered);
  console.log('matches wallet address:', recovered.toLowerCase() === wallet.address.toLowerCase());
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
