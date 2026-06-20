/**
 * Example: the ERC-20 approve → allowance → transferFrom flow via the SDK's typed token helpers.
 *   pnpm --filter @vencura/sdk exec tsx examples/06-token-flow.ts
 *
 * Single-wallet demo: the owner approves itself as spender, then pulls within the allowance — so it
 * runs with one funded wallet (the deployment's admin wallet owns the token). The web UI shows the
 * two-party version (a separate holder approves the admin). Exercises every token helper + waits for
 * each step to confirm, since allowance/balance must be on-chain for transferFrom to succeed.
 */
import { parseEther } from 'viem';
import { aWallet, connect } from './_client';

async function main() {
  const v = await connect();
  const owner = await aWallet(v); // the deployment's admin wallet owns the demo token + supply

  let token = await v.tokens.get();
  if (!token) {
    const d = await v.tokens.deploy({ walletId: owner.id });
    token = { address: d.address, owner: d.owner };
  }
  console.log('token:', token.address);

  // Owner approves itself as spender for 50, then pulls 50 within the allowance.
  const appr = await v.tokens.approve({ walletId: owner.id, token: token.address, spender: owner.address, amount: parseEther('50').toString() });
  await v.transactions.waitForConfirmation({ walletId: owner.id, txHash: appr.txHash! });
  console.log('allowance:', await v.tokens.allowance({ token: token.address, owner: owner.address, spender: owner.address }));

  const pull = await v.tokens.transferFrom({ walletId: owner.id, token: token.address, from: owner.address, to: owner.address, amount: parseEther('50').toString() });
  await v.transactions.waitForConfirmation({ walletId: owner.id, txHash: pull.txHash! });
  console.log('owner balance:', await v.tokens.balanceOf({ token: token.address, owner: owner.address }));
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
