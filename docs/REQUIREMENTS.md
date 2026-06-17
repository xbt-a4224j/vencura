# VenCura — Product Requirements (North Star)

> The complete requirement set the implementation must satisfy. Build to **all** of this, governed by the
> **Prime Directive** in `CLAUDE.md` (thorough + professional, minimal bloat/overengineering, readable, lean on
> accepted libraries). Optional items are stretch — see Block 7 in `tickets.md`.

## Overview
VenCura is an API platform that generates **custodial wallets** on the backend with support for basic actions,
plus a client to interact with it — *"the Venmo of wallets."* The brief is intentionally open-ended to allow
creativity within the problem.

## Core requirements (must-have)
- A user can create **at least one account/wallet**.
- All interactions with the custodial wallet happen on the **backend via an API**.
- A user can perform **at least** these wallet actions:
  - `getBalance() → balance: number` — current balance on the wallet.
  - `signMessage(msg: string) → signedMessage: string` — message signed with the private key.
  - `sendTransaction(to: string, amount: number) → transactionHash: string` — send a transaction on the blockchain.
- A basic **client** to interact with the API.
- Stack: **TypeScript / Node** (Python also acceptable); the core should work cleanly across many build tools/frameworks.
- The wallet supports **both the native asset and tokens** (ETH + ERC-20).

## Focus areas (what's evaluated)
- **Code + API + schema** design and implementation.
- **Security** considerations (a writeup is acceptable).
- **Testing**.
- **Example code** for using the wallet.

## Optional / stretch ideas (nice-to-haves)
- Users can have many accounts.
- Accounts from the same user can interact with each other (e.g., checking/savings).
- Invite users to share access to the same wallet.
- Show transaction history (on/off-chain).
- Incorporate a messaging platform (XMTP).
- Make it more secured.
- Make it non-custodial.
- Chain interaction: read/write data via contracts or programs.
- Smart-wallet design.

## Technical notes
- Wallet/chain interaction may use a standard library — **Viem** or **Ethers** (Ethers has a `Wallet` class for key
  handling and common methods); Solana SDKs exist if targeting Solana.
- Target chain: **Ethereum Sepolia** testnet. Use **your own** Infura/Alchemy RPC endpoint (never commit shared keys).
  Fund test wallets via a Sepolia faucet.
- Deliverables include **architecture notes** — decisions made, known weaknesses, and any concerns with the implementation.

## How this maps to our build
- **Core requirements + focus areas** → Blocks 1–6 in `tickets.md`.
- **Optional ideas** → Block 7 (stretch); a couple deliberately scoped light (high effort / tangential to the custody story).
- Everything is governed by the **Prime Directive** in `CLAUDE.md`: maximize thoroughness and professionalism, minimize
  bloat/overengineering/unreadability, reuse accepted libraries over reinventing.
