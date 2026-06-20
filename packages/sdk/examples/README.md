# VenCura SDK — example scripts

Runnable scripts that show how to drive the VenCura API with the typed, resource-grouped
[`Vencura`](../src/index.ts) client (`v.wallets.*`, `v.transactions.*`, …). Each is self-contained
and readable top to bottom.

## Run

```bash
# point at any API; defaults to http://localhost:3000
export VENCURA_API_URL=http://localhost:3000        # or https://vencura-api-production-3c23.up.railway.app

pnpm --filter @vencura/sdk exec tsx examples/01-create-wallet.ts
pnpm --filter @vencura/sdk exec tsx examples/02-get-balance.ts
pnpm --filter @vencura/sdk exec tsx examples/03-sign-message.ts
```

Examples **04** and **05** send real transactions, so they need a **funded** wallet.
Seed the funded demo wallets on the local anvil node first:

```bash
pnpm --filter @vencura/api db:seed
pnpm --filter @vencura/sdk exec tsx examples/04-send-transaction.ts
pnpm --filter @vencura/sdk exec tsx examples/05-concurrency.ts
```

| Script | Shows |
| --- | --- |
| `01-create-wallet.ts` | register → create a custodial wallet, print the address |
| `02-get-balance.ts` | read confirmed + available balance |
| `03-sign-message.ts` | sign a message, recover the signer locally (EIP-191) |
| `04-send-transaction.ts` | `sendAndConfirm` — broadcast native ETH and wait for confirmation (auto idempotency key) |
| `05-concurrency.ts` | fire N concurrent sends → unique, consecutive nonces (the nonce lock) |
