# VenCura — Tickets

> The plan, as GitHub issues. **Blocks = GitHub milestones.** Work one block at a time; at the end of
> each block: commit directly to `main`, CI green, semantic-release version bump (per `CLAUDE.md` §11).
>
> **Every ticket inherits the global Definition of Done** (`CLAUDE.md` §14): TDD (test first), lint/types/build
> green, **UI surface if user-facing**, **logs** at demo points, **error handling**, and a **`DEVLOG.md` entry**.
> To avoid repetition, individual tickets list only their *specific* acceptance criteria + dependencies.
>
> Suggested labels: `block-N`, `type:feat|chore|test|docs`, `area:api|web|sdk|chain|infra`, `bonus`, `stretch`.

---

## Block 1 — Foundation & CI  → `v0.1.0`
*Goal: a monorepo that lints, tests, builds, and deploys an empty-but-real app, green from day one.*

- **T-001 — Scaffold pnpm + Turbo monorepo** · `chore/infra`
  Packages `api`, `sdk`, `web`, `shared`; root TS/ESLint/Prettier config; `.editorconfig`, `.gitignore`. Deps: —
- **T-002 — NestJS API skeleton + health endpoint** · `feat/api`
  `GET /health` returns ok; OpenAPI/Swagger UI mounted at `/docs`. Deps: T-001
- **T-003 — Postgres + Prisma init + base schema migration** · `feat/api`
  `users`, `wallets`, `transactions`, `wallet_balances` per `CLAUDE.md` §4; `pnpm bootstrap` runs migrate. Deps: T-001, T-003a
- **T-003a — Dockerized local infra (`docker-compose`)** · `chore/infra`
  `docker-compose.yml` with Postgres + **anvil**; `pnpm bootstrap` runs `docker compose up -d` → migrate → seed;
  master encryption key via env (`MASTER_ENCRYPTION_KEY`). Deps: T-001
- **T-004 — CI pipeline (GitHub Actions)** · `chore/infra`
  install → lint → typecheck → test → build on every push to `main` (direct commits; no PR gate). Deps: T-001
- **T-005 — Conventional commits + semantic-release** · `chore/infra`
  commitlint + semantic-release on `main`; tag `v0.1.0`. Deps: T-004
- **T-006 — README skeleton + one-command bootstrap** · `docs`
  `pnpm i && pnpm bootstrap && pnpm dev`; placeholder for diagrams (filled in Block 8). Deps: T-001
**Block DoD:** commit directly to `main`, CI green, **`v0.1.0`**.

---

## Block 2 — Auth & wallet creation (custody core)  → `v0.2.0`
*Goal: a user can register, log in, and create a custodial wallet whose key is safely encrypted.*

- **T-007 — JWT auth (register / login)** · `feat/api`
  Argon2/bcrypt hashing; JWT guard; `/auth/register`, `/auth/login`. Deps: T-003
- **T-008 — `Signer` interface + `EncryptedKeySigner`** · `feat/api` `area:chain`
  AES-256-GCM with a master key from env (`MASTER_ENCRYPTION_KEY`); decrypt-in-memory-only;
  key never logged/returned. Test: encrypt→store→decrypt round-trip. Deps: T-003
- **T-009 — Create wallet endpoint** · `feat/api`
  `POST /wallets` → generate keypair (Viem), encrypt via Signer, persist, return **address only**. Deps: T-007, T-008
- **T-010 — Admin/web shell + auth + create-wallet UI** · `feat/web`
  React/TS app, login, "Create wallet" button, wallet list. (UI-load-bearing starts here.) Deps: T-009
**Block DoD:** commit directly to `main`, CI green, **`v0.2.0`**.

---

## Block 3 — Read & sign (balance + signMessage)  → `v0.3.0`
*Goal: see balances (native + ERC-20) with a cache, and sign messages.*

- **T-011 — Balance read + Postgres cache** · `feat/api` `area:chain`
  `GET /wallets/:id/balance` for native + ERC-20; stale-while-revalidate; returns confirmed + available. Deps: T-009
- **T-012 — `signMessage`** · `feat/api` `area:chain`
  `POST /wallets/:id/messages` → EIP-191 signature via Signer. Test vs known vectors. Deps: T-008, T-009
- **T-013 — Balance-refresh service** · `feat/api`
  On-read refresh + simple poller; cache holds `as_of_block`. Deps: T-011
- **T-014 — Wallet dashboard UI (balances + sign)** · `feat/web`
  Show confirmed/available per asset; sign-message control. Deps: T-011, T-012
**Block DoD:** commit directly to `main`, CI green, **`v0.3.0`**.

---

## Block 4 — sendTransaction + concurrency  → `v0.4.0`
*Goal: send native + ERC-20 correctly under concurrency, with policy + idempotency.*

- **T-015 — Policy engine (pre-sign)** · `feat/api`
  Allowlist + per-tx/daily limits + optional approval; enforced before signing; deny paths tested. Deps: T-009
- **T-016 — Nonce lock + idempotency (Postgres)** · `feat/api` `area:chain`
  Per-wallet **Postgres advisory lock** (`pg_advisory_xact_lock`) behind a `Lock` interface (Redis impl = documented
  scale path); idempotency via the `transactions.idempotencyKey @unique` constraint (insert-or-conflict). Tests:
  N concurrent sends → unique monotonic nonces; same key → one broadcast. Deps: T-003
- **T-017 — `sendTransaction` (native + ERC-20)** · `feat/api` `area:chain`
  `POST /wallets/:id/transactions`; authoritative live nonce/balance read; build → sign → broadcast; persist
  `pending`; return hash. Deps: T-015, T-016
- **T-018 — Confirmation watcher (`@nestjs/schedule` poller)** · `feat/api`
  Polls `transactions` where `status='pending'`, checks receipts, sets confirmed/failed, triggers balance refresh +
  optimistic pending debit. Durable via Postgres rows (no queue). Deps: T-017
- **T-019 — Global error handling + chain-error mapping** · `feat/api`
  Exception filter + consistent JSON; map insufficient-funds/nonce/RPC errors; surfaced in UI. Deps: T-017
- **T-020 — Send + tx-status UI** · `feat/web`
  Send form (native + token), pending/available reflection, tx status, error display. Deps: T-017, T-019
**Block DoD:** commit directly to `main`, CI green, **`v0.4.0`**.

---

## Block 5 — Admin view & demoability  → `v0.5.0`
*Goal: everything is demoable and resettable from the browser.*

- **T-021 — DB reset / re-seed** · `feat/api` `feat/web`
  `POST /admin/reset` (dev-gated + confirm) + "Start over" button; seed data. Deps: T-003
- **T-022 — Blockchain inspector** · `feat/web` `area:chain`
  Etherscan/Sepolia deep-links for addresses & tx hashes, tx-hash lookup, faucet link, force balance-refresh. Deps: T-011, T-017
- **T-023 — Audit log + log/observability view** · `feat/api` `feat/web`
  `audit_log` of sensitive actions; recent-logs/audit panel. Deps: T-007
- **T-024 — Concurrency demo button** · `feat/web` `area:chain`
  "Fire N concurrent sends" → shows no collisions + serialized nonces in logs (makes the lock demoable). Deps: T-016, T-017
**Block DoD:** commit directly to `main`, CI green, **`v0.5.0`**.

---

## Block 6 — SDK, example code & deploy  → `v0.6.0`
*Goal: a typed client, example code, and a live deployed environment.*

- **T-025 — Typed TS SDK over the OpenAPI spec** · `feat/sdk`
  Generated/typed client covering all endpoints. Deps: T-017
- **T-026 — Example scripts** · `docs` `feat/sdk`
  Runnable examples: create wallet, get balance, sign, send (native + token). Deps: T-025
- **T-027 — Deploy (+ Dockerfiles)** · `chore/infra`
  **Dockerfile for `api`** (pollers run in-process, no separate worker); Vercel (web) + Railway/Render (api) + Neon (pg);
  env docs; Swagger UI public. Deps: T-004
**Block DoD:** commit directly to `main`, CI green, **`v0.6.0`**, deployed URL in README.

---

## Block 7 — Nice-to-haves (+N, sequential) + bonus  → `v0.7.x`
*Goal: the optional features, in dependency order. Each is its own minor bump. The two
flagged **(light)** are deliberately scoped thin (high effort / tangential to the custody story).*

- **T-028 — Many accounts per user** · `stretch` — labels on wallets; UI to manage several. Deps: T-009
- **T-029 — Account ↔ account transfers (checking/savings)** · `stretch` — internal transfer between a user's wallets. Deps: T-017
- **T-030 — Shared wallet access (invite + roles)** · `stretch` — `wallet_access` (owner/spender/viewer) + authz + invite UI. Deps: T-007, T-017
- **T-031 — Transaction history (on/off-chain)** · `stretch` — `GET /wallets/:id/transactions` + history UI. Deps: T-018
- **T-032 — Contract read/write (generic call)** · `stretch` `area:chain` — read/write arbitrary contract methods via the API. Deps: T-017
- **T-033 — XMTP messaging (light)** · `stretch` — minimal wallet-to-wallet message; scoped thin. Deps: T-009
- **T-034 — Smart-wallet design (light / spike)** · `stretch` — design note + small spike (EIP-7702/4337), not full build. Deps: —
- **T-035 — ★ BONUS: `ShamirSigner` (2-of-2 key split)** · `bonus` `area:chain` — drop-in `Signer` impl; full key never persisted; MPC framed as next step in the writeup. The headline security feature. Deps: T-008
**Block DoD:** commit directly to `main`, CI green, version bumps per feature (**`v0.7.x`**).

---

## Block 8 — Hardening, writeup & README diagrams  → `v1.0.0`
*Goal: the finish — the things that make it production-quality.*

- **T-036 — Security writeup** · `docs` — threat model, custody spectrum (encrypted-key → Shamir → MPC → non-custodial), honest weaknesses, **how-it-scales** (durable-nonce pools, MPC, webhooks — documented not built). Deps: —
- **T-037 — E2E happy-path test + coverage pass** · `test` — create → faucet-fund → balance → send → confirmed. Deps: T-027
- **T-038 — README with Mermaid system diagrams** · `docs` — architecture + sequence (sendTransaction w/ nonce lock) diagrams at the end; run/demo instructions; deployed URL. Deps: T-036
- **T-039 — Final polish + `v1.0.0`** · `chore` — naming/readability sweep, DEVLOG block recaps complete, demo dry-run. Deps: all
**Block DoD:** commit directly to `main`, CI green, **`v1.0.0`**, README complete.

---

### Counts
Core (Blocks 1–6): **28 tickets** · Nice-to-haves + bonus (Block 7): **8** · Finish (Block 8): **4** → **40 total**,
in **8 blocks**. (Core comfortably covers the required must-haves + focus areas; stretch tranche covers every
optional idea; T-035 is the bonus.)
