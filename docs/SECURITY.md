# VenCura — Security & Custody Writeup

> The brief's focus areas list **security considerations (a writeup is acceptable)**. This is that
> writeup: the threat model, the custody design and its evolution path, what's deliberately *not* built,
> and the honest weaknesses. VenCura is a **custodial** Ethereum wallet platform on **Sepolia testnet** —
> so the centerpiece isn't "can it send a tx," it's **how we reason about key custody, transaction
> correctness, and security.**

## 1. Scope & assets

| Asset | Where it lives | Protection |
| --- | --- | --- |
| **Wallet private keys** | `wallets.encryptedPrivateKey` (+ iv, authTag) in Postgres | AES-256-GCM, decrypted in memory only at sign time |
| **Master encryption key** | `MASTER_ENCRYPTION_KEY` env/secret | Never in the DB or repo; injected at runtime |
| **User credentials** | `users.passwordHash` | argon2id hash, never plaintext |
| **Session tokens** | client-held JWT | signed with `JWT_SECRET`, short-lived |
| **Admin capability** | `ADMIN_API_KEY` | gates `/admin/*` via a timing-safe header check |

Out of scope (testnet posture): real-asset loss (Sepolia ETH only), regulatory/KYC, and physical security of the
managed hosts (delegated to Railway/Neon/Vercel).

## 2. Threat model

**Actors:** an anonymous internet user (registration is open); an authenticated user (owns their wallets); a
malicious user trying to reach *another* user's wallet; an attacker who obtains a database dump; an attacker
who obtains the admin key; a network attacker (MITM).

**Trust boundaries:** browser → Vercel edge → Railway (Node/NestJS) → Neon (Postgres) and → Infura (RPC). All
hops are TLS. The API is reachable directly at its Railway URL *independent of Vercel*, so the API — not the
edge — is the security perimeter.

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Steal another user's funds | JWT auth + per-wallet ownership check (`findOwnedOrThrow`) on every wallet route | none at app layer (testnet) |
| Read a key from a DB dump | keys are AES-256-GCM ciphertext; the master key is **not** in the DB | a dump **plus** the master key = compromise (single-key risk, §7) |
| Read a key from logs/responses | key material is never logged and never returned by any endpoint | — |
| Forge/replay a transaction | per-wallet nonce lock + idempotency key (§5) | — |
| Brute-force a password | argon2id (slow by design) | no rate limiting (cut for simplicity — §7) |
| Abuse open registration | none at app layer; platform edge only | a real gap on a public deploy (§7) |
| Nuke the deployment | `/admin/*` behind a timing-safe admin key | a leaked key can `reset` (testnet data is reseedable) |
| MITM | TLS everywhere; secrets from env | — |

## 3. Key custody — the centerpiece

### 3.1 The `Signer` seam

Custody is isolated behind one interface, so the *custody model* is swappable without touching the rest of the app:

```ts
interface Signer {
  createKey(): Promise<NewKey>;
  signMessage(walletId, msg): Promise<Hex>;
  signTransaction(walletId, tx): Promise<Hex>;
}
```

This is the **only** abstraction seam in the codebase (per the Prime Directive's simplicity rule) — and it's the
seam that matters, because it's exactly where the custody spectrum below plugs in.

### 3.2 `EncryptedKeySigner` (default, built)

On wallet creation, a fresh secp256k1 key is generated, immediately encrypted with **AES-256-GCM** under the
master key, and stored as `{ encryptedPrivateKey, iv, authTag }`. At sign time the envelope is decrypted **in
memory only**, used, and dropped. AES-GCM is authenticated encryption: a tampered ciphertext or auth tag fails
to decrypt (verified by unit tests), so the DB can't silently corrupt or substitute a key. A fresh random IV
per encryption means identical keys never produce identical ciphertext.

```
create:  privkey ──AES-256-GCM(masterKey)──▶ {enc, iv, authTag} ──▶ wallets row
sign:    wallets row ──decrypt(masterKey)──▶ privkey (in RAM) ──sign──▶ signature ──▶ drop
```

### 3.3 The custody spectrum (where this goes)

| Stage | Key location | Status | Trade-off |
| --- | --- | --- | --- |
| **Encrypted-key** | full key in DB, encrypted; master key in env | **built** | simplest correct custody; single master key is the weak point |
| **`ShamirSigner`** (2-of-2 split) | key split into 2 shares, reconstructed transiently; full key never persisted | **built (bonus, `SIGNER=shamir`)** | no single stored secret reconstructs the key at rest |
| **MPC / threshold (`MpcSigner`)** | key *never exists whole* — distributed signing across parties | **designed, not built** | the production answer (this is Fireblocks' domain); removes the "key exists somewhere" risk entirely |
| **Non-custodial** | user holds the key; platform never sees it | **designed, not built** | strongest, but changes the product (no server-side signing) |

The point of the `Signer` interface is that each stage is a drop-in implementation — the wallet/transaction
code calls `signer.signTransaction(...)` and is indifferent to whether that's a local decrypt, a Shamir
reconstruction, or an MPC round.

### 3.4 What would harden the built stage

- **A real KMS/HSM** (AWS KMS, GCP KMS, CloudHSM) instead of an env master key — the master key never leaves the
  HSM; we send ciphertext in and get plaintext out, or sign inside the HSM. Removes the "master key in process
  memory / env" exposure.
- **Per-wallet data keys** wrapped by the master key (envelope encryption), so rotating the master key doesn't
  require re-encrypting every wallet.
- **Key rotation** support (versioned envelopes).

## 4. Authentication & authorization

- **Registration/login** issue a JWT signed with `JWT_SECRET`; the strategy validates signature + expiry and
  shapes `req.user = { id, email }`.
- **Every wallet/transaction route** is JWT-guarded and additionally calls `findOwnedOrThrow(walletId, userId)`
  — so authentication (who you are) and authorization (this wallet is yours) are separate, explicit checks. You
  cannot address another user's wallet even with a valid token.
- **Admin endpoints** (`/admin/seed`, `/admin/reset`) sit behind `AdminGuard`: a **timing-safe** comparison
  (`crypto.timingSafeEqual`) of the `x-admin-key` header against `ADMIN_API_KEY`, **failing closed** (no env →
  403). A single shared key, not RBAC — the data model has no roles, and inventing them for two ops endpoints
  would be speculative generality.

## 5. Transaction correctness under concurrency

Treated as a first-class security property (a double-spend / nonce reuse is a correctness *and* safety bug).

- **Per-wallet nonce lock:** the read-nonce → sign → broadcast → persist critical section runs inside a Postgres
  `pg_advisory_xact_lock` keyed by wallet id (behind a small `Lock` interface). Concurrent sends to one wallet
  serialize, so each gets a unique, consecutive nonce — demonstrated by the concurrency-demo button and example
  `05-concurrency.ts`, and asserted in unit tests.
- **Idempotency:** the `transactions.idempotencyKey @unique` constraint plus an in-lock check means a retried
  request (same key) results in exactly one broadcast — the second caller sees the first's row and returns it.
- **Validate against live chain state:** nonce and balance are read from the chain (not the cache) inside the
  lock, so a stale cache can't authorize an overspend.

## 6. Input validation, errors, and data hygiene

- **Zod is the single source of truth** for validation (shared schemas validate the API via `nestjs-zod` and
  type the SDK/web) — one schema, no drift.
- **Money is never a float:** amounts are bigint strings (wei / token base units) end to end.
- **Errors** go through a global filter emitting a consistent RFC-7807-ish shape. Recognized chain errors
  (insufficient funds, nonce too low, replacement underpriced, RPC down) map to clear messages; anything else is
  a generic 500 with the detail logged **server-side only** — no stack traces or secrets in the client body.

## 7. Honest weaknesses (known gaps)

We build the minimal *correct* thing and document the rest — these are deliberate, not oversights:

- **Single master key.** A DB dump *plus* the `MASTER_ENCRYPTION_KEY` compromises every wallet. Mitigation is a
  KMS/HSM (§3.4); not built to keep the demo dependency-light.
- **Open registration, no rate limiting.** Anyone can register and create (custodial) wallets, and there's no
  app-level throttle on `/auth/*` or wallet creation. A per-IP rate limiter was built and then **removed for
  simplicity** — for a public deploy it's a real gap, mitigated only by Vercel/Railway edge protection. The
  documented fix is `@nestjs/throttler` (in-memory now, Redis-backed at multi-node scale).
- **Admin key is a shared secret.** No rotation, no per-action audit of admin use; a leak lets the holder
  `reset` the deployment (testnet data is reseedable, so blast radius is bounded).
- **No MFA, no email verification, no password reset.** Out of scope for the brief.
- **Activity history is not tamper-evident.** The on/off-chain history is a *read* over the `transactions` and
  `signed_messages` tables — it answers "what happened," but a DB-level attacker could alter it. A tamper-evident
  hash-chained ledger was designed and deliberately *not* built (it exceeded the "show history" requirement); it's
  the documented upgrade if audit integrity becomes a requirement.
- **Custodial by definition.** The platform can sign on a user's behalf — the user trusts the operator. The
  non-custodial path (§3.3) is the answer when that trust isn't acceptable.

## 8. How it scales (documented, not built)

- **Custody → MPC.** Swap `EncryptedKeySigner` for an `MpcSigner` (or a Fireblocks-style threshold-signing
  backend) behind the same `Signer` interface — the key never exists whole.
- **Concurrency → durable nonce pools.** The single advisory lock per wallet is correct but serializes one
  wallet's sends; at high throughput, a per-wallet **nonce pool / allocator** (pre-reserved nonce ranges, gap
  handling, re-broadcast of stuck txs) removes the serialization bottleneck.
- **Locking → Redis.** The `Lock` interface's documented multi-node implementation is a Redis lock (the advisory
  lock is single-Postgres).
- **Confirmation → webhooks.** The `@nestjs/schedule` poller (`ConfirmationWatcher`) is durable but polling; at
  scale, RPC provider webhooks / a log-subscription replace polling.
- **Secrets → KMS + rotation.** Per §3.4.
- **Abuse control → edge WAF + app rate limiting.** Re-introduce throttling (Redis-backed) and a platform WAF.

## 9. Deployment security

Secrets (`MASTER_ENCRYPTION_KEY`, `JWT_SECRET`, `ADMIN_API_KEY`, `DATABASE_URL`, `RPC_URL`) come from the host's
environment / secret store — never committed (only `.env.example` placeholders are in the repo). TLS terminates
at every hop (Vercel, Railway, Neon `sslmode=require`). The web SPA contains **no** secret — the admin key is
operator-entered and kept in `localStorage`, never baked into the bundle.
