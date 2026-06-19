# Methodology — AI-Assisted Development

This project was built with an AI coding agent (Claude Code) operating under a **human-authored governing
spec**, one block at a time, with test-first development on all logic, a hard simplicity gate, and
"run-the-commands-before-you-claim-done" verification. The interesting part isn't the tool — it's the
discipline imposed on it so the output stayed **correct, legible, and right-sized**. This doc records that
process; the decisions were mine, the typing was the agent's.

---

## 1. Governing spec — one source of truth

Everything is governed by [`CLAUDE.md`](../CLAUDE.md), read top-to-bottom before any code. Its **Prime
Directive**: *maximize thoroughness and professionalism, subject to minimizing bloat, over-engineering, and
unreadability* — with the full requirement set in [`docs/REQUIREMENTS.md`](REQUIREMENTS.md) as the north star.

- **Simplicity is the chief constraint.** Boring, obvious code wins; the only deliberate abstraction seam is
  the pluggable `Signer`. Over-engineering is treated as a defect, equivalent to a failing test.
- **The plan is the issue tracker.** [`tickets.md`](../tickets.md) → GitHub issues; **milestones = blocks.**
  Each issue is self-contained (background + requirements tie-in + concrete acceptance criteria), so "done"
  is defined per-issue, not by ritual.
- **A readability gate** (CLAUDE.md §3.1): before each commit, re-read the diff and ask *"would a new engineer
  understand this file from its name + 30 seconds of reading?"* If not, simplify.

## 2. The per-ticket loop

Every ticket followed the same loop, designed to keep the agent honest and prevent thrash:

1. **Mode declaration** (the main anti-churn guard) — one line up front: `mode = logic` → test-first TDD; or
   `mode = config/scaffold/schema` → smoke-check only. This stops the agent from building a test harness to
   "test" configuration (a real failure mode early on).
2. **Brainstorm** the block's design before code (light when specified, real when ambiguous).
3. **Test-first** for logic — a failing test, then implement to green (signing, encryption, nonce
   serialization, idempotency, policy, balance math).
4. **Systematic debugging** — diagnose root cause before patching, especially for crypto/nonce.
5. **Verification before completion** — actually run `lint + typecheck + test + build` (and exercise the UI
   for user-facing work) and paste the **real** output. No "should pass."
6. **Commit directly to `main`** (no PR ceremony — deliberate, to cut overhead), then append a
   [`DEVLOG.md`](../DEVLOG.md) entry.

**Anti-churn rule:** if a ticket isn't converging after ~2 honest attempts, stop and narrow scope or ask —
don't grind. Over-thoroughness on a setup ticket is a defect, same as over-engineering.

## 3. The DEVLOG — a transparent build record

The last step of every ticket is an append-only [`DEVLOG.md`](../DEVLOG.md) entry: what & why, how it works,
files touched, the key code, tests (red→green), how to verify, and gotchas — each ≤ ~120 words, every file/commit/issue
a clickable link. It's the honest, real-time record of how the codebase came to be, including the course-corrections
(see §6). Reading it back-to-front is the fastest way to understand both the system and the reasoning.

## 4. Tooling & quality gates

- **Claude Code** as the coding agent, driven by the spec above.
- **Skills / disciplines applied per ticket:** brainstorming (design-before-code), test-driven-development,
  systematic-debugging (root-cause before patch), verification-before-completion (evidence before claims),
  and code-review passes on the gnarly tickets.
- **CI on every push to `main`:** install → lint → typecheck → **test** → build. A red `main` blocks the next
  ticket. **semantic-release** + Conventional Commits drive the version bumps.
- **Local infra is one command:** `docker compose` brings up Postgres + a local **anvil** chain, so the whole
  app runs offline with no external accounts; the same code runs against Sepolia by swapping one RPC URL.

## 5. Multi-agent review — AI checking AI, adversarially

For high-stakes review I used **parallel-agent orchestration** rather than a single pass:

- An **adversarial code audit** of the concurrency-critical block: independent agents reviewed across separate
  lenses (correctness/double-spend, over-engineering, requirements-fit, test honesty), and **every finding was
  handed to a separate agent that tried to refute it against the actual code** before it was accepted. The
  review could not rubber-stamp itself; I read only the synthesized, verified result.
- **Scoping/recon passes** to classify remaining work by risk and dependency before committing to it.

The audit caught real issues (a policy time-of-check/time-of-use race, an idempotency-conflict path returning
a 500, a daily-limit that counted reverted transactions) — all fixed and re-verified. AI did the breadth; the
adversarial step kept it from confidently shipping plausible-but-wrong conclusions.

## 6. Judgment & right-sizing — the decisions that mattered

The agent typed; the engineering judgment was the human input. The decisions worth highlighting:

- **Postgres over Redis for concurrency.** Per-wallet nonce serialization uses a Postgres **advisory lock**
  behind a one-method `Lock` interface; idempotency is a `@unique` constraint; pending-tx tracking is a
  scheduled poller over durable rows. No Redis/queue — it's the minimal *correct* mechanism at this scale,
  and a `RedisLock` is the documented multi-node scale path behind the same seam. "I right-sized, and I know
  exactly when to scale it" over "I added Redis."
- **A deliberate simplification sweep.** Mid-project, three features that had drifted beyond the brief were
  cut or rebuilt: rate-limiting was **removed** (documented as a scale-path), a tamper-evident hash-chained
  audit ledger was **replaced** by the requirement-true on/off-chain activity history (*the history is the
  audit*), and a dual-gated reset was **collapsed** to a single guard. Net change for that block was
  *subtractive* while better matching the requirements — mapping tightly to the brief is the professionalism.
- **A hand-written typed SDK over OpenAPI codegen** — ~130 legible lines a reviewer can read in one sitting,
  versus a generator dependency and generated noise for an ~8-endpoint API.

## 7. Block-by-block

| Block | Goal | Shipped |
|---|---|---|
| 1 — Foundation & CI | A monorepo that lints/tests/builds/deploys, green from day one | pnpm+Turbo workspace, NestJS skeleton + Swagger, Postgres+Prisma, Dockerized anvil, GitHub Actions CI, semantic-release |
| 2 — Custody core | Register/login + a custodial wallet whose key is safely encrypted | JWT auth (argon2), the `Signer` seam + `EncryptedKeySigner` (AES-256-GCM, decrypt-in-memory-only), create-wallet, the React admin shell |
| 3 — Read & sign | Balances (cached) + message signing | `getBalance` (native + ERC-20) with a stale-while-revalidate Postgres cache, `signMessage` (EIP-191), balance refresher, dashboard UI |
| 4 — Send + concurrency | `sendTransaction` correct under concurrency | Per-wallet advisory-lock critical section, live nonce sourcing, idempotency, a pre-sign policy gate, a confirmation-watcher poller, one global RFC-7807 error shape |
| 5 — Demoability | Everything demoable & resettable from the browser | DB reset/re-seed, a chain inspector (Etherscan deep-links, faucet, tx lookup), unified on/off-chain **activity history**, a live concurrency-demo button |
| 6 — SDK, examples & deploy | A typed client, runnable examples, a live environment | Typed `VencuraClient` + 5 example scripts, and a **live deployment** (Railway API + Vercel SPA + Neon Postgres + Sepolia) |
| 7 — Stretch + bonus | Optional ideas, in dependency order | (Selective — scoped to what adds signal without bloat) |
| 8 — Hardening & writeup | The finish | [`docs/SECURITY.md`](SECURITY.md) (threat model, custody spectrum, honest weaknesses, scale path), an E2E happy-path, README + diagrams |

## 8. Security & honesty

[`docs/SECURITY.md`](SECURITY.md) is the highest-value evaluated deliverable: a threat model, the custody
spectrum (encrypted-key *built* → Shamir → MPC → non-custodial *designed*), and — deliberately — an **honest
weaknesses** section that names the single-master-key risk, open registration, and the features cut as
designed-not-built. Every claim in it was cross-checked against the shipped code; the aspirational parts are
labeled as such. The point of the methodology is the same as the point of that section: be accurate about what
is built, what is designed, and why the line is where it is.

---

*TL;DR — an AI agent did the implementation under a tight, human-authored spec with test-first discipline, a
simplicity gate, real-output verification, and adversarial multi-agent review. The engineering value is in the
governance and the right-sizing decisions, not the keystrokes.*
