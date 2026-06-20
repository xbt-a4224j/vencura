/**
 * Example: the ERC-20 approve → transferFrom flow via the SDK's typed token helpers.
 *   pnpm --filter @vencura/api db:seed
 *   pnpm --filter @vencura/sdk exec tsx examples/06-token-flow.ts
 *
 * Owner distributes the demo token to a holder; the holder approves the owner as spender; the owner
 * pulls tokens with transferFrom — gated by the on-chain allowance. We wait for each step to confirm
 * before the next, since allowance/balance must be on-chain for transferFrom to succeed.
 */
import { parseEther } from 'viem';
import { Vencura } from '../src';

async function main() {
  const v = new Vencura();
  await v.auth.login({ email: 'admin@vencura.local', password: 'demo-password' });

  const wallets = await v.wallets.list();
  if (wallets.length < 2) throw new Error('run `pnpm --filter @vencura/api db:seed` first');
  const [owner, holder] = wallets;

  // Ensure a token exists (the owner deploys + holds the full supply).
  let token = await v.tokens.get();
  if (!token) {
    const d = await v.tokens.deploy({ walletId: owner.id });
    token = { address: d.address, owner: d.owner };
  }
  console.log('token:', token.address);

  // Distribute 100 to the holder, and have the holder approve the owner for 50 — concurrently.
  const dist = await v.tokens.transfer({ walletId: owner.id, token: token.address, to: holder.address, amount: parseEther('100').toString() });
  const appr = await v.tokens.approve({ walletId: holder.id, token: token.address, spender: owner.address, amount: parseEther('50').toString() });
  await Promise.all([
    v.transactions.waitForConfirmation({ walletId: owner.id, txHash: dist.txHash! }),
    v.transactions.waitForConfirmation({ walletId: holder.id, txHash: appr.txHash! }),
  ]);
  console.log('allowance (holder → owner):', await v.tokens.allowance({ token: token.address, owner: holder.address, spender: owner.address }));

  // Owner pulls 50 from the holder within the allowance.
  const pull = await v.tokens.transferFrom({ walletId: owner.id, token: token.address, from: holder.address, to: owner.address, amount: parseEther('50').toString() });
  await v.transactions.waitForConfirmation({ walletId: owner.id, txHash: pull.txHash! });
  console.log('holder balance:', await v.tokens.balanceOf({ token: token.address, owner: holder.address }));
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
