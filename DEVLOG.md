# VenCura — DEVLOG

> Append-only, per-ticket teaching log (newest at the bottom). Every reference is a clickable
> relative path or full URL so it can be followed live in the IDE's Markdown preview. See `CLAUDE.md` §12.

---

## v0.1.0 · Block 1 · T-001 Scaffold pnpm + Turbo monorepo &nbsp;([#1](https://github.com/xbt-a4224j/vencura/issues/1) · [commit](https://github.com/xbt-a4224j/vencura/commit/c521adf29abd24e3daf79682fd69b4fb110680a1))

**What & why** — Stand up the monorepo skeleton that every later ticket builds on: four workspace
packages (`api`, `sdk`, `web`, `shared`) plus one shared toolchain (TypeScript, ESLint, Prettier, Vitest)
orchestrated by Turbo. The goal of Block 1 is "an empty-but-real app that is green from day one," so this
ticket's real deliverable is a working `lint → typecheck → test → build` pipeline, not features.

**How it works** — [pnpm-workspace.yaml](pnpm-workspace.yaml) tells pnpm that every folder under
`packages/*` is a workspace package; pnpm then symlinks them into each other's `node_modules`, so an
`import` of `@vencura/shared` resolves to the local package. [turbo.json](turbo.json) declares the task
graph: `build` (and `test`/`typecheck`) `dependsOn: ["^build"]`, where the `^` means *"build my
dependencies first."* That single line is what makes `sdk`, which imports `shared`, compile against
`shared`'s freshly emitted `dist/` types instead of stale ones. Each package owns its own scripts; the
root scripts just fan out via `turbo run <task>`, which caches results so unchanged packages are skipped.

**Files touched**
- [package.json](package.json) → root: workspace scripts (`lint`/`typecheck`/`test`/`build`/`dev`) + the shared dev toolchain.
- [pnpm-workspace.yaml](pnpm-workspace.yaml) → declares the `packages/*` workspaces.
- [turbo.json](turbo.json) → the task graph + caching (`^build` ordering).
- [tsconfig.base.json](tsconfig.base.json) → one strict TS base every package extends (CommonJS, decorators on for Nest).
- [eslint.config.mjs](eslint.config.mjs) → ESLint 9 flat config; Prettier owns formatting.
- [.prettierrc.json](.prettierrc.json) · [.editorconfig](.editorconfig) · [.nvmrc](.nvmrc) → formatting + editor + Node version pin.
- [packages/shared](packages/shared) → real package: cross-package types ([src/index.ts](packages/shared/src/index.ts)) + the first test.
- [packages/api](packages/api) · [packages/sdk](packages/sdk) · [packages/web](packages/web) → stubs that build; filled by T-002 / T-025 / T-010.

**Key code** — the dependency-ordering rule that makes cross-package types work:
```jsonc
// turbo.json
"build":     { "dependsOn": ["^build"], "outputs": ["dist/**"] },
"typecheck": { "dependsOn": ["^build"] }   // shared compiles before sdk type-checks against it
```
And the per-package split that type-checks tests but never ships them: `tsconfig.json` includes `src`
(used by the editor + `tsc --noEmit`), while [tsconfig.build.json](packages/shared/tsconfig.build.json)
`exclude`s `*.test.ts` so `dist/` stays test-free.

**Tests** — [packages/shared/src/index.test.ts](packages/shared/src/index.test.ts) asserts the native asset
is `ETH`. Trivial by design: its job is to prove the Vitest harness actually runs under Turbo across the
workspace (red → green). Stub packages use `vitest run --passWithNoTests` so an empty package is green, not broken.

**Demo / verify** — `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Real output:
lint `4 successful`, typecheck `5 successful`, test `5 successful` (`shared` 1 test passed, `api`/`web` no-tests-OK),
build `4 successful`.

**Gotchas**
- **CommonJS, not ESM**, for the backend trio — chosen so NestJS decorators / `emitDecoratorMetadata` and
  Prisma work without ESM-interop friction. `web` becomes a Vite/ESM app in T-010; that boundary is fine
  because Vite bundles it independently.
- ESLint uses the **type-*unaware*** recommended set (no `parserOptions.project`) — keeps lint fast and
  config-free now; we can opt into type-aware rules later if a bug class warrants it.
- `api`/`web` `src/index.ts` are throwaway placeholders that exist only so `tsc` has something to emit;
  they name the ticket that replaces them.

### Decisions & narration
> The explanatory reasoning emitted while building this ticket, captured here so it's followable later.
- **Reordered T-003a before T-003** (the only deviation from numeric order): `prisma migrate` needs a live
  Postgres, which T-003a's `docker-compose` provides — a real dependency documented in `tickets.md`, not a preference.
- **CommonJS for the backend trio (api/sdk/shared):** chosen over ESM so NestJS decorators + `emitDecoratorMetadata`
  and Prisma work without ESM-interop friction. `web` is ESM via Vite later — fine, because Vite bundles it in isolation.
- **One test runner (Vitest) everywhere** to satisfy §3.1 "no parallel idioms." Empty stub packages stay green with
  `--passWithNoTests` rather than being faked with throwaway tests.
- **`api/sdk/web` ship as stubs** because T-001 is a *scaffold* ticket — its deliverable is a green pipeline, not
  features. Cross-package wiring is still proven now via `sdk → shared`.
- **Two commits per ticket** (code, then a DEVLOG commit that links the code commit). Single-commit self-linking is
  impossible: `--amend` changes the hash the entry would reference, so the link would always dangle.

---

## v0.1.0 · Block 1 · T-002 NestJS API skeleton + health endpoint &nbsp;([#2](https://github.com/xbt-a4224j/vencura/issues/2) · [commit](https://github.com/xbt-a4224j/vencura/commit/0571fcbf31a0ddff72afd7e98ccd836a6f647d51))

**What & why** — Turn the empty `api` stub into a real NestJS app with a `GET /health` liveness route and
auto-generated **Swagger UI at `/docs`**. Health gives deploy platforms and CI a smoke target; Swagger gives
the demo a browsable API and is the source the typed SDK is generated from later (T-025).

**How it works** — [main.ts](packages/api/src/main.ts) is the composition root: `NestFactory.create(AppModule)`
boots the app, `DocumentBuilder` + `SwaggerModule.setup('docs', …)` reflects over the controllers' decorators to
emit an OpenAPI document and serve Swagger UI. [AppModule](packages/api/src/app.module.ts) imports feature modules;
right now just [HealthModule](packages/api/src/health/health.module.ts), which registers
[HealthController](packages/api/src/health/health.controller.ts). The `@Controller('health')` + `@Get()` decorators
map the route; `@ApiTags`/`@ApiOkResponse` feed the OpenAPI spec.

**Files touched**
- [packages/api/src/health/health.controller.ts](packages/api/src/health/health.controller.ts) → the `GET /health` handler.
- [packages/api/src/health/health.module.ts](packages/api/src/health/health.module.ts) → registers the controller.
- [packages/api/src/app.module.ts](packages/api/src/app.module.ts) → composition root; imports feature modules.
- [packages/api/src/main.ts](packages/api/src/main.ts) → bootstrap + Swagger mount + listen/log.
- [packages/api/vitest.config.ts](packages/api/vitest.config.ts) → SWC transform so decorator metadata survives in tests.
- [packages/api/nest-cli.json](packages/api/nest-cli.json) → enables `nest start --watch` for dev.
- [packages/api/package.json](packages/api/package.json) → Nest runtime + test/dev toolchain.

**Key code** — the handler under test:
```ts
@Get()
@ApiOkResponse({ description: 'The API process is up and serving requests.' })
check() {
  return { status: 'ok', service: 'vencura-api', timestamp: new Date().toISOString() };
}
```

**Tests** — [health.controller.spec.ts](packages/api/src/health/health.controller.spec.ts) boots the real app via
`Test.createTestingModule` and hits it with `supertest`, asserting `200` + `status: 'ok'` + a string `timestamp`.
Red→green was real: first run failed with `Failed to load ./health.module — Does the file exist?` (feature absent),
then passed once the module existed. No mocks — it exercises the actual HTTP surface.

**Demo / verify** — `pnpm build && PORT=3111 node packages/api/dist/main.js`, then:
- `curl /health` → `{"status":"ok","service":"vencura-api","timestamp":"2026-06-17T21:06:51.181Z"}`
- `curl /docs` → `200`, `<title>Swagger UI</title>`
- `curl /docs-json` → OpenAPI doc already listing `/health`
- bootstrap log: `[Bootstrap] VenCura API listening on http://localhost:3111 (docs at /docs)`

**Gotchas**
- **Vitest + Nest decorators:** Vitest's default esbuild transform strips `emitDecoratorMetadata`, which Nest's
  type-based DI depends on. [vitest.config.ts](packages/api/vitest.config.ts) swaps in `unplugin-swc` with
  `legacyDecorator` + `decoratorMetadata` enabled. Health has no injected deps yet, but this prevents a painful
  retrofit when auth/wallets add constructor injection.
- **No global `ValidationPipe` yet** — there are no request inputs to validate this ticket, so adding it now would be
  config that does nothing (§3.1 YAGNI). It lands with the first DTO in T-007.

### Decisions & narration
> The explanatory reasoning emitted while building this ticket, captured here so it's followable later.
- **TDD for real here** (unlike the config-only T-001): health is genuine behavior, so I wrote the supertest spec
  first and *watched it fail with the missing-module error* before writing the controller. Seeing the red is the
  point — it proves the test exercises the route, not a tautology.
- **Canonical Nest dev runner (`nest start --watch`), not `tsx`/esbuild:** I know constructor-injected providers
  arrive in ~2 tickets (T-007–T-009). A `tsx` dev server would drop decorator metadata at *runtime* and break DI,
  so picking the tsc-based Nest runner now avoids ripping it out later — "one way to do a thing."
- **Production build stays on `tsc`** (consistent with every other package and already metadata-correct); SWC is used
  *only* for the Vitest transform. Two mechanisms, but each is the standard one for its job.
- **Swagger mounted now, not deferred:** it's load-bearing for both demoability (§5) and the SDK generation (T-025),
  and it's near-free — the decorators that feed it are the same ones that define the routes.

---

## v0.1.0 · Block 1 · T-003a Dockerized local infra &nbsp;([#4](https://github.com/xbt-a4224j/vencura/issues/4) · [commit](https://github.com/xbt-a4224j/vencura/commit/7b1529b2ea819b0b277e3ae5e7decf96b29bb494))

**What & why** — Give the project a one-command local backend: Postgres (the derived projection store),
Redis (locks/idempotency/BullMQ), and **anvil** (a local Foundry chain so the wallet flow works offline,
no Sepolia key required). `pnpm bootstrap` brings it all up and blocks until healthy.

**How it works** — [docker-compose.yml](docker-compose.yml) defines the three services, each with a
**healthcheck** (`pg_isready`, `redis-cli ping`, `cast block-number`). [scripts/bootstrap.sh](scripts/bootstrap.sh)
seeds `.env` from `.env.example` on first run, then `docker compose up -d --wait` — the `--wait` flag is what
makes "bootstrap" mean *"ready to use,"* not just *"containers created."* The DB migrate + seed steps get
appended to this script in T-003.

**Files touched**
- [docker-compose.yml](docker-compose.yml) → the three-service local stack + healthchecks.
- [.env.example](.env.example) → every secret/URL as a safe placeholder (the only env file committed).
- [scripts/bootstrap.sh](scripts/bootstrap.sh) → env → `up -d --wait`.
- [package.json](package.json) → `pnpm bootstrap` wired to the script.

**Key code** — readiness over mere creation, and the overridable host port:
```yaml
# docker-compose.yml
ports:
  - '${POSTGRES_HOST_PORT:-5432}:5432'   # default 5432, override when taken
healthcheck:
  test: ['CMD-SHELL', 'pg_isready -U vencura -d vencura']
```
```bash
docker compose up -d --wait   # blocks until every healthcheck passes
```

**Tests** — Infra tickets have no unit test; the verification *is* the stack reaching healthy. Real output:
all three containers `(healthy)`; host probes returned anvil `eth_blockNumber → 0x0`, Postgres
`accepting connections`, Redis `PONG`.

**Demo / verify** — `pnpm bootstrap` → `docker compose ps` shows `vencura-postgres-1/redis-1/anvil-1` all
`Up (healthy)`. Tear down with `docker compose down` (add `-v` to wipe the Postgres volume).

**Gotchas**
- **Port 5432 collisions are common** (every other Postgres dev stack wants it). Hit live during this ticket —
  another project's container owned 5432. Fix: `POSTGRES_HOST_PORT` overrides the *host* port (container stays
  5432); keep the port in `DATABASE_URL` in sync. Verified here by running Postgres on 5433.
- **`.env` is gitignored** and created by bootstrap; only `.env.example` is committed. The committed
  `MASTER_ENCRYPTION_KEY` placeholder is all-zeros — obviously not a real key (§18: never commit secrets).
- anvil needs **no** Sepolia RPC key; the real Infura key (§17) only becomes necessary at T-017.

### Decisions & narration
> The explanatory reasoning emitted while building this ticket, captured here so it's followable later.
- **Diagnosed before patching:** the bootstrap failed with `Bind for 0.0.0.0:5432 failed`. Rather than guess, I
  inspected `docker ps`/`lsof` and found an unrelated `match-signal-engine-postgres` already on 5432. Root cause =
  host clash, not a config bug — so I did *not* kill the user's other stack.
- **Why parametrize the port at all (vs. hardcode 5432):** demoability is a design driver (§3). A hardcoded port
  that clashes with the most common default is a live demo footgun — and I literally just hit it. The
  `${VAR:-default}` idiom is near-free and evidence-driven, so it's justified.
- **Why Postgres only, not redis/anvil too:** YAGNI. Only Postgres actually clashed; 6379/8545 were free. I
  parametrize on observed need, not speculation — if redis clashes later, we parametrize then.
- **The local 5433 value lives only in the gitignored `.env`;** the committed `.env.example` stays canonical at
  5432, so the repo's default is the conventional one and this machine's quirk doesn't leak into source.

---

## v0.1.0 · Block 1 · T-003 Prisma init + base schema migration &nbsp;([#3](https://github.com/xbt-a4224j/vencura/issues/3) · [commit](https://github.com/xbt-a4224j/vencura/commit/1e74c159f8a8d09ae31c907627f4359970179df2))

**What & why** — Define the derived projection store: the four base tables from §4 (`users`, `wallets`,
`transactions`, `wallet_balances`) as a Prisma schema + a committed migration, and wire a `PrismaService` so
the app connects to Postgres on boot. The chain stays the source of truth; Postgres is the cache (§4).

**How it works** — [prisma/schema.prisma](packages/api/prisma/schema.prisma) declares the models; `prisma migrate`
diffs them into versioned SQL under
[prisma/migrations/](packages/api/prisma/migrations/20260617212033_init/migration.sql), which `prisma migrate deploy`
(run by `pnpm bootstrap`) applies idempotently. [PrismaService](packages/api/src/infra/prisma/prisma.service.ts)
extends `PrismaClient` and `$connect`s in `onModuleInit`; [PrismaModule](packages/api/src/infra/prisma/prisma.module.ts)
is `@Global` so feature modules inject it without re-importing. [main.ts](packages/api/src/main.ts) loads the root
`.env` (anchored to the compiled file's dir, not cwd) before bootstrap so `DATABASE_URL` is present.

**Files touched**
- [prisma/schema.prisma](packages/api/prisma/schema.prisma) → the four base models + `TransactionStatus` enum.
- [prisma/migrations/…_init/migration.sql](packages/api/prisma/migrations/20260617212033_init/migration.sql) → the applied DDL.
- [src/infra/prisma/prisma.service.ts](packages/api/src/infra/prisma/prisma.service.ts) → lifecycle-managed client + connect log.
- [src/infra/prisma/prisma.module.ts](packages/api/src/infra/prisma/prisma.module.ts) → global provider.
- [src/app.module.ts](packages/api/src/app.module.ts) → imports PrismaModule (app now boots DB-connected).
- [src/main.ts](packages/api/src/main.ts) → loads root `.env` at startup.
- [scripts/bootstrap.sh](scripts/bootstrap.sh) → appended `db:migrate` after infra is up.

**Key code** — schema decisions that encode the values:
```prisma
amount    String  // base units (wei/token decimals) as a bigint string — never a float (§7)
encryptedPrivateKey String  // AES-256-GCM envelope written by EncryptedKeySigner (T-008)
encryptionIv        String
encryptionAuthTag   String
nextNonce Int @default(0)  // serialized by the per-wallet nonce lock (T-016)
@@unique([walletId, asset]) // one balance row per asset per wallet
```

**Tests** — None added. **T-003 is config/schema, not logic**, so the verification is a smoke check, not a unit test:
migration applies, `prisma generate` succeeds, and the app boots connected to Postgres. (See *Decisions* — I started
down a DB integration-test harness and corrected course.)

**Demo / verify** — `pnpm bootstrap` applies the migration; `node packages/api/dist/main.js` then logs
`[PrismaService] Connected to Postgres` and serves `/health`. `prisma migrate status` → `Database schema is up to date!`.

**Gotchas**
- **Monorepo env loading is cwd-fragile.** Both Prisma scripts (`dotenv -e ../../.env`) and `main.ts`
  (`resolve(__dirname, '../../../.env')`) anchor to a fixed location instead of trusting cwd — a relative `../../.env`
  failed silently earlier. One root `.env`, loaded deterministically.
- **`migrate deploy` (not `dev`) in bootstrap** — applies committed migrations non-interactively; `migrate dev`
  (which authors new migrations and can prompt) is for development only.
- `MASTER_ENCRYPTION_KEY`/key columns exist in the schema but nothing encrypts yet — that's T-008. The columns are
  here now because §4 specifies them on `wallets`.

### Decisions & narration
> The explanatory reasoning emitted while building this ticket, captured here so it's followable later.
- **Course-corrected mid-ticket (the honest version):** I first built a DB **integration-test harness** (a
  user→wallet→balance→transaction round-trip with a `vitest.setup.ts` to inject `DATABASE_URL`). It worked, but it
  cost real churn fighting Vitest's env timing, and — per steer — it's the **wrong tool for a config/schema ticket**.
  Schema is declarative; the meaningful verification is "does it apply and can the app connect," i.e. a smoke check.
  I deleted the harness and the env-injection plumbing. Lesson banked: **don't build integration harnesses for
  declarative changes** — smoke-check them.
- **Why wire `PrismaModule` into `AppModule` now** (vs. when first consumed): it's what makes "app boots connected to
  Postgres" a real, observable smoke signal, and it's needed by the very next block. The connect log doubles as a
  §9 demo line.
- **Why include auth/key columns now:** `passwordHash` and the AES-GCM envelope columns are specified on their tables
  in §4. Adding them with the base schema avoids a near-immediate migration churn for T-007/T-008; it's the natural
  shape of the entity, not speculation.
- **`@Global` PrismaModule:** Prisma is infra consumed everywhere; making it global avoids repeating its import in
  every feature module. It's a Nest decorator, not a framework — within the "boring beats clever" line.

---

## v0.1.0 · Block 1 · T-004 CI pipeline (GitHub Actions) &nbsp;([#5](https://github.com/xbt-a4224j/vencura/issues/5) · [commit](https://github.com/xbt-a4224j/vencura/commit/ee7b6fa1fd984fc0cd83e1ab0f3ea6c9cc893ed4))

**What & why** — Keep `main` green from day one: every push runs install → lint → typecheck → test → build.
Because we commit directly to `main` (§11), a red `main` is the signal that blocks the next ticket.

**How it works** — [.github/workflows/ci.yml](.github/workflows/ci.yml) defines one `verify` job on
`ubuntu-latest`: checkout → `pnpm/action-setup` (reads `packageManager` from
[package.json](package.json)) → `actions/setup-node` (Node from [.nvmrc](.nvmrc), pnpm store cached) →
`pnpm install --frozen-lockfile` → the four quality steps as separate, named steps so a failure points at
the exact stage. `concurrency` cancels superseded runs on the same ref.

**Files touched**
- [.github/workflows/ci.yml](.github/workflows/ci.yml) → the CI workflow.

**Tests** — CI is config; verification is a real run on `main`. First run after this push:
[run 27720826184](https://github.com/xbt-a4224j/vencura/actions/runs/27720826184) → **success in 53s**, every
step (Install/Lint/Typecheck/Test/Build) green.

**Demo / verify** — `gh run list` / `gh run watch` shows the run; or the Actions tab. Locally the same gate is
`pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

**Gotchas**
- **No DB service in CI** — after T-003 dropped the integration harness, no test touches Postgres, so CI needs no
  `services:` block. `prisma generate` (api `postinstall`) runs offline. Faster + simpler.
- **`--frozen-lockfile`** makes CI fail if `pnpm-lock.yaml` drifts from the manifests — catches "forgot to commit the
  lockfile" before it reaches a teammate.
- Harmless annotation: GitHub is deprecating **Node 20 for action runtimes** (checkout/setup-node run on Node 24).
  Unrelated to our app's Node 20 (`.nvmrc`), which is what runs our pnpm steps. Nothing to change now.

### Decisions & narration
> The explanatory reasoning emitted while building this ticket, captured here so it's followable later.
- **One job, separate named steps** (not a single `pnpm verify` script): when CI fails, the red step name tells you
  *which* gate broke without opening logs. Boring and legible over clever.
- **CI runs on the push that introduces it:** GitHub evaluates workflows from the pushed commit, so the workflow
  added in this commit ran for this very push — no extra trigger needed.
- **semantic-release intentionally not here:** T-004 is the quality gate; releasing/tagging is its own concern (T-005),
  so it gets its own workflow. Keeps each workflow single-purpose.

---

## v0.1.0 · Block 1 · T-005 Conventional commits + semantic-release &nbsp;([#6](https://github.com/xbt-a4224j/vencura/issues/6) · [commit](https://github.com/xbt-a4224j/vencura/commit/d4d6d2a579bce7b9c97850755dfe05e253387f96))

**What & why** — Make releases automatic and the history machine-readable: commitlint enforces Conventional
Commits, and semantic-release reads those commit types to compute the version, tag it, and publish a GitHub
release. This is what mints **v0.1.0** at the end of Block 1.

**How it works** — [commitlint.config.cjs](commitlint.config.cjs) extends `config-conventional`.
[.releaserc.json](.releaserc.json) runs semantic-release on `main` with its **bundled** default plugins
(commit-analyzer → release-notes-generator → github); no `@semantic-release/npm`, so it tags and releases
without publishing the private packages. In [.github/workflows/ci.yml](.github/workflows/ci.yml) a `release`
job `needs: verify` and runs only on push to `main`, so versions are only cut after the quality gate is green.

**Files touched**
- [commitlint.config.cjs](commitlint.config.cjs) → Conventional Commits rules (body/footer length caps off).
- [.releaserc.json](.releaserc.json) → semantic-release branches + plugins.
- [.github/workflows/ci.yml](.github/workflows/ci.yml) → `Commitlint` step + gated `release` job.

**Key code** — first release forced to 0.1.0, not 1.0.0:
```bash
git tag v0.0.0 <root-commit> && git push origin v0.0.0   # base tag → feat bumps minor → v0.1.0
```
```jsonc
// .releaserc.json — bundled plugins, no npm publish
"plugins": ["@semantic-release/commit-analyzer", "@semantic-release/release-notes-generator", "@semantic-release/github"]
```

**Tests** — Verified on real CI. commitlint locally accepts `feat(api): …` and rejects a non-conventional
message. On `main`, [run 27721147216](https://github.com/xbt-a4224j/vencura/actions/runs/27721147216) passed
verify + release; semantic-release created tag **v0.1.0** and the GitHub release (`gh release list` → `v0.1.0  Latest`).

**Demo / verify** — `git tag --list` → `v0.0.0`, `v0.1.0`; `gh release view v0.1.0`. A non-conventional commit
message turns the `Commitlint` CI step red.

**Gotchas**
- **First release would be 1.0.0 without a base tag.** Seeding `v0.0.0` makes a `feat` resolve to `0.1.0`, which is
  what the "minor-per-block → v1.0.0 at the end" plan wants.
- **`body-max-line-length` bit us live.** The T-005 commit's prose body exceeded 100 chars and turned `Commitlint`
  red (release correctly didn't run). Fix: disable the body/footer length caps — the header is what semantic-release
  reads, and the teaching prose lives in DEVLOG anyway. The already-pushed commit isn't re-linted (the range moves
  forward), so fixing forward cleared it.
- **commitlint in CI, not a husky hook** — avoids git-hook interference in this build environment; the convention is
  still enforced on `main`.

### Decisions & narration
> The explanatory reasoning emitted while building this ticket, captured here so it's followable later.
- **Lean plugin set, rely on bundled:** semantic-release ships its default plugins as dependencies, so referencing
  commit-analyzer/release-notes-generator/github needs no separate installs — and dodges version-mismatch between the
  core and the plugins. Dropping the npm plugin is what stops it trying to publish private packages.
- **Release gated on `verify` (`needs: verify`)** so a tag is never cut from a red tree. Single workflow, two jobs,
  clear ordering — over two parallel workflows racing.
- **The CI failure was *good*:** commitlint did its job (caught a malformed body) and the gate stopped a release from
  a non-conformant push. I fixed forward rather than rewriting history on `main`.

---

## v0.1.0 · Block 1 · T-006 README skeleton + one-command bootstrap &nbsp;([#7](https://github.com/xbt-a4224j/vencura/issues/7) · [commit](https://github.com/xbt-a4224j/vencura/commit/c1dab2fc5b22cf097bb37792d1cf6d03c218a6b5))

**What & why** — A front door for the repo: what VenCura is, the three-command quick start
(`pnpm i && pnpm bootstrap && pnpm dev`), the monorepo map, and a CI badge. Skeleton by design — the Mermaid
diagrams and the full security writeup are explicitly deferred to the final block (T-038/T-036).

**How it works** — Plain docs. The bootstrap commands map to what earlier tickets built: `pnpm bootstrap`
→ [scripts/bootstrap.sh](scripts/bootstrap.sh) (env → infra → migrate), `pnpm dev` → Turbo's `dev` task.

**Files touched**
- [README.md](README.md) → project intro, quick start, layout, scripts table, status, diagram/security placeholders.

**Tests** — Docs ticket: verification is Prettier-clean formatting and that every linked path
(`CLAUDE.md`, `docs/REQUIREMENTS.md`, `.env.example`, `tickets.md`, `DEVLOG.md`, `.nvmrc`) actually exists — checked.

**Demo / verify** — Open [README.md](README.md) in the Markdown preview; the CI badge reflects `main`'s status.

**Gotchas**
- Kept it a **skeleton on purpose** (§ plan): the diagram + writeup belong in Block 8 so they describe the finished
  system, not a half-built one. Placeholders name the ticket that fills them.

### Decisions & narration
> The explanatory reasoning emitted while building this ticket, captured here so it's followable later.
- **Documented what exists, not aspirations:** the quick start, scripts table, and `/health` + `/docs` lines all
  correspond to shipped behavior from T-002/T-003/T-003a — a README that overstates is worse than none.
- **Diagrams deferred, not forgotten:** an explicit placeholder pointing at T-038 keeps the README honest now and
  flags the work later, instead of hand-waving an architecture that's still being built.

---

### Block 1 recap — Foundation & CI → **v0.1.0** ✅

**Shipped:** a real monorepo (pnpm + Turbo: `api`/`sdk`/`web`/`shared`) that lints, type-checks, tests, and
builds green; a NestJS API with `GET /health` and Swagger at `/docs`; dockerized local infra
(Postgres + Redis + anvil) behind `pnpm bootstrap`; the base Prisma schema + migration with the app booting
DB-connected; GitHub Actions CI (commitlint → lint → typecheck → test → build) plus semantic-release, which cut
**v0.1.0**. Seven issues (#1–#7) closed; `main` green.

**How to demo:** `pnpm i && pnpm bootstrap && pnpm dev`, then `curl localhost:3000/health` and open `/docs`.
CI + the v0.1.0 release are on the GitHub Actions tab / Releases.

**Notable calls:** smoke-checking schema instead of a DB test harness (T-003); making the Postgres host port
overridable after a live 5432 clash (T-003a); seeding `v0.0.0` so the first release is `v0.1.0` (T-005).

> **Addendum (post-recap):** two `fix(ci)` commits that relaxed commitlint (body length, subject-case) landed after the v0.1.0 tag, so semantic-release correctly cut a patch — **Block 1 latest is `v0.1.1`**. Same scope, just a patch bump from CI-config fixes.

---

## v0.2.0 · Block 2 · T-007 JWT auth (register / login)    ([#8](https://github.com/xbt-a4224j/vencura/issues/8) · [commit](https://github.com/xbt-a4224j/vencura/commit/7ed5687))
**What & why** — Register/login with a JWT so every later wallet route can be owner-scoped. Access-token-only (YAGNI on refresh).
**How it works** — argon2id hashes the password; `JwtModule.registerAsync` issues a `{sub,email}` token; `passport-jwt` `JwtStrategy` + `JwtAuthGuard` shape `req.user`. Validation is one zod schema in `shared`, surfaced via `nestjs-zod` `createZodDto` (also feeds Swagger).
**Files touched** — [auth.service.ts](packages/api/src/auth/auth.service.ts) (hash/verify/issue) · [jwt.strategy.ts](packages/api/src/auth/jwt.strategy.ts) · [jwt-auth.guard.ts](packages/api/src/auth/jwt-auth.guard.ts) · [dto.ts](packages/api/src/auth/dto.ts) · [auth.schema.ts](packages/shared/src/auth.schema.ts) · [main.ts](packages/api/src/main.ts) (global `ZodValidationPipe` + `cleanupOpenApiDoc`).
**Key code** — `register({email,password}) → {accessToken, user}`; login returns one error for unknown-email vs bad-password (no enumeration).
**Tests** — [auth.service.spec.ts](packages/api/src/auth/auth.service.spec.ts) (hash≠plaintext, 409 dup, 401 bad pass) + [auth.e2e.spec.ts](packages/api/src/auth/auth.e2e.spec.ts) (400 invalid input, guard 401→200). 6 green.
**Demo / verify** — `curl -XPOST localhost:3000/auth/register -H 'content-type: application/json' -d '{"email":"a@b.com","password":"password123"}'` → `{accessToken,...}`.
**Gotchas** — `JwtModule.register` reads env at *import* time (undefined before dotenv/in tests) → use `registerAsync`. `nestjs-zod@5` dropped `patchNestjsSwagger`; use `cleanupOpenApiDoc`. Global RFC-7807 filter deferred to T-019.

---

## v0.2.0 · Block 2 · T-008 Signer + EncryptedKeySigner    ([#9](https://github.com/xbt-a4224j/vencura/issues/9) · [commit](https://github.com/xbt-a4224j/vencura/commit/3731063))
**What & why** — The custody centerpiece (§2): one pluggable `Signer` seam, default impl encrypts the private key with AES-256-GCM at rest.
**How it works** — `aes-256-gcm.ts` wraps `node:crypto`: a fresh 12-byte IV per encrypt, GCM auth tag verified on decrypt (tamper/wrong-key → throws). `EncryptedKeySigner.createKey()` generates a viem keypair, encrypts the key, returns `{address, ...envelope}` for the caller to persist — the key never touches the DB here, is never logged (only the address), never returned by the API. The `SIGNER` symbol token lets ShamirSigner (T-035) drop in later.
**Files touched** — [aes-256-gcm.ts](packages/api/src/signer/aes-256-gcm.ts) · [signer.ts](packages/api/src/signer/signer.ts) (interface + token) · [encrypted-key.signer.ts](packages/api/src/signer/encrypted-key.signer.ts) · [signer.module.ts](packages/api/src/signer/signer.module.ts).
**Key code** — `encrypt(pt,key)→{encryptedPrivateKey,encryptionIv,encryptionAuthTag}` (matches the Wallet columns); master key from env, **fail-fast** if ≠32 bytes.
**Tests** — [aes-256-gcm.spec.ts](packages/api/src/signer/aes-256-gcm.spec.ts) (round-trip, fresh-IV, tamper→throw, wrong-key→throw) + [encrypted-key.signer.spec.ts](packages/api/src/signer/encrypted-key.signer.spec.ts) (address derives from decrypted key; bad master key → throws). 7 green.
**Demo / verify** — `pnpm --filter @vencura/api exec vitest run src/signer` → 7 passing.
**Gotchas** — `decrypt` returns a `Buffer` (not string) so the sign-time caller (T-012) can zeroize it. `signMessage`/`signTransaction` throw until T-012/T-017 — the seam is declared, not pre-built. Nest instantiates providers eagerly at `compile()`, so the bad-key test asserts on the compile promise.

---

## v0.2.0 · Block 2 · T-009 Create-wallet endpoint    ([#10](https://github.com/xbt-a4224j/vencura/issues/10) · [commit](https://github.com/xbt-a4224j/vencura/commit/bd512b5))
**What & why** — `POST /wallets` / `GET /wallets`: a logged-in user mints a custodial wallet and lists their own. First place auth (T-007) + Signer (T-008) meet.
**How it works** — `@UseGuards(JwtAuthGuard)` + `@CurrentUser()` give the userId; the service calls `signer.createKey()`, persists `{userId, ...envelope}`, and returns **only `{id, address}`** — the encrypted key columns are written but never serialized back. List is `where: { userId }` (owner-scoped).
**Files touched** — [wallets.service.ts](packages/api/src/wallets/wallets.service.ts) · [wallets.controller.ts](packages/api/src/wallets/wallets.controller.ts) · [wallets.module.ts](packages/api/src/wallets/wallets.module.ts) (imports AuthModule + SignerModule).
**Key code** — `create(userId) → {id,address}`; `data: { userId, ...key }` spreads the column-shaped envelope straight in.
**Tests** — [wallets.service.spec.ts](packages/api/src/wallets/wallets.service.spec.ts) (no key leak, owner-scoped list) + [wallets.e2e.spec.ts](packages/api/src/wallets/wallets.e2e.spec.ts) (401 unauth, 201 returns id+address only). 17 green across the API.
**Demo / verify** — `curl -XPOST localhost:3000/wallets -H "authorization: Bearer $TOKEN"` → `{"id":...,"address":"0x..."}`.
**Gotchas** — e2e mocks a globally-`@Global()` `PrismaService`, so the test must `imports: [PrismaModule, …]` before `.overrideProvider` (override swaps an existing token, can't introduce one).

---

## v0.2.0 · Block 2 · T-010 Admin web shell + create-wallet UI    ([#11](https://github.com/xbt-a4224j/vencura/issues/11) · [commit](https://github.com/xbt-a4224j/vencura/commit/51c5b80))
**What & why** — The load-bearing admin (§8): register/login + create-wallet + list, in the browser. Converts the `web` lib stub into a Vite + React SPA.
**How it works** — A `/api` dev proxy ([vite.config.ts](packages/web/vite.config.ts)) points the SPA at Nest:3000 (same-origin, no CORS). [api.ts](packages/web/src/api.ts) is a thin typed `fetch` client that attaches `Authorization: Bearer` from a localStorage token; [auth-context.tsx](packages/web/src/auth-context.tsx) holds session state; [App.tsx](packages/web/src/App.tsx) renders the auth form → dashboard (create/list, with error + empty states).
**Files touched** — [package.json](packages/web/package.json) (vite scripts) · [tsconfig.json](packages/web/tsconfig.json) (DOM/JSX/Bundler) · [index.html](packages/web/index.html) · `src/{main,App,auth-context}.tsx` · [api.ts](packages/web/src/api.ts).
**Tests** — scaffold/UI ticket (§13): no test-first; bar is green lint/typecheck/build + a working flow.
**Demo / verify** — live end-to-end against real Postgres: register→token, `POST /wallets`→`0xbF1D…54a5`, list returns both (owner-scoped), 401 unauth, 400 bad input; DB shows each key as distinct ciphertext (fresh IV/tag), **0 plaintext keys**. UI: `pnpm --filter @vencura/api dev` + `pnpm --filter @vencura/web dev` → http://localhost:5173.
**Gotchas** — token in localStorage is a known XSS tradeoff, acceptable for the demo admin — revisit in the security writeup (T-036). web `test` stays `--passWithNoTests`.

---

### Block 2 recap — Auth & wallet creation (custody core) → **v0.2.0** ✅

**Shipped:** JWT auth (argon2id, `passport-jwt` guard, no account enumeration); the pluggable `Signer` seam with `EncryptedKeySigner` (AES-256-GCM at rest, fresh IV + verified auth tag, key never logged/returned); `POST /wallets` minting custodial wallets that return **address only**; and a React/Vite admin driving all of it. Validation is one set of zod schemas in `shared` surfaced via `nestjs-zod` (also feeds Swagger). 17 API tests green; four issues (#8–#11) closed.

**How to demo:** `pnpm --filter @vencura/api dev` + `pnpm --filter @vencura/web dev`, open http://localhost:5173 → register → **Create wallet** → a `0x…` address appears (and is stored only as ciphertext).

**Notable calls:** `JwtModule.registerAsync` to dodge import-time env reads; `nestjs-zod@5`'s `cleanupOpenApiDoc` (the old `patchNestjsSwagger` is gone); `Signer.signMessage/signTransaction` declared but deferred to T-012/T-017 (seam visible, not pre-built).

---

## v0.3.0 · Block 3 · T-011 Balance read + Postgres cache    ([#12](https://github.com/xbt-a4224j/vencura/issues/12) · [commit](https://github.com/xbt-a4224j/vencura/commit/4da9b8a))
**What & why** — `GET /wallets/:id/balance` (native + tracked ERC-20s), served stale-while-revalidate from the cache so the request path never depends on the RPC being up (§4). First chain-talking code.
**How it works** — new `infra/chain/ChainModule` wraps a viem `publicClient` behind a `PUBLIC_CLIENT` DI token (mockable; no test hits the network). `BalancesService` serves cached rows; on a stale hit it revalidates in the background, on a cold miss it awaits one refresh, on a cold miss + RPC-down it 503s. `refresh()` upserts `confirmed`+`asOfBlock`. `available == confirmed` until sends (Block 4).
**Files touched** — [chain.service.ts](packages/api/src/infra/chain/chain.service.ts) · [chain.module.ts](packages/api/src/infra/chain/chain.module.ts) · [balances.service.ts](packages/api/src/balances/balances.service.ts) · [balances.controller.ts](packages/api/src/balances/balances.controller.ts) · [wallets.service.ts](packages/api/src/wallets/wallets.service.ts) (`findOwnedOrThrow` authz seam).
**Key code** — `findOwnedOrThrow(walletId,userId)` → 404 (no enumeration), reused by T-012; balances as **bigint strings**.
**Tests** — [balances.service.spec.ts](packages/api/src/balances/balances.service.spec.ts) (hit/miss/404/503) + [balances.e2e.spec.ts](packages/api/src/balances/balances.e2e.spec.ts) + [chain.service.spec.ts](packages/api/src/infra/chain/chain.service.spec.ts). 26 green.
**Demo / verify** — `curl localhost:3000/wallets/$ID/balance -H "authorization: Bearer $TOKEN"` → `{balances:[{asset:"ETH",confirmed:"0",available:"0",asOfBlock:N}]}`.
**Gotchas** — single `RPC_URL`, fail-fast (no fallback branch). e2e imports real modules → must set `JWT_SECRET`/`RPC_URL`/`MASTER_ENCRYPTION_KEY` env (candidate for a Vitest setup file). ERC-20 symbol/decimals from config so a token-less anvil degrades to native-only.
