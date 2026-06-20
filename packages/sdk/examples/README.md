# VenCura SDK — example scripts

Runnable scripts that show how to drive the VenCura API with the typed, resource-grouped
[`Vencura`](../src/index.ts) client (`v.wallets.*`, `v.transactions.*`, …). Each is self-contained
and readable top to bottom.

## Run

They default to the **live deployment** and authenticate with the shared demo account — so they run
with zero setup. Point elsewhere with `VENCURA_API_URL` (e.g. a local `pnpm dev`).

```bash
pnpm --filter @vencura/sdk exec tsx examples/01-create-wallet.ts
pnpm --filter @vencura/sdk exec tsx examples/02-get-balance.ts
pnpm --filter @vencura/sdk exec tsx examples/03-sign-message.ts
pnpm --filter @vencura/sdk exec tsx examples/04-send-transaction.ts
pnpm --filter @vencura/sdk exec tsx examples/05-concurrency.ts
pnpm --filter @vencura/sdk exec tsx examples/06-token-flow.ts
```

> **04–06 broadcast real Sepolia transactions** (1-wei self-sends / token approve+transferFrom on the
> demo wallet). Against a local API, run `pnpm --filter @vencura/api db:seed` first.

| Script | Shows |
| --- | --- |
| `01-create-wallet.ts` | register → create a custodial wallet, print the address |
| `02-get-balance.ts` | read confirmed + available balance |
| `03-sign-message.ts` | sign a message, recover the signer locally (EIP-191) |
| `04-send-transaction.ts` | `sendAndConfirm` — broadcast native ETH and wait for confirmation (auto idempotency key) |
| `05-concurrency.ts` | fire N concurrent sends → unique, consecutive nonces (the nonce lock) |
| `06-token-flow.ts` | ERC-20 approve → transferFrom via the typed token helpers (`v.tokens.*`) |

## CLI

The package ships a `vencura` CLI (a thin wrapper over the SDK). The JWT persists in `~/.vencura/token`,
so log in once. API base via `$VENCURA_API_URL` (default `http://localhost:3000`).

```bash
export VENCURA_API_URL=https://vencura-alpha.vercel.app/api
pnpm --filter @vencura/sdk exec node dist/cli.js login <email> <password>
pnpm --filter @vencura/sdk exec node dist/cli.js balance
pnpm --filter @vencura/sdk exec node dist/cli.js sign "I control this wallet"
pnpm --filter @vencura/sdk exec node dist/cli.js send --to vitalik.eth --amount 0.0001 --wait
pnpm --filter @vencura/sdk exec node dist/cli.js activity
```
