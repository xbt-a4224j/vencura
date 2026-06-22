# VenCura — custodial Ethereum wallets over an API

[![CI](https://github.com/xbt-a4224j/vencura/actions/workflows/ci.yml/badge.svg)](https://github.com/xbt-a4224j/vencura/actions/workflows/ci.yml)

A backend **API platform that creates and operates custodial Ethereum wallets** on users' behalf, with a
React admin to drive it. Core actions over a REST API: **create a wallet**, **get balance**, **sign a
message**, and **send a transaction** — for the native asset (**ETH**) and **ERC-20 tokens**. Target chain:
**Ethereum Sepolia** (with a local **anvil** node for offline development).

> Custodial-wallet platform: the centerpiece is **key custody** (AES-256-GCM at rest behind a pluggable
> `Signer`), **transaction correctness under concurrency** (per-wallet nonce lock + idempotency), and a clear
> custodial → MPC → non-custodial story. See [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md).

## Live deployment

| What | URL |
| --- | --- |
| **Web admin UI** | [vencura-alpha.vercel.app](https://vencura-alpha.vercel.app) |
| **API — Swagger / OpenAPI** | [/api/docs](https://vencura-alpha.vercel.app/api/docs) |
| **API — health** | [/api/health](https://vencura-alpha.vercel.app/api/health) |

Web on **Vercel**, API on **Railway** (Docker), Postgres on **Neon**, RPC on **Sepolia**. The web calls the API
same-origin via a `/api/*` rewrite. Register an account to try it; live balance/send needs a Sepolia-funded
wallet (faucet link in the admin).

> **New here?** Follow the [reviewer walkthrough](docs/reviewer-walkthrough.html) — a guided tour of the
> live app (with a diagram per step) that exercises the four required operations: key custody,
> concurrency-correctness, and chain-as-truth. ~10 minutes, no local setup.

## Quick start

**Prerequisites:** [Docker](https://www.docker.com/) (Compose v2), **Node 20** (see [`.nvmrc`](.nvmrc)), and
**pnpm 9** (`corepack enable`).

```bash
pnpm i           # install the workspace
pnpm bootstrap   # .env from .env.example → docker compose up -d (postgres+anvil) → db migrate → seed
pnpm dev         # run api + web against the local stack
```

`pnpm bootstrap` creates a local `.env` (gitignored) from [`.env.example`](.env.example), starts Postgres and
an **anvil** local Ethereum node in Docker, runs Prisma migrations, and seeds demo data. **No RPC key or
Sepolia faucet needed for local dev** — wallets are funded directly on the anvil node via `anvil_setBalance`.

If host port `5432` is taken, set `POSTGRES_HOST_PORT` (and the port in `DATABASE_URL`) to a free port. Tear
down with `docker compose down` (add `-v` to wipe the database volume).

### Reset / demo cycle

- **Admin UI:** click **Start over** in the Admin tab to wipe and re-seed the database.
- **API:** `POST /admin/reset` (dev-gated via `x-admin-key` header) — same effect programmatically.

## Open the app

Once `pnpm dev` is up, click straight in:

| What | URL |
| --- | --- |
| **Web admin UI** | [localhost:5173](http://localhost:5173) |
| **API — Swagger UI / OpenAPI** | [localhost:3000/docs](http://localhost:3000/docs) |
| **API — health check** | [localhost:3000/health](http://localhost:3000/health) |

The web app proxies `/api` → the API on port `3000`, so the SPA and API share an origin (no CORS in dev).

**Logging in:** register a user in the **User** tab, or use the seeded account — **`admin@vencura.local`** / **`seed-password`** (run `pnpm --filter @vencura/api db:seed` to (re)create it). New wallets are auto-funded a small amount from the seeded master wallet.

## Environment variables

All env vars are documented in [`.env.example`](.env.example). `pnpm bootstrap` copies it to `.env` — never
commit `.env`. Key vars:

| Variable | Local default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://vencura:vencura@localhost:5432/vencura` | Postgres connection string |
| `RPC_URL` | `http://localhost:8545` | Local: anvil node. Sepolia: set to your Infura/Alchemy URL |
| `MASTER_ENCRYPTION_KEY` | _(placeholder in .env.example)_ | 32-byte hex key for AES-256-GCM wallet-key encryption. Generate: `openssl rand -hex 32` |
| `JWT_SECRET` | _(placeholder)_ | JWT signing secret. Generate: `openssl rand -hex 32` |
| `ADMIN_API_KEY` | _(placeholder)_ | Gates `/admin/*` routes via `x-admin-key` header |
| `CONFIRMATIONS` | `1` (defaults in code) | Blocks to wait before marking a tx confirmed. Anvil: `1`. Sepolia: `3`–`12` for reorg safety |

Secrets (`MASTER_ENCRYPTION_KEY`, `JWT_SECRET`, `ADMIN_API_KEY`) come from the environment — never committed.
Only `.env.example` (with placeholders) is tracked in git.

## Monorepo layout

```
packages/
  api/      NestJS REST API + workers (auth, wallets, transactions, balances, signer, admin)
  sdk/      typed TS client over the OpenAPI spec + example scripts
  web/      React/TS admin UI (load-bearing for every feature)
  shared/   shared types / zod schemas
docs/       architecture, security writeup
```

## Scripts

| Command          | What it does                                    |
| ---------------- | ----------------------------------------------- |
| `pnpm dev`       | Run all apps in watch mode (Turbo)              |
| `pnpm test`      | Run the test suites (Vitest)                    |
| `pnpm lint`      | ESLint across the workspace                     |
| `pnpm typecheck` | `tsc --noEmit` across packages                  |
| `pnpm build`     | Build all packages                              |
| `pnpm bootstrap` | One-command local setup (env → infra → migrate) |

## API & docs

With the stack running, the API serves:

- [`GET /health`](http://localhost:3000/health) — liveness
- [Swagger UI at `/docs`](http://localhost:3000/docs) — interactive OpenAPI (and the source for the generated SDK)

## Security & custody

**Security writeup** — see [`docs/SECURITY.md`](docs/SECURITY.md).

Secrets (`MASTER_ENCRYPTION_KEY`, `JWT_SECRET`, DB URL, RPC key) come from the environment and are never
committed — only [`.env.example`](.env.example) is.

## Architecture diagrams

### System architecture

```mermaid
graph TD
    Browser["React Admin\n(packages/web)\nlocalhost:5173"]

    subgraph API["NestJS API (packages/api) — localhost:3000"]
        AuthM["AuthModule\nJWT guard · register · login"]
        WalletsM["WalletsModule\nPOST /wallets\nGET /wallets"]
        TxM["TransactionsModule\nPOST /wallets/:id/transactions\nPOST /wallets/:id/messages\nGET /wallets/:id/transactions\n+ ConfirmationWatcher (poller)"]
        BalM["BalancesModule\nGET /wallets/:id/balance\n+ BalanceRefresher (poller)"]
        SignerM["SignerModule\nEncryptedKeySigner (AES-256-GCM)\nShamirSigner (bonus)"]
        AdminM["AdminModule\nPOST /admin/reset · seed\nconcurrency demo"]

        subgraph Infra["Infra modules"]
            PrismaM["PrismaModule\nPostgres via Prisma ORM"]
            ChainM["ChainModule\nviem client"]
            LockM["LockModule\npg_advisory_xact_lock\n(Lock interface)"]
        end
    end

    subgraph Storage["Data layer"]
        PG[("Postgres\nderived cache\nwallet_balances · transactions\nwallet · users")]
    end

    subgraph Chain["Ethereum"]
        AnvilSepolia["anvil (local dev)\nor Sepolia (deploy)\nchain is source of truth"]
    end

    Browser -->|REST + JWT| AuthM
    Browser -->|REST + JWT| WalletsM
    Browser -->|REST + JWT| TxM
    Browser -->|REST + JWT| BalM
    Browser -->|REST + JWT| AdminM

    WalletsM --> SignerM
    TxM --> SignerM
    TxM --> LockM

    PrismaM --> PG
    ChainM --> AnvilSepolia
    BalM -->|"confirmed balance\n(cache miss → live fetch)"| ChainM
    TxM -->|"live nonce + balance\n(never the cache)"| ChainM
    TxM --> PrismaM
    BalM --> PrismaM
    WalletsM --> PrismaM
    AuthM --> PrismaM
    LockM --> PrismaM
```

### sendTransaction — sequence with nonce lock

```mermaid
sequenceDiagram
    participant C as Client
    participant Ctrl as TransactionsController
    participant Svc as TransactionsService
    participant Lock as LockModule<br/>(pg_advisory_xact_lock)
    participant Signer as Signer<br/>(EncryptedKeySigner)
    participant Chain as Chain (viem)
    participant DB as Postgres

    C->>Ctrl: POST /wallets/:id/transactions {to, amount, idempotencyKey}
    Ctrl->>Svc: sendTransaction(walletId, dto)
    Svc->>Lock: withWalletLock(walletId, fn)

    Note over Lock: pg_advisory_xact_lock — concurrent same-wallet sends queue here

    Lock->>Chain: eth_getTransactionCount("pending") — live, never cached
    Chain-->>Lock: nonce
    Lock->>Signer: signTransaction {to, value, nonce}
    Note over Signer: decrypt in memory · sign · zeroize
    Signer-->>Lock: signedTx
    Lock->>Chain: sendRawTransaction(signedTx)
    Chain-->>Lock: txHash
    Lock->>DB: INSERT {hash, nonce, status=pending, idempotencyKey UNIQUE}
    Note over DB: duplicate key → return existing row, no double-send
    Lock-->>Svc: commit (releases advisory lock)
    Svc-->>C: 202 {hash, status: pending}

    loop ConfirmationWatcher @12s
        DB->>Chain: getTransactionReceipt(hash)
        Chain-->>DB: receipt or null
        DB->>DB: confirmations ≥ threshold → status=confirmed/failed
    end
```

### Key custody — AES-256-GCM at rest

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Generated : generatePrivateKey()
    Generated --> Encrypted : AES-256-GCM(MASTER_KEY)
    Encrypted --> AtRest : store {encryptedKey · iv · authTag}

    AtRest --> InMemory : decrypt(MASTER_KEY) — sign time only
    InMemory --> Signed : signTx / signMessage
    Signed --> Zeroized : zeroize key bytes
    Zeroized --> AtRest : key dropped from process

    note right of InMemory
        plaintext key exists only
        in-process, never persisted,
        never logged, never returned
    end note
```
