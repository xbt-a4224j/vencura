# VenCura — Project Context (CLAUDE.md)

> 🎯 **Prime directive:** maximize the **thoroughness and professionalism** of the implementation, *subject to*
> minimizing code bloat, overengineering, and unreadability. Favor **commonly-accepted, well-maintained third-party
> libraries** over reinventing — keep the dependency surface deliberate and the code legible. The full requirement
> set lives in [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — that's the **north star**; these simplicity constraints
> are how we hit it.

> Read this top-to-bottom before touching code. It is the single source of truth for *what* we're
> building, *why*, and *how we work*. The tickets live in `tickets.md`.
>
> ⚡ **Build in Teaching mode (§19):** set Claude Code output style to `Explanatory` or `Learning`, work one block at a time, commit per ticket, append to `DEVLOG.md`. **This repo is PRIVATE (§18).**

## 1. What this is
**VenCura — "the Venmo of wallets."** A backend **API platform that creates and operates custodial
Ethereum wallets** on users' behalf, plus a UI to drive it.

Core actions: create a wallet, `getBalance()`, `signMessage(msg)`,
`sendTransaction(to, amount)` — over an API, supporting the **native asset (ETH) and ERC-20 tokens**,
with a client to interact with it, a security writeup, tests, and example code. Chain: **Ethereum
Sepolia** via an Infura RPC endpoint.

## 2. Design lens & values
This is a custodial wallet platform, so the *real*
evaluation isn't "does it send a tx," it's **how we reason about key custody, transaction correctness,
and security.** Our thesis:
- **Key management is the centerpiece** — AES-256-GCM encryption at rest, a pluggable `Signer`, and an explicit
  custodial→MPC→non-custodial story.
- **Correctness under concurrency** (nonce serialization, idempotency) is treated as a first-class requirement.
- **Production-minded, not production-bloated** — we build the minimal *correct* thing and document the
  scale path rather than over-engineering a demo.

## 3. Governing principles (these win every tradeoff)
1. **Simplicity is the chief constraint.** Prefer boring, obvious code. The only "clever" abstraction we
   allow is the `Signer` seam. If a thing can be simpler, make it simpler.
2. **Demoability is a design driver.** Everything must be easy to show live: one-command bootstrap, seed
   data, an obvious happy path, a reset button.
3. **Naming & structure clarity.** Domain-clear names front-to-back: `Wallet`, `Transaction`, `Signer`,
   `PolicyEngine`, `BalanceService`, `ConfirmationWatcher`. Resource-oriented REST routes. A reader should
   understand a file from its name.
4. **The UI is load-bearing for every feature.** No capability ships without a control in the React admin.
   The admin *is* the demo. (See §8.)
5. **Logs at demo-relevant points** (§9) and **real error handling** (§10) everywhere.
6. **Own-with-full-knowledge:** every ticket appends a teaching entry to `DEVLOG.md` (§12).

## 4. Architecture (condensed — full version in `docs/architecture.html`)
- **Chain is the source of truth; Postgres is a derived, cached projection.** Balances are read from chain
  and cached; never invented in the DB.
- **Pluggable `Signer`** decouples custody model from the rest:
  `interface Signer { getAddress(walletId); signMessage(walletId, msg); signTransaction(walletId, tx) }`
  - `EncryptedKeySigner` (default): the private key is encrypted with **AES-256-GCM** using a **master key
    from env/secret (`MASTER_ENCRYPTION_KEY`). Decrypted in memory only at sign time, then zeroized. Key is
    never logged, never returned by the API.
  - `ShamirSigner` (**bonus**): 2-of-2 key split, reconstructed transiently — the full key is never persisted.
  - `MpcSigner` / non-custodial: **designed in the writeup, not built.**
- **Concurrency model** (built): per-wallet **nonce lock** (Redis; Postgres advisory lock is the no-extra-infra
  fallback) serializes the read-nonce→sign→broadcast→persist critical section; **idempotency keys** prevent
  double-broadcast; **BullMQ workers** (`ConfirmationWatcher`, `BalanceRefresher`) run async off the request path.
  Sends validate against **live** chain state (nonce + balance), never the cache.
- **Balance model:** confirmed (cached, `as_of_block`) + pending (from txs) → **available** = confirmed −
  pending − gas reserve. Stale-while-revalidate reads; optimistic pending debit on send; reorg-aware (N confs).
- **Policy engine:** allowlist + amount/daily limits + optional approval, enforced **before** signing.
- **Data model:** `users`, `wallets` (encrypted key cols + `next_nonce`), `transactions` (idempotency_key,
  nonce, status, asset, amount as **bigint string**), `wallet_balances`, `policies`, `wallet_access`, `audit_log`.

## 5. Tech stack
- **Language:** TypeScript end-to-end.
- **API:** **NestJS**, **REST + OpenAPI/Swagger** (auto Swagger UI for demoability + a generated SDK). *Not GraphQL* — overkill for command-shaped ops, cuts against simplicity.
- **DB:** Postgres + **Prisma**. **Redis** + **BullMQ** (locks, idempotency, async workers).
- **Chain:** **Viem** (Ethers is the conservative fallback), Ethereum **Sepolia** via Infura.
- **Key encryption:** AES-256-GCM with a master key from env/secret (`MASTER_ENCRYPTION_KEY`) — no external KMS, kept simple.
- **Client:** **React/TS admin** + a typed **TS SDK** package + example scripts.
- **Monorepo:** pnpm + Turbo → `packages/api`, `packages/sdk`, `packages/web`, `packages/shared`.
- **Tests:** Vitest/Jest + supertest; a local node (anvil) or Sepolia for integration.
- **Local infra: Dockerized via `docker-compose`** — Postgres + Redis + **anvil** (local Foundry node). The master encryption key comes from env (no KMS). App (`api`/`worker`/`web`) runs via `pnpm dev` against the containers. `api`/`worker`
  get Dockerfiles for deploy.
- **Deploy:** Vercel (web) · Railway/Render (api + worker) · Neon (Postgres) · Upstash (Redis) · Infura (RPC).

## 6. Repo layout
```
packages/
  api/      NestJS REST API + workers (modules: auth, wallets, transactions, balances, policy, signer, admin)
  sdk/      generated/typed TS client over the OpenAPI spec + example scripts
  web/      React/TS admin UI (load-bearing for every feature)
  shared/   shared types/zod schemas
docs/       architecture.html, security writeup
DEVLOG.md   append-only per-ticket build log (read this to learn the codebase)
tickets.md  the plan → GitHub issues
```

## 6.1 Module map (`packages/api/src`)
One **feature module per box** in the architecture diagram; the four required operations live in obvious places.
The diagram's outer edges (Postgres/Redis/Ethereum) are **infra modules** injected where needed, not features.
```
auth/          AuthModule          JWT guard, register/login
wallets/       WalletsModule       POST /wallets, GET /wallets            ← createWallet
transactions/  TransactionsModule  POST /wallets/:id/messages (sign)      ← signMessage
                                   POST /wallets/:id/transactions (send)  ← sendTransaction
                                   GET  /wallets/:id/transactions (history)
                                   + confirmation-watcher worker (co-located)
balances/      BalancesModule      GET /wallets/:id/balance (cache+live)  ← getBalance
                                   + balance-refresher worker (co-located)
policy/        PolicyModule        exports PolicyEngine (consumed by transactions, pre-sign)
signer/        SignerModule        exports Signer (EncryptedKeySigner / ShamirSigner)
admin/         AdminModule         reset/seed, chain inspector, concurrency-demo
infra/prisma/  PrismaModule        Postgres            infra/chain/  ChainModule  Viem client / RPC
infra/redis/   RedisModule         locks · idempotency · BullMQ
(key encryption is a small AES-256-GCM helper in signer/, using MASTER_ENCRYPTION_KEY from env — no separate KMS module)
```
**Coupling is intentional and minimal:** `SignerModule` is consumed by Wallets (generate+store key) and Transactions
(sign); `PolicyModule` by Transactions (pre-sign check). BullMQ processors are **co-located with the domain they serve**
(confirmation-watcher → transactions, balance-refresher → balances), sharing queue wiring from `RedisModule` — not a
separate "workers" feature. Keep modules small and domain-named; a reader should infer a module's job from its name.

## 7. Conventions
- **REST, resource-oriented:** `POST /wallets`, `GET /wallets/:id/balance`, `POST /wallets/:id/messages`
  (sign), `POST /wallets/:id/transactions` (send), `GET /wallets/:id/transactions` (history), `POST /admin/reset`.
- **Money is never a float.** Amounts are **bigint strings** (wei / token base units) end-to-end.
- **Errors:** one consistent JSON error shape (RFC-7807-ish), thrown via typed exceptions, mapped by a global filter.
- **Secrets** (`MASTER_ENCRYPTION_KEY`, DB/Redis creds) come from env / secrets manager — never committed.
- **Commits:** **Conventional Commits** (`feat:`, `fix:`, `chore:`, `test:`, …) — they drive semver.
  **Do NOT add `Co-Authored-By` lines** (per user's global rule; git config handles authorship).
- **Versioning:** **semantic-release** from Block 1. Each block ships a minor bump (v0.1.0 → … → v1.0.0 at the end).

## 8. UI-is-load-bearing rule
Every user-facing capability has a control in `packages/web`. The admin must be able to, from the browser:
create users/wallets, view balances (confirmed/available), sign a message, send native + ERC-20, set policy,
view transaction history, manage shared access, **reset/seed the DB**, **inspect the chain** (Etherscan/Sepolia
deep-links, tx-hash lookup, faucet link), view logs/audit, force a balance refresh, and **fire N concurrent
sends** to demonstrate the nonce lock. If a feature has no UI surface, the ticket is not done.

## 9. Logging (so the backend narrates the demo)
Structured logs (Nest Logger / pino) with clear, readable lines at: wallet created · balance fetched
(cache hit/miss) · message signed · tx built → signed → broadcast (with hash) · **nonce acquired/released** ·
policy pass/deny · confirmation status change · DB reset. Log levels sane; never log key material or secrets.

## 10. Error handling
Global exception filter + consistent error JSON; DTO/zod validation on every input; **chain-error mapping**
(insufficient funds, nonce too low, replacement underpriced, RPC failure) into clear user-facing messages
surfaced in the UI. No swallowed errors.

## 11. Development workflow (superpowers, per block)
We work in **6–8 blocks** (see `tickets.md`). **We commit directly to `main`** — no feature branches, no PRs,
no worktrees (deliberate, to save tokens/overhead). CI runs on every push to `main`. For each block, follow this loop:
1. **`brainstorming`** — settle the block's design before code (light if specified, real if ambiguous).
2. **`test-driven-development`** — per ticket: failing test first, then implement to green. (Strategy in §13.)
3. **`systematic-debugging`** — for any failure, diagnose root cause before patching (esp. crypto/nonce).
4. **`verification-before-completion`** — before committing: run lint + typecheck + test + build (and exercise
   the UI for user-facing tickets); paste the **real** output. No "should pass."
5. **Commit directly to `main`** with a conventional-commit message, then append the `DEVLOG.md` entry (§12).
6. **Block end:** confirm CI is green on `main`; semantic-release tags the version bump.
Optional: a quick self-review (`crit`) on a gnarly ticket before committing — but no branch/PR ceremony.
Use `subagent-driven-development` / parallel agents only for genuinely independent work (e.g. SDK while UI).

## 12. DEVLOG.md — required for every ticket
The **last step of every ticket's Definition of Done** is to append a teaching entry to `DEVLOG.md`. Write it in
**Markdown with clickable links** so it's followable in the IDE's Markdown preview in real time — link every file as
`[packages/api/src/foo.ts](packages/api/src/foo.ts)` (relative paths are clickable in VS Code/JetBrains; use
`path#L42` to jump to a line), and link the **commit** and **issue** as full URLs. Entry shape:
```
## v0.x.0 · Block N · T-### Title    ([#issue](url) · [commit](url))
**What & why** — goal + decision (1–3 sentences)
**How it works** — the mechanism, in plain teaching prose (the part you read to learn)
**Files touched** — [path](path) → one-line role each
**Key code** — the signature(s)/snippet that matter, explained
**Tests** — what was written, what they prove (red→green) — link the test file
**Demo / verify** — exact command or UI step + the real output
**Gotchas** — non-obvious tradeoffs / footguns
```
Append a short **block recap** at each block boundary (what shipped, the version, how to demo it). `DEVLOG.md` is
APPEND-ONLY and is the user's real-time, own-with-full-knowledge record of the codebase — newest entry at the bottom,
honest, legible, every reference clickable. The user follows it live by keeping the Markdown preview open.

## 13. Testing strategy (how we TDD chain code)
- **Unit (test-first):** pure logic — key-encryption round-trip (AES-GCM), `signMessage` determinism vs known EIP-191
  vectors, policy deny paths, **nonce serialization** (N concurrent sends vs a mocked provider → unique monotonic
  nonces), idempotency (same key → one broadcast).
- **Integration:** provider mocked at the boundary; a couple of tests against a local node (anvil) or Sepolia.
- **E2E:** one happy-path test (create → fund via faucet → balance → send → confirmed) in the final block.

## 14. Definition of Done (every ticket)
Tests written first and green · lint + typecheck + build green · **UI surface** if user-facing · **logs** at
demo points · **errors** handled · **DEVLOG entry** appended · conventional-commit committed **directly to `main`** ·
(block end) CI green on `main` + version bump.

## 15. CI (from Block 1)
GitHub Actions on **every push to `main`**: install → lint → typecheck → **test** → build. Keep `main` green —
a red `main` blocks the next ticket. semantic-release runs on `main` to tag versions. README (final block) ends
with **Mermaid system diagrams**.

## 16. Run / demo
`pnpm i && pnpm bootstrap` (one command: `docker compose up -d` for Postgres/Redis/anvil → env → migrate → seed) →
`pnpm dev` (api + worker + web). Reset via the
admin "Start over" button or `POST /admin/reset` (dev-gated). Fund wallets via the faucet link in the admin.

## 17. Human-in-the-loop (external accounts & secrets)
Some steps need *you* (the agent can't create accounts or fund wallets). Flag these in the relevant tickets:
- **RPC endpoint** — an Ethereum Sepolia RPC URL (Infura/Alchemy). A throwaway one may be provided; get your own key for the deployed env. → set `RPC_URL`. (T-003a / T-017)
- **Sepolia test ETH** — fund a demo wallet from a faucet so `sendTransaction` works in the demo (human action). (T-022 surfaces the faucet link.)
- **Deploy accounts + tokens** — Vercel (web), Railway/Render (api+worker), Neon (Postgres), Upstash (Redis): create accounts, add the projects, set deploy secrets. (T-027)
- **Generated secrets** — `MASTER_ENCRYPTION_KEY` (32-byte random), `JWT_SECRET`, DB/Redis URLs. `.env.example` lists them all; never commit real values.

## 18. Repository & privacy (opsec)
- **This repo is PRIVATE.** Create it with `gh repo create vencura --private` (never public). To submit, **invite the reviewer as a collaborator** on the private repo — do not flip it public.
- **Never commit secrets.** `.env` / `.env.*` are gitignored; only `.env.example` (placeholders) is committed.
- No employer/interview/identifying references anywhere in code, commits, README, or docs — keep it a clean standalone project.

## 19. Teaching mode (verbose by design — for the author's learning)
While building, **over-explain**: narrate the reasoning behind each decision, define any unfamiliar concept inline
(threshold/nonce mechanics, NestJS DI, AES-GCM, etc.), and after each ticket give a short plain-English "what I just
built and why" beyond the DEVLOG entry. Err toward *more* explanation than usual — the author is learning the codebase
to own it and will defend it later. This intentional verbosity overrides any general "be terse" default for this project.
