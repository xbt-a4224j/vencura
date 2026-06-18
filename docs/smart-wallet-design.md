# Smart-wallet direction — design spike (T-040, exploration only)

> A design note + small spike, **not a build**. Where could VenCura go beyond externally-owned
> accounts (EOAs)? This sketches the two live account-abstraction paths — **ERC-4337** and
> **EIP-7702** — their trade-offs against the current model, and how each would slot into the
> existing `Signer` seam. Scoped explicitly as exploration; nothing here ships yet.

## 1. Where we are: custodial EOAs behind the `Signer` seam

Today every wallet is a plain **EOA** — a secp256k1 keypair the platform custodies. The key sits
behind the `Signer` interface (`EncryptedKeySigner` default, `ShamirSigner` bonus), so signing is
already abstracted from the rest of the app. Policy (allowlist, limits) is enforced **off-chain** in
the `PolicyEngine` before signing; the chain just sees a normal signed transaction.

This is simple and correct, but an EOA is "dumb": its only capability is "sign with this one key."
Everything smart — spending rules, recovery, gas sponsorship, batching — lives in our backend, not in
the account. Smart wallets move some of that **into the account itself**.

## 2. What a smart wallet would buy us

| Capability | EOA today | Smart account |
| --- | --- | --- |
| Spending policy | off-chain `PolicyEngine` | enforceable **on-chain** (allowlist/limits in account code) |
| Key rotation / recovery | re-encrypt / re-share the key | **social/guardian recovery**, rotate signer without changing address |
| Gas | wallet must hold ETH | **paymaster** sponsors gas; pay in ERC-20 or have us sponsor |
| Batching | one tx per call | **atomic multi-call** (approve + swap in one) |
| Delegated/limited keys | n/a | **session keys** — scoped, expiring sub-keys |
| Signature scheme | secp256k1 only | arbitrary (passkeys/WebAuthn, multisig, MPC) |

For a custodial platform the headline wins are **on-chain policy** (the limit is enforced by the
account, not just our server) and **recovery** (rotate the signing key without migrating funds).

## 3. The two paths

### 3.1 ERC-4337 (account abstraction via an alt-mempool)

The account is a **contract** (`IAccount`) deployed per user. Instead of normal transactions, the
client submits a **UserOperation** to a **bundler**, which calls a singleton **EntryPoint** that
verifies (`validateUserOp`) and executes against the account. A **paymaster** can sponsor gas.

```
UserOp ──▶ Bundler ──▶ EntryPoint.handleOps ──▶ Account.validateUserOp ──▶ Account.execute
                                   └─ Paymaster.validatePaymasterUserOp (optional gas sponsorship)
```

- **Pros:** the richest model — on-chain validation logic, paymasters, session keys, batching, any
  signature scheme. Mature tooling (viem `permissionless`, multiple bundler/paymaster providers).
- **Cons:** real infrastructure (a bundler + paymaster, or a provider for both), a deployed contract
  per wallet (deploy cost / counterfactual addresses), and a different send path (UserOps, not txs).
- **Fit:** our `Signer` seam stays the *validator key* — the account's `validateUserOp` checks a
  signature our `Signer` produces. So custody (the key) and the account (the contract) are separable,
  which is exactly the layering Fireblocks-style platforms use.

### 3.2 EIP-7702 (EOAs that temporarily *become* smart accounts)

7702 (live post-Pectra) lets an **EOA set its account code** to point at a contract implementation via
a signed authorization — so the *same address* gains smart-account behavior without migrating funds or
deploying a new account. The EOA's key authorizes; the delegated code runs the logic.

- **Pros:** **keeps the existing EOA address** (no fund migration), no per-wallet contract deploy,
  incremental — add smart behavior to wallets we already custody. Lighter than full 4337.
- **Cons:** newer/less battle-tested; the EOA key still exists (so it's an *upgrade* of our custody,
  not a replacement); some features still want 4337 infra (bundlers/paymasters) underneath.
- **Fit:** the cleanest migration for *this* codebase — our wallets are already EOAs we control, so a
  7702 authorization is a natural next signer behavior, not a re-architecture.

## 4. How it slots into VenCura (the seam again)

The `Signer` interface is the integration point. A smart-wallet path is a **new signer + a UserOp/auth
builder**, not a rewrite:

```ts
// SPIKE / pseudocode — not built. A 4337-style send reusing the existing Signer for the inner signature.
class SmartAccountSigner implements Signer {
  async signTransaction(walletId, request) {
    const account = await this.smartAccountFor(walletId);          // counterfactual or deployed addr
    const userOp = await buildUserOp(account, request);            // nonce, callData, gas, paymaster
    const hash = getUserOpHash(userOp, ENTRY_POINT, CHAIN_ID);
    userOp.signature = await this.inner.signMessage(walletId, hash); // ← our EncryptedKey/Shamir signer
    return submitToBundler(userOp);                                 // returns a userOpHash, not a tx hash
  }
}
// EIP-7702 variant: instead of a UserOp, the inner signer produces an `authorization`
// (signed (chainId, implAddress, nonce)) attached to a normal type-4 transaction.
```

Notice: `this.inner` is the *current* `EncryptedKeySigner`/`ShamirSigner`. Custody of the validating
key is unchanged; we're adding an account layer on top. On-chain policy would let us move some
`PolicyEngine` checks into the account's `validateUserOp` (defense in depth: enforced both off- and
on-chain). `getBalance`/history would read the smart-account address instead of the EOA.

## 5. Recommendation

- **Not now.** It's a real infra + contract-security undertaking (bundler/paymaster, audited account
  code) that's out of scope for the brief; the EOA + `Signer`-seam model is the correct *minimal* thing.
- **If pursued: start with EIP-7702.** It keeps our existing custodied EOA addresses and adds smart
  behavior incrementally, which fits a platform that already holds the keys — versus 4337's per-wallet
  contract + alt-mempool, which is a bigger lift better suited to greenfield non-custodial wallets.
- **Either way, the seam holds.** Both reuse the current `Signer` for the inner signature, so this is
  additive — a `SmartAccountSigner` alongside the others — not a migration. That's the same property
  the ShamirSigner bonus already demonstrated: custody is pluggable.

## References
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) · [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702)
- viem account-abstraction / [permissionless.js](https://docs.pimlico.io/permissionless)
