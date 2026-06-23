# VenCura — custodial Ethereum wallets over an API


[![CI](https://github.com/xbt-a4224j/vencura/actions/workflows/ci.yml/badge.svg)](https://github.com/xbt-a4224j/vencura/actions/workflows/ci.yml)

Admin view of the custodial ETH wallet platform:
<img width="899" height="670" alt="image" src="https://github.com/user-attachments/assets/bc1a5fc0-5400-4a86-87f6-cced203d02df" />



A backend **API platform that creates and operates custodial Ethereum wallets** on users' behalf, with a
React admin to drive it. Four core actions over REST — **create wallet**, **get balance**, **sign message**,
**send transaction** — for **ETH** and **ERC-20** on **Ethereum Sepolia** (or a local **anvil** node).

> The centerpiece is **key custody** (AES-256-GCM at rest behind a pluggable `Signer`) and **transaction
> correctness under concurrency** (per-wallet nonce lock + idempotency), with a custodial → MPC → non-custodial
> story. Full spec: [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) · security: [`docs/SECURITY.md`](docs/SECURITY.md).

## Try the live app

| | Live ([Vercel](https://vencura-alpha.vercel.app)) | Local (`pnpm dev`) |
| --- | --- | --- |
| Web admin | [vencura-alpha.vercel.app](https://vencura-alpha.vercel.app) | [localhost:5173](http://localhost:5173) |
| Swagger / OpenAPI | [/api/docs](https://vencura-alpha.vercel.app/api/docs) | [localhost:3000/docs](http://localhost:3000/docs) |
| Health | [/api/health](https://vencura-alpha.vercel.app/api/health) | [localhost:3000/health](http://localhost:3000/health) |

Register an account, or use the seeded **`admin@vencura.local`** / **`seed-password`**. New wallets auto-fund a
small amount from the master wallet; live send needs a Sepolia-funded wallet (faucet link in the admin).

> **New here?** The [reviewer walkthrough](docs/reviewer-walkthrough.html) is a ~10-min guided tour of the live
> app, no setup — it exercises key custody, concurrency-correctness, and chain-as-truth with a diagram per step.

## Run locally

**Needs:** [Docker](https://www.docker.com/) (Compose v2), **Node 20** ([`.nvmrc`](.nvmrc)), **pnpm 9** (`corepack enable`).

```bash
pnpm i           # install the workspace
pnpm bootstrap   # .env from .env.example → docker compose up (postgres+anvil) → migrate → seed
pnpm dev         # run api + web against the local stack
```

No RPC key or faucet needed locally — anvil funds wallets directly via `anvil_setBalance`, and the web proxies
`/api` → port `3000` (same origin, no CORS). If port `5432` is taken, set `POSTGRES_HOST_PORT` (and the port in
`DATABASE_URL`). Tear down with `docker compose down` (`-v` wipes the DB volume). Reset/re-seed any time via the
**Start over** button or `POST /admin/reset`.

## Layout & scripts

```
packages/
  api/      NestJS REST API + workers (auth, wallets, transactions, balances, signer, admin)
  sdk/      typed TS client over the OpenAPI spec + example scripts
  web/      React/TS admin UI (load-bearing for every feature)
  shared/   shared types / zod schemas
docs/       architecture & security writeups
```

`pnpm dev` · `test` · `lint` · `typecheck` · `build` run across the workspace via Turbo; `pnpm bootstrap` does
one-command local setup.

## Config

All vars live in [`.env.example`](.env.example) (copied to `.env` by bootstrap). The ones you'll touch for a real
deploy: `RPC_URL` (Infura/Alchemy Sepolia URL), `CONFIRMATIONS` (`3`–`12` for reorg safety), and the three
generated secrets `MASTER_ENCRYPTION_KEY` / `JWT_SECRET` / `ADMIN_API_KEY` (`openssl rand -hex 32`).
**Secrets come from the environment and are never committed — only `.env.example` is.**

## Docs

| Doc | What's in it |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | System wiring + the send-under-concurrency and key-custody flows (diagrams) |
| [Deployment](docs/DEPLOYMENT.md) | Topology, the four hosts, deploy-time config, GitHub environments |
| [Security](docs/SECURITY.md) | Threat model, custody design + evolution path, honest weaknesses |
| [Requirements](docs/REQUIREMENTS.md) | The full requirement set the build satisfies |
| [Reviewer walkthrough](docs/reviewer-walkthrough.html) | ~10-min guided tour of the live app, no setup |

