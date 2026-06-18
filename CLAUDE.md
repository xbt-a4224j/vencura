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

## 3.1 Simplicity & readability — operating rules (enforced, not aspirational)
Checkable rules. Part of the per-ticket DoD (§14) and the block-end review (§11):
- **Reuse over reinvention.** Use a well-known, maintained library for anything non-trivial (crypto, JWT, validation,
  HTTP, bignum) — but add each dependency *deliberately* and note **why** in the DEVLOG. Never hand-roll crypto.
- **YAGNI / no speculative generality.** Build only what the ticket needs. The **only** abstraction seam is `Signer`.
  No config-driven frameworks, plugin systems, deep inheritance, or interfaces "for later."
- **Small units, clear names.** Short functions/files; a reader infers intent from the name. If you need a comment to
  explain *what* code does, rename/refactor instead — comments explain *why*, not *what*.
- **Boring beats clever.** No metaprogramming or magic; obvious > concise. No one-liner that needs decoding.
- **One way to do a thing.** Same error shape, DTO/validation style, and naming across modules — no parallel idioms.
- **Delete > add.** No dead code, commented-out blocks, or TODOs without a linked issue.
- **Readability gate (the check):** before committing, re-read the diff and ask *"would a new engineer understand this
  file from its name + 30 seconds of reading?"* If no, simplify. Over-engineering is a defect, same as a failing test.

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
- **Validation: Zod is the single source of truth.** Schemas live in `packages/shared`; they validate API input via `nestjs-zod` (which also feeds the `ValidationPipe` + Swagger) **and** type the SDK and the web forms — one schema, no drift. Do **not** also use class-validator; one validation system, not two (§3.1).
- **Errors:** one consistent JSON error shape (RFC-7807-ish), thrown via typed exceptions, mapped by a global filter.
- **Secrets** (`MASTER_ENCRYPTION_KEY`, DB/Redis creds) come from env / secrets manager — never committed.
- **Commits:** **Conventional Commits** (`feat:`, `fix:`, `chore:`, `test:`, …) — they drive semver.
  **Reference the GitHub issue number so it auto-closes** — e.g. `feat(api): create-wallet endpoint (#10)` or a `Closes #10` footer (use the `#N`, not the `T-###` id).
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
no worktrees (deliberate, to save tokens/overhead). CI runs on every push to `main`.

**Before each ticket, declare its mode in one line** (this 10-second step is the main guard against T-003-style churn):
`mode = logic` → TDD, test-first · or `mode = config/scaffold/schema/infra` → **smoke-check only, no test harness**.
Infer from the issue label: `feat` with real behavior → **logic**; `chore` / `docs` / infra / schema / CI / deploy → **config**.
Then state the ticket's scope in one sentence and **do not exceed it** (no pre-building later tickets). **No committed design/spec/plan docs** — brainstorming is a brief in-chat step; the one-line mode declaration is the only pre-code artifact. Go straight to the failing test (`docs/specs/`, `docs/plans/` are gitignored). For each block, follow this loop:
1. **`brainstorming`** — settle the block's design before code (light if specified, real if ambiguous).
2. **`test-driven-development`** — per ticket: failing test first, then implement to green. (Strategy in §13.)
3. **`systematic-debugging`** — for any failure, diagnose root cause before patching (esp. crypto/nonce).
4. **`verification-before-completion`** — before committing: run lint + typecheck + test + build (and exercise
   the UI for user-facing tickets); paste the **real** output. No "should pass." Then re-read the diff against the §3.1 gate and simplify before committing.
5. **Commit directly to `main`** with a conventional-commit message, then append the `DEVLOG.md` entry (§12).
6. **Block end:** confirm CI is green on `main`; semantic-release tags the version bump; **generate the per-block study guide (§20)** and open it.
Optional: a quick self-review (`crit`) on a gnarly ticket before committing — but no branch/PR ceremony.
Use `subagent-driven-development` / parallel agents only for genuinely independent work (e.g. SDK while UI).

**Anti-churn:** if a ticket isn't converging after ~2 honest attempts, **stop** — narrow its scope or ask the human. Don't grind. Over-thoroughness on a setup ticket is a §3.1 defect, same as over-engineering.

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

**Brevity (enforced):** each entry is **≤ ~120 words / ~8 lines** — a skimmable index, not an essay. Link to code instead of restating it; no code dumps; **do not add fields or subsections** beyond the template above. If an entry is growing long, you're explaining in the wrong place — put it in the live chat (§19), not here.

## 13. Testing strategy (how we TDD chain code)
- **Unit (test-first):** pure logic — key-encryption round-trip (AES-GCM), `signMessage` determinism vs known EIP-191
  vectors, policy deny paths, **nonce serialization** (N concurrent sends vs a mocked provider → unique monotonic
  nonces), idempotency (same key → one broadcast).
- **Integration:** provider mocked at the boundary; a couple of tests against a local node (anvil) or Sepolia.
- **E2E:** one happy-path test (create → fund via faucet → balance → send → confirmed) in the final block.

**Scope of TDD (read this — it prevents churn):** test-first applies to **behavioral/logic** code — signing, encryption, nonce/idempotency, policy, balance math, API handlers/services. **Scaffolding / config / schema / infra tickets** (monorepo setup, docker-compose, Prisma init + schema + migration, CI, deploy) have **no meaningful failing-test-first step** — the bar is a **smoke check**: it boots, the migration applies, `prisma generate` works, the endpoint returns 200. **Do not build a DB/integration test harness to 'test' configuration** — that is churn and a §3.1 violation.

## 14. Definition of Done (every ticket)
Tests written first and green · lint + typecheck + build green · **UI surface** if user-facing · **logs** at
demo points · **errors** handled · **simplicity/readability gate (§3.1)** passed · **DEVLOG entry** appended · conventional-commit committed **directly to `main`** ·
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
to own it and will defend it later. This intentional verbosity lives in the **live session output (chat)** — it is how you teach the author as you work. It does **NOT** go into committed files: `DEVLOG.md`, code comments, and commit messages stay lean (see §12). Explain verbally; record tersely.

## 20. Per-block study guide (learning aid — REQUIRED at every block boundary; part of the DoD)
At each block boundary, generate a **self-contained, light-theme HTML study guide** → `docs/study/block-N.html` and
open it in Chrome. **Do not skip it.**

**Purpose: make the author fluent in THIS codebase** — the actual files, types, and code that shipped this block, not
generic concepts. Be **generous with length** (these are gitignored local aids, never in the submission, so depth is
free) — target a thorough walkthrough, ~2× a normal explainer. This is the one place verbosity is wanted; the DEVLOG
stays terse (§12), the study guide goes deep.

Every guide MUST include:
- **A 3-paragraph summary** near the top (its own `Summary` section, right after the one-line lead): a narrative recap of *what* the block built, the *key design decision* and why, and *how it fits / what's deferred & next*. Prose, not bullets.
- **Diagrams — at least 10 per guide.** Inline SVG, no external JS, light mode, **non-sticky** TOC, print-friendly. Diagram everything worth seeing: structure/module wiring, each request &amp; data flow, the data model, control flow, and every new mechanism the block introduced (AES-GCM encrypt + decrypt, JWT anatomy, the auth request path, DI token resolution, nonce locking…). Favor several focused diagrams over one busy one.
- **Annotated code snippets from the REAL shipped files** — for each key file, paste a focused excerpt (the signature /
  core 5–20 lines, never the whole file) under **its filepath as a heading** (e.g. `packages/api/src/...`), then explain
  *what it does and why it's written that way*, line-relevant. Quote real identifiers/types. This is the core of fluency —
  the author should recognize the file when they open it.
- **A "tour of the files" map** — every new/changed file this block, one line each on its role, so they know where things live.
- **Control/data flow** — trace one real end-to-end path through the block's code (e.g. register → hash → store → JWT).
- **Glossary** of new terms + a **20-question self-quiz with answers**. **Answers are always visible (no click-to-reveal)** and each is a full teaching explanation — a short paragraph (≈3–5 sentences) covering the mechanism *and the why*, not one line. Questions probe the real mechanisms the block introduced, not trivia.

**Sources (weave them seamlessly):** start from the block's **tickets** (what was planned) and its **`DEVLOG.md` entries** (what was built + the per-ticket *why*) as the outline and narrative, then **ground every detail in the actual shipped code** — annotated snippets with real filepaths/identifiers/types. Where the DEVLOG and the code differ, the **code is the authority**. `docs/study/` is gitignored (local), so it never bloats the submission.
