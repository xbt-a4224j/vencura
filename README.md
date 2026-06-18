# VenCura — the Venmo of wallets

[![CI](https://github.com/xbt-a4224j/vencura/actions/workflows/ci.yml/badge.svg)](https://github.com/xbt-a4224j/vencura/actions/workflows/ci.yml)

A backend **API platform that creates and operates custodial Ethereum wallets** on users' behalf, with a
React admin to drive it. Core actions over a REST API: **create a wallet**, **get balance**, **sign a
message**, and **send a transaction** — for the native asset (**ETH**) and **ERC-20 tokens**. Target chain:
**Ethereum Sepolia** (with a local **anvil** node for offline development).

> Custodial-wallet platform: the centerpiece is **key custody** (AES-256-GCM at rest behind a pluggable
> `Signer`), **transaction correctness under concurrency** (per-wallet nonce lock + idempotency), and a clear
> custodial → MPC → non-custodial story. See [`CLAUDE.md`](CLAUDE.md) and [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md).

## Quick start

**Prerequisites:** [Docker](https://www.docker.com/) (Compose v2), **Node 20** (see [`.nvmrc`](.nvmrc)), and
**pnpm 9** (`corepack enable`).

```bash
pnpm i           # install the workspace
pnpm bootstrap   # .env from .env.example → docker compose up -d (postgres+anvil) → db migrate
pnpm dev         # run api + web against the local stack
```

`pnpm bootstrap` creates a local `.env` (gitignored) from [`.env.example`](.env.example). If host port `5432`
is taken, set `POSTGRES_HOST_PORT` (and the port in `DATABASE_URL`) to a free port. Tear down with
`docker compose down` (add `-v` to wipe the database volume).

## Monorepo layout

```
packages/
  api/      NestJS REST API + workers (auth, wallets, transactions, balances, policy, signer, admin)
  sdk/      typed TS client over the OpenAPI spec + example scripts
  web/      React/TS admin UI (load-bearing for every feature)
  shared/   shared types / zod schemas
docs/       architecture, security writeup
DEVLOG.md   append-only, per-ticket teaching log — read this to learn the codebase
tickets.md  the plan (GitHub issues)
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

Once running, the API serves:

- `GET /health` — liveness
- Swagger UI at **`/docs`** (OpenAPI; the source for the generated SDK)

## Status

Built block-by-block; releases are tagged by semantic-release on `main`. Current: **v0.1.0** (Block 1 —
foundation & CI). The full plan lives in [`tickets.md`](tickets.md).

## Architecture diagrams

_Mermaid system + sequence diagrams (architecture, and `sendTransaction` with the nonce lock) are added in the
final block (T-038)._

## Security & custody

A dedicated security writeup (threat model, custody spectrum, honest weaknesses, scale path) lands in
[`docs/`](docs/) in the final block. Secrets (`MASTER_ENCRYPTION_KEY`, `JWT_SECRET`, DB URL, RPC key)
come from the environment and are never committed — only [`.env.example`](.env.example) is.
