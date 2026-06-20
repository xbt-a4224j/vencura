/**
 * Example: sign a message with the wallet's key, then verify the signature locally.
 *   pnpm --filter @vencura/sdk exec tsx examples/03-sign-message.ts
 *
 * Signing never exposes the private key — the server decrypts it in memory only.
 * Off-chain proof of ownership: no broadcast, no tx hash (the basis for Sign-In-With-Ethereum
 * and gasless EIP-712 approvals).
 */
import { recoverMessageAddress } from 'viem';
import { aWallet, connect } from './_client';

async function main() {
  const v = await connect();
  const wallet = await aWallet(v);

  const message = `I control ${wallet.address} — signed to prove ownership (off-chain, no gas).`;
  const { signature } = await v.wallets.signMessage({ walletId: wallet.id, message });
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
