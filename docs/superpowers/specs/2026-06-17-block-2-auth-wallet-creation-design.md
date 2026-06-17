do # Block 2 — Auth & wallet creation (custody core) → `v0.2.0`

**Status:** approved design (2026-06-17) · **Tickets:** T-007, T-008, T-009, T-010 · **Prereqs:** Block 1 (`v0.1.1`)

> Goal (tickets.md): *a user can register, log in, and create a custodial wallet whose key is safely encrypted.*
> This block builds the **custody core** — the centerpiece of the project (CLAUDE.md §2). The real bar isn't
> "it stores a key," it's *how we reason about key custody*: the key is generated, AES-256-GCM-encrypted at rest,
> never returned by the API, never logged.

## Decisions settled in brainstorming
| Fork | Decision | Why |
|---|---|---|
| Request validation / DTOs | **zod schemas in `packages/shared`**, consumed via `nestjs-zod` `createZodDto` in `api` | Single source of truth across api+sdk+web (CLAUDE.md §6 names "shared/ shared types/zod schemas"); §3.1 "one way to do a thing". `nestjs-zod` makes one schema both the runtime validator and the OpenAPI/Swagger definition — and Swagger is the contract the SDK (T-025) is generated from (§5). |
| JWT token model | **Access token only** | Simplest correct thing for a custodial demo; YAGNI on refresh-token rotation (§3 simplicity-first). |
| Password hashing | **argon2 (argon2id)** | Modern OWASP-recommended, memory-hard. Prebuilt binaries → expected to pass CI; verified in T-007. |
| Keypair generation location | **Inside the `Signer`** (`createKey()`) | Wallet service stays custody-agnostic; all key material lives behind the one allowed abstraction seam (CLAUDE.md §3, §6.1 "Wallets generate+store key via Signer"). |
| Auth guard library | **`passport-jwt`** (with `@nestjs/jwt` + `@nestjs/passport`) | Canonical Nest JWT auth; recognizable to any engineer (§3.1 readability gate); no hand-rolled token verification. |

## New dependencies (deliberate — each noted in DEVLOG per §3.1)
- `packages/shared`: `zod`
- `packages/api`: `nestjs-zod`, `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt` (+ `@types/passport-jwt`), `argon2`, `viem`
- `packages/web`: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom` (converts the current lib stub into a real SPA)

Pin `zod` to a version compatible with the chosen `nestjs-zod` release; resolve exact versions during planning/install.

## Configuration (already present in `.env.example` — no new env work)
- `MASTER_ENCRYPTION_KEY` — 32-byte hex, AES-256-GCM master key. Parsed/validated at startup; fail fast if missing or not 32 bytes.
- `JWT_SECRET` — HMAC signing secret for access tokens.
- (`RPC_URL` / `ANVIL_RPC_URL` exist but are **not** used this block — chain reads/sends start Block 3/4.)

## What the schema already gives us (Block 1)
`packages/api/prisma/schema.prisma` already declares:
- `User { id, email @unique, passwordHash, createdAt, wallets[] }`
- `Wallet { id, userId, address @unique, encryptedPrivateKey, encryptionIv, encryptionAuthTag, nextNonce @default(0), createdAt }`

**No schema migration is needed in Block 2** — we fill the existing contract. The decomposed envelope columns
(`encryptedPrivateKey` / `encryptionIv` / `encryptionAuthTag`) fix the storage shape T-008 must honor.

---

## T-007 — JWT auth (register / login) · `feat/api` · **mode = logic (TDD)**
**Module `auth/`:** `AuthController`, `AuthService`, `JwtStrategy` (passport), `JwtAuthGuard`, `@CurrentUser()` param decorator.

- `POST /auth/register` — body `{ email, password }` → argon2-hash → persist `User` → issue JWT → `{ accessToken, user: { id, email } }`. Duplicate email → `ConflictException` (409).
- `POST /auth/login` — fetch by email → `argon2.verify` → same response. Bad creds → `UnauthorizedException` (401) (same message for unknown-email vs wrong-password — no account enumeration).
- JWT payload `{ sub: userId, email }`, signed with `JWT_SECRET`; `JwtAuthGuard` populates `req.user`.
- **Schemas (shared):** `RegisterSchema`, `LoginSchema` (valid email; password min length).
- **Errors (this block):** standard Nest `HttpException`s only. The global RFC-7807 exception filter is **T-019 (Block 4)** — not built here (no pre-building later tickets, §11).
- **Logs (§9):** "user registered" / "login succeeded" — never password or hash.
- **Tests (red→green):** register issues a verifiable token + persists an argon2 hash (not plaintext); duplicate email → 409; login wrong password → 401; `JwtAuthGuard` rejects missing/invalid token and accepts a valid one.

## T-008 — `Signer` interface + `EncryptedKeySigner` · `feat/api area:chain` · **mode = logic (TDD)** — centerpiece
**Module `signer/`.** Never hand-roll crypto beyond composing `node:crypto` primitives correctly (§3.1).

- `aes-256-gcm.ts` — pure helper:
  - `encrypt(plaintext, masterKey) → { ciphertext, iv, authTag }` (random 12-byte IV per call).
  - `decrypt({ ciphertext, iv, authTag }, masterKey) → plaintext`; **throws** on auth-tag mismatch.
  - Parses `MASTER_ENCRYPTION_KEY` (32-byte hex). Zeroizes the decrypted private-key buffer after use.
- `Signer` interface — the full CLAUDE.md §4 contract is **declared**: `getAddress(walletId)`, `signMessage(walletId, msg)`, `signTransaction(walletId, tx)`, **plus `createKey()`**.
- `EncryptedKeySigner` — Block 2 **implements** `createKey()` + `getAddress()`. `signMessage`/`signTransaction` throw an explicit "implemented in T-012 / T-017" error (seam visible, not pre-built).
  - `createKey()`: `generatePrivateKey()` (viem) → derive checksummed address → encrypt the private key → return `{ address, encryptedPrivateKey, encryptionIv, encryptionAuthTag }`. Does **not** touch the DB.
  - `getAddress(walletId)`: read `wallet.address` from Postgres.
- `SignerModule` exports the `Signer` (consumed by `WalletsModule` in T-009).
- **Tests:** encrypt→decrypt round-trip returns the original; tampering the auth tag → decrypt throws (proves GCM authentication); `createKey` yields a valid address whose key decrypts back to the generated private key; key/secret never appears in any return value of `getAddress`.

## T-009 — Create wallet endpoint · `feat/api` · **mode = logic (TDD)**
**Module `wallets/`:** `WalletsController` (`POST /wallets`, `GET /wallets`), `WalletsService`. Guarded by `JwtAuthGuard`.

- `POST /wallets` — `signer.createKey()` → persist `Wallet { userId: currentUser, address, ...envelope }` → return **`{ id, address }` only**.
- `GET /wallets` — current user's wallets `{ id, address, createdAt }`, filtered by `userId`.
- **Logs:** "wallet created" + address. Never the key/envelope.
- **Tests:** create returns `{ id, address }` and **no** key material; the envelope is persisted (decrypts back); list is owner-scoped (user A cannot see user B's wallets); unauthenticated request → 401.

## T-010 — Admin web shell + auth + create-wallet UI · `feat/web` · **mode = scaffold + UI (manual verify)**
- Convert `packages/web` (current `tsc`/lib stub) → **Vite + React + TS** SPA. Keep `lint` / `typecheck` / `test` green so CI stays green (web `test` may remain `--passWithNoTests` plus an optional smoke test).
- Register/login form → store the access token (localStorage) → a thin typed `fetch` client attaching `Authorization: Bearer`.
- "Create wallet" button + wallet list rendering addresses. Load-bearing UI (§8): every Block 2 capability is reachable from the browser.
- **Verify:** exercise the real flow in the browser — register → log in → create wallet → see the address; paste the real result in the DEVLOG (§13: UI exercised, not heavily unit-tested).

---

## Build order
T-007 and T-008 are independent (can run in parallel) → **T-009** depends on both → **T-010** depends on T-009.

## Scope guards (do NOT pre-build)
- Global exception filter / RFC-7807 shape → **T-019 (Block 4)**.
- `signMessage` implementation → **T-012 (Block 3)**; `signTransaction` / nonce / sending → **Block 4**.
- Balance reads → **Block 3**. `Wallet.nextNonce` stays at its schema default this block.
- No refresh tokens, no roles/shared access (T-030), no `ShamirSigner` (T-035 bonus).

## Definition of Done (per ticket, CLAUDE.md §14)
Tests written first & green (logic tickets) · lint + typecheck + build green · **UI surface** (T-010) · **logs** at demo points · **errors** handled (standard Nest exceptions this block) · §3.1 readability gate · **DEVLOG entry** · conventional commit direct to `main`.
**Block DoD:** CI green on `main`, semantic-release cuts **`v0.2.0`**.
