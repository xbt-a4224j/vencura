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
and **anvil** (a local Foundry chain so the wallet flow works offline,
no Sepolia key required). `pnpm bootstrap` brings it all up and blocks until healthy.

**How it works** — [docker-compose.yml](docker-compose.yml) defines the three services, each with a
**healthcheck** (`pg_isready`, `cast block-number`). [scripts/bootstrap.sh](scripts/bootstrap.sh)
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
`accepting connections`.

**Demo / verify** — `pnpm bootstrap` → `docker compose ps` shows `vencura-postgres-1/anvil-1` all
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
- **Why parametrize only Postgres' port:** YAGNI. Only Postgres actually clashed; 8545 was free. I
  parametrize on observed need, not speculation — if anvil clashes later, we parametrize then.
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
(Postgres + anvil) behind `pnpm bootstrap`; the base Prisma schema + migration with the app booting
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

---

## v0.3.0 · Block 3 · T-012 signMessage (EIP-191) + POST /wallets/:id/messages    ([#13](https://github.com/xbt-a4224j/vencura/issues/13) · [commit](https://github.com/xbt-a4224j/vencura/commit/d8c254f))
**What & why** — Sign an arbitrary message with a wallet's key (EIP-191). First code that *uses* the private key, so it exercises the full decrypt→sign→zeroize path.
**How it works** — `EncryptedKeySigner.signMessage` loads the envelope, `decrypt()`s to a Buffer, builds a viem account, signs, and **zeroizes the buffer in `finally`** (the reason `decrypt` returns a Buffer, T-008). The endpoint lives in `transactions/` per §6.1; the controller calls `findOwnedOrThrow` (authz) *before* touching the key.
**Files touched** — [encrypted-key.signer.ts](packages/api/src/signer/encrypted-key.signer.ts) (signMessage) · [messages.controller.ts](packages/api/src/transactions/messages.controller.ts) · [transactions.module.ts](packages/api/src/transactions/transactions.module.ts) · [message.schema.ts](packages/shared/src/message.schema.ts).
**Key code** — `signMessage(walletId,message)`; `finally { keyBuf.fill(0) }`.
**Tests** — [encrypted-key.signer.spec.ts](packages/api/src/signer/encrypted-key.signer.spec.ts): signature **recovers to the wallet address** (viem `verifyMessage`, Foundry acct #0 vector) + deterministic; [messages.e2e.spec.ts](packages/api/src/transactions/messages.e2e.spec.ts): 201/404/400/401. 32 green.
**Demo / verify** — `curl -XPOST localhost:3000/wallets/$ID/messages -H "authorization: Bearer $TOKEN" -d '{"message":"gm"}'` → `{signature:"0x…"}`.
**Gotchas** — known-vector test proves real EIP-191 (recovery), not just byte-determinism. The string copy of the key isn't zeroizable; best-effort zeroizes the Buffer.

---

## v0.3.0 · Block 3 · T-013 Balance-refresh poller    ([#14](https://github.com/xbt-a4224j/vencura/issues/14) · [commit](https://github.com/xbt-a4224j/vencura/commit/aa056e3))
**What & why** — Keep the balance cache warm proactively, not just on read. A light `@nestjs/schedule` interval — no queue infra (Block 4's ConfirmationWatcher is also a Postgres poller; Redis dropped).
**How it works** — `BalanceRefresher.refreshAll()` (`@Interval(30s)`) lists all wallets and calls `BalancesService.refresh(id, address)` for each, swallowing per-wallet failures so one bad RPC read doesn't stop the sweep. `ScheduleModule.forRoot()` registers it.
**Files touched** — [balance-refresher.service.ts](packages/api/src/balances/balance-refresher.service.ts) · [balances.module.ts](packages/api/src/balances/balances.module.ts) · [app.module.ts](packages/api/src/app.module.ts).
**Tests** — [balance-refresher.service.spec.ts](packages/api/src/balances/balance-refresher.service.spec.ts): refreshes each wallet; keeps going when one fails. 34 green.
**Demo / verify** — boot the API; the cache rows' `asOfBlock`/`updatedAt` advance every ~30s without any request.
**Gotchas** — poll-all-wallets is O(wallets) per tick — fine for a demo; the scale path (per-wallet queued jobs) is noted for the writeup, not built (§3.1 no over-engineering).

---

## v0.3.0 · Block 3 · T-014 Wallet dashboard — balances + sign    ([#15](https://github.com/xbt-a4224j/vencura/issues/15) · [commit](https://github.com/xbt-a4224j/vencura/commit/9b4231a))
**What & why** — The load-bearing UI for Block 3 (§8): each wallet can show balances and sign a message in the browser. Also consolidates RPC config to a single `RPC_URL`.
**How it works** — a `WalletItem` component owns its own balances/sign state; `api.ts` gains `getBalance`/`signMessage`. `.env`/`.env.example` drop `ANVIL_RPC_URL` for one `RPC_URL` (anvil locally, overlay-overridden on deploy) — config via env, not code branching.
**Files touched** — [App.tsx](packages/web/src/App.tsx) (`WalletItem`) · [api.ts](packages/web/src/api.ts) · [.env.example](.env.example).
**Tests** — scaffold/UI ticket (§13): green lint/typecheck/build + a live flow.
**Demo / verify** — live against anvil: balance → `{ETH confirmed/available "0", asOfBlock 0}`; sign `"gm vencura"` → signature that `verifyMessage` **recovers to the wallet's own address (true)**; 404 on an unowned wallet. UI: `pnpm dev` → http://localhost:5173.
**Gotchas** — token in localStorage (XSS tradeoff, revisit T-036). Fresh anvil wallet is 0 ETH until funded.

---

### Block 3 recap — Read & sign → **v0.3.0** ✅

**Shipped:** the first chain-talking layer — `ChainModule` (viem `publicClient` behind a mockable `PUBLIC_CLIENT` token), `GET /wallets/:id/balance` (native + tracked ERC-20s) served **stale-while-revalidate** from a Postgres cache, a `@nestjs/schedule` poller keeping it warm, and `POST /wallets/:id/messages` producing **real EIP-191 signatures** (decrypt→sign→zeroize). Ownership centralized in `WalletsService.findOwnedOrThrow` (404, no enumeration). 34 API tests green; issues #12–#15 closed.

**How to demo:** `pnpm --filter @vencura/api dev` + `pnpm --filter @vencura/web dev` → register → create wallet → **View balances** (reads anvil) → **Sign** a message → signature recovers to the wallet address.

**Notable calls:** single `RPC_URL` (no fallback branch); `available == confirmed` until sends (Block 4); SWR keeps the request path off the RPC; no queue (poller is enough; Block 4 stays Postgres-only). Recurring e2e env-var setup (`JWT_SECRET`/`RPC_URL`/`MASTER_ENCRYPTION_KEY`) is a candidate for a Vitest setup file.

---

## v0.4.0 · Block 4 · T-015 Policy engine (pre-sign)    ([#16](https://github.com/xbt-a4224j/vencura/issues/16) · [commit](https://github.com/xbt-a4224j/vencura/commit/d08fe03))
**What & why** — Enforce per-wallet rules *before* signing: allowlist + amount limits. First gate in the send path; the §4 policy seam.
**How it works** — new `wallet_policies` table (1:1 with wallet). `PolicyEngine.assertAllowed` — missing row = unrestricted; a non-empty allowlist gates the recipient for **all** assets; per-tx + daily limits gate **native ETH** amounts (daily = today's native sends + this one). Violations → `ForbiddenException(reason)`. `GET`/`PUT /wallets/:id/policy` (owner-scoped) to view/edit.
**Files touched** — [policy.engine.ts](packages/api/src/policy/policy.engine.ts) · [policy.controller.ts](packages/api/src/policy/policy.controller.ts) · [policy.module.ts](packages/api/src/policy/policy.module.ts) · [policy.schema.ts](packages/shared/src/policy.schema.ts) · schema/migration `wallet_policies`.
**Tests** — [policy.engine.spec.ts](packages/api/src/policy/policy.engine.spec.ts): no-policy allows, allowlist deny, per-tx deny, daily deny, within-limits allow. 39 green.
**Demo / verify** — `PUT /wallets/:id/policy {allowlist,perTxLimit,dailyLimit}` then a violating send → 403.
**Gotchas** — Prisma numeric `_sum` can't aggregate the String `amount` column (typecheck error) → daily total uses `findMany` + BigInt reduce. Approval *workflow* deferred (deny-only this block); token amount-limits are a future extension.

---

## v0.4.0 · Block 4 · T-016 Per-wallet Postgres advisory lock seam    ([#17](https://github.com/xbt-a4224j/vencura/issues/17) · [commit](https://github.com/xbt-a4224j/vencura/commit/2f7d120))
**What & why** — The concurrency primitive: serialize the per-wallet send critical section without Redis. A `Lock` seam (Redis impl = documented scale-path).
**How it works** — `PgAdvisoryLock.withWalletLock(walletId, fn)` runs `fn` inside a Prisma interactive transaction that first takes `pg_advisory_xact_lock(advisoryKey(walletId))`. Transaction-scoped → auto-releases on commit/rollback (a crashed request can't strand it); `{ timeout: 30_000 }` so the lock can be held across the later broadcast. `advisoryKey` = sha256(walletId) → positive 60-bit bigint (fits signed 64-bit).
**Files touched** — [lock.ts](packages/api/src/infra/lock/lock.ts) (LOCK token + interface) · [pg-advisory-lock.ts](packages/api/src/infra/lock/pg-advisory-lock.ts) · [advisory-key.ts](packages/api/src/infra/lock/advisory-key.ts) · [lock.module.ts](packages/api/src/infra/lock/lock.module.ts) (@Global).
**Key code** — `SELECT pg_advisory_xact_lock(${key})` (parameter-bound bigint).
**Tests** — [advisory-key.spec.ts](packages/api/src/infra/lock/advisory-key.spec.ts): deterministic, positive, < 2^63, per-wallet distinct. 41 green. (Idempotency + the N-concurrent-sends test land in T-017.)
**Gotchas** — the lock holds a DB connection across the broadcast (the xact-lock tradeoff) — fine for the demo; session-lock/Redis is the scale path. Real PG serialization is covered by T-017's optional integration test (skipped without a DB; CI stays mock-based).

---

## v0.4.0 · Block 4 · T-017 sendTransaction (native + ERC-20)    ([#18](https://github.com/xbt-a4224j/vencura/issues/18) · [commit](https://github.com/xbt-a4224j/vencura/commit/b2fa606))
**What & why** — The centerpiece: broadcast native ETH + ERC-20 transfers correctly under concurrency — nonce serialization + idempotency. Wires lock + policy + signer + chain write path.
**How it works** — `TransactionsService.send`: ownership check → pre-sign `PolicyEngine.assertAllowed` → inside `withWalletLock`: **idempotency-key short-circuit** (the check lives *inside* the lock, serialized with the create, so two concurrent same-key requests can't both broadcast — the second returns the first's row), then `nonce = max(chain pending, wallet.nextNonce)`, build (native value-tx, or `encodeFunctionData(transfer)` to the token), `prepareTransaction` → `signer.signTransaction` → `sendRawTransaction` → persist row + `nextNonce = nonce+1`. Serialized callers thus get unique monotonic nonces. `EncryptedKeySigner.signTransaction` decrypts → `account.signTransaction(request)` → zeroizes key in `finally`. `ChainService` gains the write path (pending-nonce/prepare/send/receipt).
**Files touched** — [transactions.service.ts](packages/api/src/transactions/transactions.service.ts) · [transactions.controller.ts](packages/api/src/transactions/transactions.controller.ts) · [send.dto.ts](packages/api/src/transactions/send.dto.ts) · [transactions.module.ts](packages/api/src/transactions/transactions.module.ts) · [chain.service.ts](packages/api/src/infra/chain/chain.service.ts) · [encrypted-key.signer.ts](packages/api/src/signer/encrypted-key.signer.ts) · [signer.ts](packages/api/src/signer/signer.ts) · [send.schema.ts](packages/shared/src/send.schema.ts).
**Tests** — [transactions.service.spec.ts](packages/api/src/transactions/transactions.service.spec.ts): 5 concurrent sends → nonces `[0,1,2,3,4]`; sequential **and concurrent** same idempotency key → one broadcast. Plus chain write methods, signTransaction determinism, send e2e (201/403/401). Optional [pg-advisory-lock.int.spec.ts](packages/api/src/infra/lock/pg-advisory-lock.int.spec.ts) (skipped without `RUN_DB_TESTS`). 51 green (1 skipped).
**Demo / verify** — `POST /wallets/:id/transactions {to,asset,amount}` (+ optional `Idempotency-Key`) → `{txHash,status:'pending',nonce}`.
**Gotchas** — viem `prepareTransactionRequest` types demand `chain` when `account` is a bare address → pass `chain: null`. Chain-error friendly mapping is T-019 (here a broadcast failure throws `BadRequestException`). **Review catch:** the idempotency read had to move *inside* the lock — outside it, concurrent same-key requests double-broadcast before the unique constraint fires.

---

## v0.4.0 · Block 4 · T-018 Confirmation watcher    ([#19](https://github.com/xbt-a4224j/vencura/issues/19) · [commit](https://github.com/xbt-a4224j/vencura/commit/837846a))
**What & why** — Move `pending` txs to `confirmed`/`failed` off the request path, and refresh balances once they land. Postgres-row-durable (no queue).
**How it works** — `ConfirmationWatcher.reconcile()` (`@Interval(5s)`) scans `status='pending'` rows with a `txHash`, fetches each receipt, and — **reorg-aware** — only finalizes once `head − receipt.blockNumber ≥ CONFIRMATIONS`; maps `receipt.status` (`success`→`confirmed`, else `failed`), then best-effort `balances.refresh`. Restart-safe: the pending rows are the work list.
**Files touched** — [confirmation-watcher.service.ts](packages/api/src/transactions/confirmation-watcher.service.ts) · [transactions.module.ts](packages/api/src/transactions/transactions.module.ts) (imports BalancesModule).
**Tests** — [confirmation-watcher.service.spec.ts](packages/api/src/transactions/confirmation-watcher.service.spec.ts): confirmed (+refresh), failed, too-few-confs (no-op), null receipt (no-op). 55 green (1 skipped).
**Demo / verify** — send a tx → it shows `pending` → within ~5s on anvil it flips `confirmed` and the balance updates.
**Gotchas** — `CONFIRMATIONS=1` for anvil instant-mine; a public network raises it. The poll is O(pending) — fine for the demo.

---

## v0.4.0 · Block 4 · T-019 Global error filter + chain-error mapping    ([#20](https://github.com/xbt-a4224j/vencura/issues/20) · [commit](https://github.com/xbt-a4224j/vencura/commit/af659ed))
**What & why** — The deferred global filter (flagged since Block 2): one consistent RFC-7807-ish JSON error shape for the whole API, plus friendly mapping of chain/viem failures.
**How it works** — `AllExceptionsFilter` (`@Catch()`, registered in `main.ts`) renders `{ type, title, status, detail }`. `HttpException`s keep their status + message (so 401/403/404 pass through); recognized chain errors go through `mapChainError` (insufficient-funds→400, nonce-too-low/replacement→409, RPC-down→503); anything else is a generic 500 with the full message logged **server-side only** — no stack traces or secrets in the client body.
**Files touched** — [all-exceptions.filter.ts](packages/api/src/common/all-exceptions.filter.ts) · [chain-error.ts](packages/api/src/common/chain-error.ts) · [main.ts](packages/api/src/main.ts).
**Tests** — [chain-error.spec.ts](packages/api/src/common/chain-error.spec.ts) (9: each mapping + null) + [all-exceptions.filter.spec.ts](packages/api/src/common/all-exceptions.filter.spec.ts) (4: shape, 403/404 pass-through, 500 hides secret). 68 green (1 skipped).
**Demo / verify** — an over-balance send surfaces `{status:400, detail:"Insufficient funds for amount + gas."}` instead of a raw viem dump.
**Gotchas** — used a local `JsonResponse` structural interface (no `express` type dep). `title` is the `HttpStatus` enum name (e.g. `NOT_FOUND`) — fine for the -ish shape. e2e specs build their own app (pipe only), so filter pass-through is unit-tested directly.

---

## v0.4.0 · Block 4 · T-020 Send + tx-status UI, Admin tab, demo seed    ([#21](https://github.com/xbt-a4224j/vencura/issues/21) · [commit](https://github.com/xbt-a4224j/vencura/commit/d890694) · [fixes](https://github.com/xbt-a4224j/vencura/commit/09a0aae))
**What & why** — Make the whole send path demoable: a friendly UI, pre-seeded funded wallets, and the completed `available` math. UX is first-class for the live demo.
**How it works** — `available = confirmed − pending(outgoing, same asset) − GAS_RESERVE_WEI(0.001 ETH, native only)`, clamped ≥ 0 (optimistic debit). Demo seed (`seedDemo`, shared by `pnpm db:seed` + dev-gated `POST /admin/seed`) creates a user + 3 wallets, a sample policy on the first (allowlist + 5/8 ETH limits), and funds them on anvil via `anvil_setBalance`. Web: a tabbed shell (**Wallets** / **Admin**) with a `SendForm` (asset + recipient dropdowns, ETH→wei via `parseEther`), a polling `TxList`, and an Admin `PolicyEditor` + seed button.
**Files touched** — [balances.service.ts](packages/api/src/balances/balances.service.ts) (available math) · [admin/seed.ts](packages/api/src/admin/seed.ts) · [admin.controller.ts](packages/api/src/admin/admin.controller.ts) · [App.tsx](packages/web/src/App.tsx) · [api.ts](packages/web/src/api.ts).
**Tests** — balances available-math (reserve, pending debit, clamp). 70 green (1 skipped). Plus a **live capstone** against anvil (below).
**Demo / verify** — `pnpm db:seed` → log in `demo@vencura.local`/`demo-password`; send 2 ETH between seeded wallets → `pending`→`confirmed`; non-allowlisted/over-limit sends → 403 with the RFC-7807 detail; same `Idempotency-Key` → one tx.
**Gotchas (two bugs the live capstone caught — fix `09a0aae`)** — (1) `PgAdvisoryLock` used `$queryRaw` for `pg_advisory_xact_lock`, which returns **void** → "Failed to deserialize column of type 'void'"; switched to `$executeRaw`. (2) confirmation **off-by-one**: a tx in the head block has 1 confirmation (`head−block+1`), but anvil on-demand-mines so `head==block` and it never confirmed; fixed + made `CONFIRMATIONS` env-configurable. Both were invisible to the mock-based unit suite — only the real-DB + real-anvil run exposed them.

---

### Block 4 recap — sendTransaction + concurrency → **v0.4.0** ✅

**Shipped:** the send path — `POST /wallets/:id/transactions` (native + ERC-20) serialized per wallet by a **Postgres advisory lock** (`pg_advisory_xact_lock` behind a `Lock` seam, no Redis), idempotent via the `@unique` key (check **inside** the lock), gated by a per-wallet **PolicyEngine** (allowlist + limits, deny pre-sign), with a **confirmation watcher** (`@nestjs/schedule`, reorg-aware) flipping `pending→confirmed/failed`, all errors rendered through a **global RFC-7807 filter** with chain-error mapping. `available = confirmed − pending − gas reserve`. A demo-grade UI (send dropdowns, tabbed Wallets/Admin, pre-seeded funded wallets) makes it all live-demoable. 70 API tests + a real-DB lock integration test (gated) + a live anvil capstone. Issues #15–#21 closed.

**How to demo:** `pnpm --filter @vencura/api db:seed` → `pnpm dev` → log in as `demo@vencura.local` / `demo-password` → Wallets tab: pick the policy wallet, send 2 ETH to an allowlisted wallet (watch it go pending→confirmed, `available` drop then settle); try a non-allowlisted recipient or >5 ETH → denied with a clear message. Admin tab: edit policy, re-seed.

**Notable calls:** built subagent-driven (one implementer per ticket, controller verify + review + commit); the idempotency-inside-lock, `$executeRaw`, and confirmation-off-by-one fixes were all caught in controller review / the live capstone — the mock suite alone was green throughout. `CONFIRMATIONS` is now env-tunable (1 for anvil, higher for a public net).

---

## v0.6.0 · Block 6 · T-027 Deploy prep — Vercel build, api Dockerfile, /admin hardening    ([#28](https://github.com/xbt-a4224j/vencura/issues/28) · [vercel](https://github.com/xbt-a4224j/vencura/commit/80b2be4) · [docker](https://github.com/xbt-a4224j/vencura/commit/d68d7c3) · [admin](https://github.com/xbt-a4224j/vencura/commit/8d2cb19))
**What & why** — Stand up the deploy surface without secrets churn. Web was deploying but Vercel expected `public/`; the api had no image; `/admin/*` was `NODE_ENV`-gated but unauthenticated.
**How it works** — Root [vercel.json](vercel.json) pins `framework=vite`, builds `@vencura/web`, outputs `packages/web/dist` (+ SPA rewrite). [packages/api/Dockerfile](packages/api/Dockerfile) is multi-stage (pnpm workspace, shared→api), running `prisma migrate deploy` at boot from `$DATABASE_URL`. [admin.guard.ts](packages/api/src/admin/admin.guard.ts) does a **timing-safe** `x-admin-key === ADMIN_API_KEY` check, **fails closed**, applied controller-wide — so the deployed demo can still seed/reset, but only with the key (web stores it in localStorage, never the bundle).
**Files touched** — [vercel.json](vercel.json) · [.dockerignore](.dockerignore) · [packages/api/Dockerfile](packages/api/Dockerfile) · [admin.guard.ts](packages/api/src/admin/admin.guard.ts) → guard · [admin.controller.ts](packages/api/src/admin/admin.controller.ts) → `@UseGuards` · [api.ts](packages/web/src/api.ts) + [App.tsx](packages/web/src/App.tsx) → key input/header.
**Tests** — [admin.guard.spec.ts](packages/api/src/admin/admin.guard.spec.ts) (4: allow/missing/wrong/unset-env, red→green). 75 green (1 skipped).
**Demo / verify** — `docker build -f packages/api/Dockerfile -t vencura-api .` boots → P1001 at fake DB (chain loads). `vercel deploy` → preview URL, no more `public/` error. Seed without the key → 403.
**Gotchas** — Vercel link sat at repo root (no Root Directory), hence the `public/` miss. Vercel CLI auth never persists in the agent shell → deploys/Railway run by the human or via token. Image is 1.32GB (carries devDeps; slim path = `pnpm deploy --prod`). **Deferred:** Railway api deploy + `/api`→Railway rewrite + prod secrets push (awaiting auth).

---

## Block 4 · CC-1 Policy daily-limit TOCTOU — move the check inside the wallet lock    (audit fold-in)
**What & why** — Audit HIGH: `assertAllowed` ran *before* `withWalletLock`, so two concurrent same-wallet 0.6 ETH sends vs a 1.0 ETH `dailyLimit` each read today=0 and both broadcast — cap blown.
**How it works** — Moved `assertAllowed` *inside* the lock callback (alongside the existing in-lock idempotency check). The Postgres advisory lock serializes the whole critical section, so the second caller blocks until the first commits its row, then re-reads the daily sum and sees it → denied.
**Files touched** — [transactions.service.ts](packages/api/src/transactions/transactions.service.ts) → policy check now in-lock.
**Tests** — new real-DB race spec [policy-race.int.spec.ts](packages/api/src/transactions/policy-race.int.spec.ts) (gated `RUN_DB_TESTS`): two concurrent 0.6 ETH sends → exactly one succeeds, one denied. **Red** on old code (both broadcast), **green** after.
**Demo / verify** — `RUN_DB_TESTS=1 dotenv -e ../../.env -- vitest run src/transactions/policy-race.int.spec.ts` → 1 passed; logs show `policy deny: amount exceeds daily limit` on the second send.
**Gotchas** — the fix works *because* the advisory lock wraps the enclosing `$transaction`; under READ COMMITTED the second txn wouldn't see the first's uncommitted row, but it blocks on the lock until commit, so the re-read sees it.

---

## Block 4 · VC4-04 Daily-limit sum counted failed txs    (audit fold-in)
**What & why** — Audit MED: the daily-spend `findMany` had no status filter, so `failed` (reverted) sends counted toward the cap and wrongly throttled a wallet. Over-counting only ever *denies* more (safe-but-wrong).
**How it works** — Added `status: { not: 'failed' }` to the daily-sum `where`. A reverted send moved no value, so it's excluded from the running total.
**Files touched** — [policy.engine.ts](packages/api/src/policy/policy.engine.ts) → one-line `where` filter.
**Tests** — extended [policy.engine.spec.ts](packages/api/src/policy/policy.engine.spec.ts): asserts the query carries `status:{not:'failed'}` so failed rows never reach the sum. **Red** (no filter) → **green**.
**Demo / verify** — `vitest run src/policy/policy.engine.spec.ts` → 6 passed.
**Gotchas** — `findMany`+BigInt-reduce stays (the `amount` String column can't use Prisma numeric `_sum`); only the `where` changed.

---

## Block 4 · CC-3 Idempotency P2002 backstop surfaced as a 500    (audit fold-in)
**What & why** — Audit MED: `transaction.create()` had no try/catch, so a unique-key (`P2002`) conflict — the documented "insert-or-conflict" backstop — fell through to a generic 500 instead of an idempotent replay.
**How it works** — Wrap the create; a `Prisma.PrismaClientKnownRequestError` with `code==='P2002'` re-reads the winning row by `idempotencyKey` and returns it shaped (`onUniqueConflict`). Non-P2002 errors and keyless conflicts re-throw unchanged. The early return skips the nonce bump (the winner already did it).
**Files touched** — [transactions.service.ts](packages/api/src/transactions/transactions.service.ts) → P2002 catch + `onUniqueConflict` helper.
**Tests** — [idempotency-backstop.spec.ts](packages/api/src/transactions/idempotency-backstop.spec.ts): `create()` throws P2002 → service returns the existing row, not a throw. **Red** (P2002 propagated) → **green**.
**Demo / verify** — `vitest run src/transactions/idempotency-backstop.spec.ts` → 1 passed.
**Gotchas** — the P2002 path is narrow (the in-lock `findUnique` catches same-wallet same-key retries); it only fires on a cross-wallet same-key race. Makes the `@unique`-is-the-backstop comment actually true.

---

## Block 4 · CC-6 Run the gated DB integration tests in CI    (audit fold-in)
**What & why** — Audit HIGH: the headline concurrency guarantee was only verified by `RUN_DB_TESTS`-gated specs that never ran in CI (no Postgres service), so a regression in the real advisory lock would stay green. Mode = config (smoke).
**How it works** — New `db-tests` job in [ci.yml](.github/workflows/ci.yml) spins a `postgres:16-alpine` service, sets `DATABASE_URL` + `RUN_DB_TESTS=1`, runs `prisma migrate deploy`, then the two gated specs (pg-advisory-lock + the new CC-1 policy race) with `--no-file-parallelism`. The existing mock-based `verify` job is untouched.
**Files touched** — [.github/workflows/ci.yml](.github/workflows/ci.yml) → added `db-tests` job.
**Tests** — n/a (config). Smoke: YAML parses (js-yaml); both gated specs pass locally with `RUN_DB_TESTS=1` against Postgres on 5433.
**Demo / verify** — `RUN_DB_TESTS=1 DATABASE_URL=… pnpm --filter @vencura/api exec vitest run --no-file-parallelism src/infra/lock/pg-advisory-lock.int.spec.ts src/transactions/policy-race.int.spec.ts` → 2 passed.
**Gotchas** — `--no-file-parallelism` is load-bearing: the lock's ordering assertion is timing-sensitive, so the two DB specs can't contend on the shared connection.

---

## Block 4 · VC4-06 Document CONFIRMATIONS (+ Sepolia RPC guidance) in .env.example    (audit fold-in)
**What & why** — Audit (low): `CONFIRMATIONS` (read by the watcher) was absent from [.env.example](.env.example), so operators got the anvil-shaped default (1) with no reorg-safety guidance. Mode = config.
**How it works** — Added `CONFIRMATIONS=1` (correct for anvil's on-demand mining) plus a commented Sepolia block: an example Infura URL (no key) and `CONFIRMATIONS=3` (3–12 for reorg safety), with a note to set it in the deploy env, not here.
**Files touched** — [.env.example](.env.example) → doc only (no code change).
**Tests** — n/a (config). Verified read-only that [chain.module.ts](packages/api/src/infra/chain/chain.module.ts#L13) reads `RPC_URL` and [confirmation-watcher.service.ts](packages/api/src/transactions/confirmation-watcher.service.ts#L10) reads `CONFIRMATIONS` — neither touched.
**Demo / verify** — `node dist/main.js` against local anvil → "Nest application successfully started", zero Sepolia/Infura calls.
**Gotchas** — `.env.example` is the local-anvil default, so the Sepolia values stay commented; deploy supplies its own `.env`.

---

## Block 8 · T-038 README: run/demo + Mermaid diagrams    ([#39](https://github.com/xbt-a4224j/vencura/issues/39))
**What & why** — Complete the README so a reviewer can clone, run, and understand the system without reading CLAUDE.md (final-block req, §15).
**How it works** — Added an env-var table, a reset/demo-cycle section, a one-line security-writeup stub (T-036 stays human-gated), and three Mermaid diagrams: system architecture (modules + infra + chain-as-source-of-truth), the `sendTransaction` sequence (policy → `pg_advisory_xact_lock` critical section → live nonce → sign → broadcast → persist → ConfirmationWatcher), and the AES-256-GCM key-custody flow.
**Files touched** — [README.md](README.md) → run/demo, env vars, security stub, 3 Mermaid diagrams.
**Tests** — docs ticket; smoke = valid Markdown + syntactically-correct `mermaid` blocks.
**Demo / verify** — open [README.md](README.md) in the VS Code Markdown preview; all three diagrams render.
**Gotchas** — `CONFIRMATIONS` is documented in [.env.example](.env.example) (added by VC4-06) with its code default `?? 1`; diagrams are grounded in the real §6.1 module map, not idealized.

---

## v0.6.0 · Block 6 · T-027 Live deploy — Railway API + Vercel /api proxy    ([#28](https://github.com/xbt-a4224j/vencura/issues/28) · [railway.json](https://github.com/xbt-a4224j/vencura/commit/ee7bd6e) · [proxy](https://github.com/xbt-a4224j/vencura/commit/d6aef38))
**What & why** — Get the api actually running in prod. GitHub-connected Railway service builds [packages/api/Dockerfile](packages/api/Dockerfile) via [railway.json](railway.json); web reaches it through a Vercel rewrite.
**How it works** — Railway builds on push to `main` (DOCKERFILE builder), boots `prisma migrate deploy` then `node main.js`. Env (DATABASE_URL=Neon **direct** host, RPC_URL=Sepolia, the 3 secrets) pushed via the Railway **GraphQL API** (`variableCollectionUpsert`) using a team token — the CLI rejects team tokens. Public domain points at port **8080** (Railway injects `PORT`). [vercel.json](vercel.json) rewrites `/api/:path*` → the Railway URL so the SPA's same-origin calls work in prod.
**Files touched** — [railway.json](railway.json) → DOCKERFILE build · [vercel.json](vercel.json) → /api proxy.
**Demo / verify** — `GET https://vencura-api-production-3c23.up.railway.app/health` → 200; `/docs` → Swagger. Logs show "Connected to Postgres" + all routes mapped.
**Gotchas** — Railway builds `origin/main`, so **unpushed local commits = stale build** (it fell back to Railpack until the push). Neon **pooled** host + `channel_binding` breaks `migrate deploy` → use the **direct** host, `sslmode=require` only. Domain `targetPort` must match the app's actual listen port (8080), not 3000. **Remaining:** disable Vercel Deployment Protection + `vercel --prod` + README URLs.

---

## Block 5 · Landing page + User/Admin split, shared-password account picker    (UX)
**What & why** — Replace the login gate with a Venmo-style two-experience app: a root landing with **User** / **Admin** tiles. No typed login — the deployment is gated by Vercel Auth; every account uses a shared demo password (`DEMO_PASSWORD`) so sign-in is one click.
**How it works** — Backend reverted to real `register`/`login` (dropped the passwordless `/auth/sessions` mint + random-hash accounts); only `GET /auth/accounts` (list) is added. Admin "create account" = `register(email, DEMO_PASSWORD)` → appears in the User picker; User sign-in = `login(email, DEMO_PASSWORD)`. AdminView signs in as the demo account so wallet/policy panels resolve.
**Files touched** — [auth.controller.ts](packages/api/src/auth/auth.controller.ts) · [auth.service.ts](packages/api/src/auth/auth.service.ts) · [auth.schema.ts](packages/shared/src/auth.schema.ts) · [seed.ts](packages/api/src/admin/seed.ts); [App.tsx](packages/web/src/App.tsx) (Landing/UserView/AdminView/Root) · [auth-context.tsx](packages/web/src/auth-context.tsx) · [api.ts](packages/web/src/api.ts) · [index.css](packages/web/src/index.css).
**Tests** — [auth.service.spec.ts](packages/api/test/auth/auth.service.spec.ts) `listAccounts`; full suite green (api 87 / web 2 / shared 3).
**Gotchas** — shared demo password is a known credential (demo only; Vercel is the real boundary), duplicated in web `api.ts` to avoid a workspace build dep.

---

## v0.6.0 · Block 6 · Rate limiting (abuse control for a shared app)    ([commit](https://github.com/xbt-a4224j/vencura/commit/ee51023))
**What & why** — The app is meant to be shared (open registration), so add per-IP abuse control without locking anyone out. Security model stays: per-user JWT isolation + AES-GCM custody + Sepolia; this just caps request volume.
**How it works** — `@nestjs/throttler` global guard (`APP_GUARD`) at 100 req/60s; `/auth/*` tightened to 10/60s via `@Throttle` to slow credential-stuffing. In-memory (no Redis — matches the lock's Postgres-only stance; Redis storage is the documented multi-node path). `trust proxy=1` in [main.ts](packages/api/src/main.ts) so the limiter keys on the real client IP from X-Forwarded-For, not Railway/Vercel's edge.
**Files touched** — [app.module.ts](packages/api/src/app.module.ts) → module + guard · [auth.controller.ts](packages/api/src/auth/auth.controller.ts) → tighter @Throttle · [main.ts](packages/api/src/main.ts) → trust proxy.
**Tests** — config/wiring → smoke-check (§13): 77 green, typecheck + build clean; existing e2e flows stay under the limit (no false 429s).
**Gotchas** — without `trust proxy`, all users share one bucket behind the proxy and throttle each other. Global guard is now live in any test that builds the full AppModule — bursty auth tests would 429.

---

## v0.6.0 · Block 6 · Rate-limit IP keying behind Railway + Vercel    ([fix](https://github.com/xbt-a4224j/vencura/commit/907dcd7))
**What & why** — The throttler shipped active but limited nothing: `x-ratelimit-remaining` reset to 9 every request. Behind the proxies, `trust proxy`-derived `req.ip` rotates per request → a fresh bucket each time.
**How it works** — A `ProxyThrottlerGuard` overrides `getTracker` to use a real client IP via [client-ip.ts](packages/api/src/common/client-ip.ts): prefer **`x-vercel-forwarded-for`** (Vercel overwrites `x-forwarded-for`/`x-real-ip` with its rotating edge IP and stashes the true client here), else leftmost `x-forwarded-for` (direct Railway), else `req.ip`. Found the right header by **logging the actual headers in prod** rather than guessing.
**Files touched** — [client-ip.ts](packages/api/src/common/client-ip.ts) + [client-ip.spec.ts](packages/api/src/common/client-ip.spec.ts) (5 tests, TDD) · [proxy-throttler.guard.ts](packages/api/src/common/proxy-throttler.guard.ts).
**Demo / verify** — 12 rapid logins via `vencura-alpha.vercel.app/api/auth/login` → `401×10` then **`429`**; direct Railway URL same. 82 green.
**Gotchas** — these headers are client-spoofable (set at a trusted edge) — fine for abuse control, not a security boundary. `x-forwarded-for` leftmost is NOT the client through a Vercel rewrite.

---

## v0.5.0 · Block 5 · T-021 DB reset / re-seed    ([#22](https://github.com/xbt-a4224j/vencura/issues/22) · [commit](https://github.com/xbt-a4224j/vencura/commit/290c500))
**What & why** — Make the whole app resettable from the browser for a clean demo: one button wipes everything and rebuilds the deterministic demo data (a user, three wallets, a sample policy on an obvious wallet). Demoability is a stated design driver (§3), but reset is *destructive* in a way `seed` isn't, so it needed a stricter gate — see below.

**How it works (mechanism, in detail).** The new `POST /admin/reset` lives on `AdminController`, so it inherits the `AdminGuard` (`x-admin-key === ADMIN_API_KEY`, timing-safe, fail-closed) we built earlier. On top of that it adds a *second, independent* gate: if `process.env.NODE_ENV === 'production'` it throws `ForbiddenException` immediately — **before touching the database**. The wipe itself is a single `prisma.user.deleteMany({})`. That one call is enough because the Prisma schema declares `onDelete: Cascade` down the whole ownership chain: deleting a `User` cascades to its `Wallet`s, and each `Wallet` cascades to its `Transaction`s, `WalletBalance`s, and `WalletPolicy`. So one delete tears down the entire graph in FK-safe order without us hand-ordering deletes. Then `seedDemo(prisma)` (the same routine `POST /admin/seed` and `pnpm db:seed` use) rebuilds the demo state, and we return its `SeedResult` (demo email + password + wallet list).

**Why two gates, not one.** This is the subtle part and it's a direct consequence of a product decision made this session: we left the deployment **public and openly-registerable**. `seed` is additive (it upserts the demo user, drops only *that* user's wallets) so key-gating is sufficient. `reset` deletes **every** user's data. On a shared public deploy, "the admin key is the only thing standing between a stranger and wiping all users' wallets" is too thin — keys leak, get committed, get shoulder-surfed. So reset is dev/demo-only: the `NODE_ENV` check makes it structurally impossible on the production deployment regardless of who holds the key. Key-gate = "who can run admin ops"; env-gate = "this op is too dangerous to exist in prod at all." Defense in depth.

**Web surface.** §8 says no capability ships without a UI control. Added `api.resetDemo()` and a "Start over (reset all)" button in the Admin tab. It `window.confirm`s first (destructive-action friction), calls reset, then calls `logout()` from the auth context — necessary because the logged-in operator's *own* user row is among those just deleted, so their JWT now points at a non-existent user; logging out drops them on the login screen to sign back in as the freshly-seeded `demo@vencura.local`.

**Files touched** — [admin.controller.ts](packages/api/src/admin/admin.controller.ts) → the `reset` handler + the namespace import of `seed` (so the spy intercepts) · [admin.controller.spec.ts](packages/api/src/admin/admin.controller.spec.ts) → the two behavioral tests · [api.ts](packages/web/src/api.ts) → `resetDemo()` · [App.tsx](packages/web/src/App.tsx) → confirm + button + logout.

**Tests (red→green).** Test-first. Two unit tests on the controller method with a mocked `PrismaService` and a `vi.spyOn(seed, 'seedDemo')`: (1) with `NODE_ENV=production`, `reset()` rejects with `ForbiddenException` **and** neither `user.deleteMany` nor `seedDemo` is called — proving the refusal short-circuits before any DB work; (2) outside production it calls `user.deleteMany({})` then `seedDemo(prisma)` and returns the seed result. Mocking the seed routine (which is heavy — argon2 + viem) keeps this a fast unit test of *control flow*, not of seeding (covered elsewhere). 6 admin tests green, full suite 9/9 turbo tasks.

**Demo / verify** — Admin tab → "Start over" → confirm → DB wiped, demo reseeded, logged out → log in as `demo@vencura.local` / `demo-password`. On the live Railway deploy (`NODE_ENV=production`) the same call returns 403 by design.

**Gotchas** — (1) The `import * as seed` (vs named `import { seedDemo }`) is deliberate: it guarantees `vi.spyOn(seed, 'seedDemo')` intercepts the call regardless of transpilation. (2) The env-gate must run *before* the delete — ordering matters; a refusal that fires after `deleteMany` would be catastrophic. (3) `deleteMany({})` with an empty filter means "all rows" — intentional here, but the kind of call that should never appear outside a gated reset.

---

## v0.5.0 · Block 5 · T-022 Blockchain inspector    ([#23](https://github.com/xbt-a4224j/vencura/issues/23) · [commit](https://github.com/xbt-a4224j/vencura/commit/2671721))
**What & why** — Make on-chain state reachable from the admin in one click. A custodial platform's demo is far more convincing when every address and tx hash links straight to Etherscan and you can fund a wallet from a faucet without leaving the UI. This is the surface where the Sepolia path becomes *visible* — proof the app is talking to a real chain, not a mock.

**How it works (mechanism).** A tiny pure module, `explorer.ts`, owns all the deep-link knowledge: `explorerAddress(addr)` and `explorerTx(hash)` return `https://sepolia.etherscan.io/address/<addr>` and `.../tx/<hash>`, and `FAUCET_URL` points at a public Sepolia faucet. Keeping these in one helper (rather than scattering string templates through JSX) means the chain/explorer is named in exactly one place — if we ever switch networks or explorers, it's a one-line change, and the helper is trivially unit-testable. The UI then consumes it in three spots: (1) `TxList` wraps each tx's `toAddress` and `txHash` in `<a>` tags to Etherscan; (2) the admin "Wallet addresses" list links each address; (3) a new "Chain inspector" section adds a faucet link, a free-form **tx-hash lookup** (type a hash → "Open ↗" deep-links to it on Etherscan), and a **force balance refresh** button.

**The force-refresh detail.** Rather than add a new endpoint, the refresh button reuses the existing `onChange` callback the admin tab already receives — the same one the app uses after any mutation. It re-fetches the wallet list, which re-mounts the `WalletItem`s, each of which re-reads its balance; because `GET /balance` is stale-while-revalidate, that read also kicks off a background chain re-read. So "force refresh" is really "re-trigger the read path," which is exactly what the user wants and required zero backend work — reuse over reinvention (§3.1).

**Files touched** — [explorer.ts](packages/web/src/explorer.ts) → the URL/faucet helper · [explorer.spec.ts](packages/web/src/explorer.spec.ts) → its tests · [App.tsx](packages/web/src/App.tsx) → links in `TxList`, the inspector section, and address links in the admin tab.

**Tests (red→green).** Test-first on the pure helper: two unit tests asserting `explorerAddress`/`explorerTx` produce the exact Sepolia URLs. The rest of the ticket is presentational (anchor tags, an input) and was smoke-verified via the build + manual UI; per §13 we don't build a harness to "test" that an `<a href>` renders. 4/4 web turbo tasks green.

**Demo / verify** — Admin tab → click any wallet address or tx hash → opens it on sepolia.etherscan.io; paste a hash in the lookup → "Open ↗"; "Sepolia faucet ↗" opens the faucet; "Force balance refresh" re-reads balances.

**Gotchas** — (1) All external links use `target="_blank" rel="noreferrer"` — `rel` matters for security (stops the opened page from reaching back via `window.opener`). (2) The lookup "Open" link sets `href={txLookup ? explorerTx(txLookup) : undefined}` + `aria-disabled` when empty, so it's inert (no `/tx/` with an empty hash) until you type something. (3) The faucet URL is a known weak spot — public faucets move/rate-limit; it's centralized in `explorer.ts` precisely so it's a one-line fix when it rots.

---

## v0.5.0 · Block 5 · T-023 reframed → on/off-chain activity history (+ simplification sweep)    ([#24](https://github.com/xbt-a4224j/vencura/issues/24) · [simplify](https://github.com/xbt-a4224j/vencura/commit/3f39157) · [activity](https://github.com/xbt-a4224j/vencura/commit/56bc9e1))
**What & why.** A deliberate course-correction against scope-inflation (§3.1). Three things that had crept beyond `REQUIREMENTS.md` were cut or replaced, and the audit feature was rebuilt as the thing the brief actually asks for: *"transaction history (on/off-chain)."* The throughline: I'd been building "what a custody platform *should* have" (rate limiting, a tamper-evident hash-chained audit ledger, dual-gated reset) instead of "what's required." Mapping tightly to the requirement *is* the professionalism; the elaborations belong in the security writeup as designed-not-built.

**1. Removed rate limiting.** Deleted `@nestjs/throttler`, the `ProxyThrottlerGuard`, the `client-ip` helper + its tests, the `APP_GUARD`/`ThrottlerModule` wiring, the `@Throttle` on auth, and the `trust proxy` line. This was the most complex code in the tree (recall the `x-vercel-forwarded-for` IP-discovery saga) and it guarded an endpoint that, on a testnet demo behind Vercel/Railway edges, already has baseline DDoS protection. Net: ~3 source files + 2 test files + 1 dependency gone. Rate limiting is now documented as a scale-path in the writeup rather than shipped.

**2. Simplified reset.** Dropped the `NODE_ENV==='production'` hard-refusal from `POST /admin/reset`; it's now `AdminGuard`-gated and behaves identically in every environment. The earlier "a leaked key could nuke prod" reasoning was real but overweighted for a demo whose data is entirely reseedable testnet state — the simpler single-gate model is the right call, and it removed a branch plus a test case.

**3. Replaced the audit log with an activity reader — the key design fix.** The original T-023 was a tamper-evident, hash-chained `audit_log` (sha256-linked rows, a `verifyChain` integrity check, a serialized `AuditService`). That was genuinely clever and genuinely over-engineered: the requirement is *history*, not a cryptographic ledger. The correct decomposition (Alex's) is two record types — **on-chain** sends already live in `transactions`; **off-chain** signatures were being thrown away by `messages.controller`. So now: `signMessage` persists to a new `signed_messages` table, and a single `ActivityService.recent(walletId)` does two `findMany`s and merges them newest-first through a pure `mergeActivity` helper, exposed at `GET /wallets/:id/activity`. The web shows one unified "Activity (on-chain + signatures)" feed (transactions deep-link to Etherscan; signatures show the message + truncated sig). **The history is the audit** — no separate store, no hash chain.

**How the merge works (mechanism).** `mergeActivity(txs, sigs)` maps each source row to a discriminated-union `ActivityItem` (`{kind:'transaction', …}` | `{kind:'signature', …}`), concatenates, and sorts by `createdAt` descending. Keeping it a pure function (rather than inlining the SQL/sort in the service) makes the only real logic — the interleaving and ordering — unit-testable without a DB, and keeps `ActivityService` to "authz → two reads → merge." The two reads run in `Promise.all` since they're independent.

**Schema note.** `signed_messages` cascades on wallet delete (it's wallet-owned activity, so a wiped wallet's signatures go too — unlike the discarded audit_log, which was deliberately FK-less to survive deletion; that property only mattered for the audit-ledger framing we dropped). The orphaned `audit_log` table from the discarded migration was removed from the local DB with a targeted `DROP TABLE` + a delete of its `_prisma_migrations` row, avoiding a full `migrate reset` (which Prisma now gates behind explicit human consent for AI agents).

**Files touched** — removed: `proxy-throttler.guard.ts`, `client-ip.ts(+spec)`. simplified: [app.module.ts](packages/api/src/app.module.ts), [auth.controller.ts](packages/api/src/auth/auth.controller.ts), [main.ts](packages/api/src/main.ts), [admin.controller.ts](packages/api/src/admin/admin.controller.ts)(+spec). added: [schema.prisma](packages/api/prisma/schema.prisma) `SignedMessage`, [messages.controller.ts](packages/api/src/transactions/messages.controller.ts) persistence, [activity-merge.ts](packages/api/src/transactions/activity-merge.ts)(+spec), [activity.service.ts](packages/api/src/transactions/activity.service.ts), [activity.controller.ts](packages/api/src/transactions/activity.controller.ts), web [api.ts](packages/web/src/api.ts) + [App.tsx](packages/web/src/App.tsx) `ActivityFeed`.

**Tests.** `mergeActivity` (3: interleave-newest-first, kind/field mapping, empty); messages e2e updated for the new `signedMessage.create`. 81 green / 2 skipped, 9/9 turbo tasks.

**Demo / verify** — sign a message and send a tx from a wallet → the Activity feed shows both, newest first, signature truncated, tx hash linking to Etherscan. `GET /wallets/:id/activity` returns the merged JSON.

**Gotchas** — (1) `messages.controller` gained a `PrismaService` dep, so its e2e prisma mock needed `signedMessage.create`. (2) The signature is truncated in the UI (`slice(0,20)`) — it's not secret (it's a public signature), just long. (3) This reverts parts of two already-closed tickets (#22 reset gating) — acceptable churn; the simpler design wins.

---

## v0.5.0 · Block 5 · T-024 Concurrency demo button    ([#25](https://github.com/xbt-a4224j/vencura/issues/25) · [commit](https://github.com/xbt-a4224j/vencura/commit/dea1b2e))
**What & why.** The single most convincing artifact for a custody reviewer: a button that makes the per-wallet nonce lock *visible*. The correctness was always there and unit-tested (`transactions.service.spec`: "N concurrent sends get unique, monotonic nonces"), but a reviewer shouldn't have to read a test to believe it — so we surface it live. Fire N sends at one wallet simultaneously and show that, despite racing, every send came back with a unique, consecutive nonce.

**How it works (mechanism).** `ConcurrencyDemo` builds an array of `N` `api.send(...)` promises to the *same* wallet and resolves them with `Promise.all` — i.e. they hit the API concurrently, not in sequence. Each resolves to its transaction's `nonce` (or an error). The component then computes two properties over the returned nonces: **unique** (`new Set(nonces).size === nonces.length` — no two sends grabbed the same nonce) and **monotonic/consecutive** (each sorted value is exactly the previous +1 — no gaps or duplicates). It renders the sorted nonce list plus a ✓/✗ verdict. Server-side, the existing `nonce acquired`/`nonce released` log lines (emitted inside the advisory-lock critical section in `transactions.service`) narrate the serialization in real time — open the API logs during the demo and you watch the lock hand off N times. The whole thing is UI over already-correct, already-tested behavior: no new backend code, no new tests (per §13, you don't re-test the library/behavior the service spec already covers — this is a smoke-verified presentational surface).

**Why it's honest now.** The issue (#25) stipulated this land *after* the policy-daily-limit TOCTOU fix, so the demo can't accidentally pass by letting two racing sends both slip the daily limit. That fix (`dd58cae`, daily-limit check moved inside the wallet lock) is already in, so a concurrent burst is genuinely serialized end-to-end — policy check, nonce read, sign, broadcast, persist — and the nonces it shows are real.

**Environment caveat (called out, per §9 honesty).** The demo is loudest **locally against anvil**: wallets are pre-funded via `anvil_setBalance` and mining is instant, so N sends all succeed and return consecutive nonces immediately. On the live **Sepolia** deploy, the same button works only if the wallet is faucet-funded (else every send fails the balance check and you see N errors instead of nonces) — and even funded, the nonces come back at broadcast time (status `pending`) so the demo is still snappy, but it costs real testnet ETH. The component handles the failure path: if there's no recipient it explains why, and it surfaces the first error if sends fail.

**Files touched** — [App.tsx](packages/web/src/App.tsx) → `ConcurrencyDemo` component + its placement in `WalletItem` (passed the first allowlist/other-wallet recipient).

**Tests.** None added by design — the serialization invariant is owned by `transactions.service.spec`; this is a UI driver. 4/4 web turbo tasks green (typecheck/lint/test/build).

**Demo / verify** — locally: `pnpm db:seed` → log in as the demo user → open the policy wallet → "Concurrency demo" → "Fire 5 concurrent sends" → see `nonces: 0, 1, 2, 3, 4 · ✓ unique + consecutive`, with five `nonce acquired/released` pairs in the API log.

**Gotchas** — (1) It sends 1 wei each to keep amounts trivial and stay under any policy limit. (2) On Sepolia it needs a funded wallet; that's surfaced as errors, not a crash. (3) The recipient is the first allowlisted/other-wallet address — on a wallet with neither, the demo explains it needs one rather than firing blind.

---

### Block 5 recap — Admin view & demoability → **v0.5.0** ✅

**Shipped (and live):** the app is now fully demoable + resettable from the browser. **T-021** `POST /admin/reset` (AdminGuard-gated, wipe-and-reseed) + a "Start over" button. **T-022** a chain inspector — Etherscan deep-links on every address/tx-hash, a tx-hash lookup, a faucet link, force-refresh. **T-023, reframed** — instead of a bespoke audit ledger, the requirement-true **on/off-chain activity history**: `signMessage` now persists to `signed_messages`, an `ActivityService` merges it with `transactions`, and the web shows one unified feed. **T-024** a concurrency-demo button that makes the nonce lock visible (unique + consecutive nonces under a live race).

**The Block-5 story is a simplification story.** Mid-block, three features that had drifted beyond `REQUIREMENTS.md` were deliberately cut or rebuilt: rate limiting (removed — documented as a scale-path), the tamper-evident hash-chained audit log (replaced by the activity reader — *the history is the audit*), and the dual-gated reset (collapsed to a single key gate). Net code change for the block was **subtractive** while *better* matching the brief. Everything auto-deployed to Railway/Vercel on push; the first post-deploy migration (`signed_messages`) applied cleanly to Neon, verified live. Issues #22–#25 closed.

**How to demo:** `pnpm db:seed` → `pnpm dev` → log in `demo@vencura.local`/`demo-password` → Admin tab (seed/reset/inspector/admin-key) and any wallet (send, sign, concurrency demo, unified activity feed with Etherscan links). Or hit the live app at **vencura-alpha.vercel.app**.

---

## v0.6.0 · Block 6 · T-025/T-026 Typed SDK + example scripts    ([#26](https://github.com/xbt-a4224j/vencura/issues/26) · [#27](https://github.com/xbt-a4224j/vencura/issues/27) · [commit](https://github.com/xbt-a4224j/vencura/commit/1b1abca))
**What & why.** The brief lists "example code for using the wallet" as an *evaluated* focus area, and a "client" as a core requirement (the React admin already satisfies the minimum). This ships the richer reading: a typed TS SDK plus runnable example scripts. The decision — and it's a deliberate simplicity call — was to **hand-write a small typed client** rather than generate one from the OpenAPI spec (T-025's original framing). OpenAPI codegen adds a generator dependency, a build step, and generated noise for an API with ~8 endpoints; a 130-line hand-written client is more legible, has a smaller dependency surface, and is the kind of thing a reviewer can read in one sitting. Example code is partly a test *of the API's ergonomics* — if the four core actions read cleanly in ~20 lines each, the API is well-shaped.

**How it works (the client).** `VencuraClient` (in `packages/sdk/src/index.ts`) wraps `fetch` with a private `call<T>()` that handles JSON, the bearer token, the `Idempotency-Key` header, and error mapping (it throws a `VencuraError` carrying the server's RFC-7807 `detail` + HTTP status). `register`/`login` capture the returned `accessToken` onto the instance, so subsequent calls are authenticated transparently. The base URL defaults to `process.env.VENCURA_API_URL ?? 'http://localhost:3000'`, so the same scripts run against local or the live Railway API by setting one env var. Types are hand-declared (`Wallet`, `WalletBalance`, `SentTransaction`, the `ActivityItem` discriminated union) and the shared `NATIVE_ASSET`/`Hex` are re-exported.

**How it works (the examples).** Five self-contained scripts in `packages/sdk/examples/`, each readable top-to-bottom: `01-create-wallet` (register → create → print address), `02-get-balance` (confirmed + available), `03-sign-message` (sign, then `recoverMessageAddress` locally to prove EIP-191 — the recovered signer equals the wallet address), `04-send-transaction` (logs in as the *seeded* demo user, whose wallets are anvil-funded, sends 0.01 ETH in wei with an idempotency key, polls the activity feed to confirmed), and `05-concurrency` (fires N sends with `Promise.all` and asserts unique + consecutive nonces — the nonce lock as a script). 01/02/03 work with any fresh account; 04/05 need funded wallets, so they require `pnpm db:seed` first and are documented as such in the examples README.

**Files touched** — [packages/sdk/src/index.ts](packages/sdk/src/index.ts) → the `VencuraClient` (replaced the 5-line stub) · [packages/sdk/examples/](packages/sdk/examples/) → 5 scripts + [README](packages/sdk/examples/README.md). Added `viem` (signature recovery), `tsx` (runner), `@types/node` (the SDK had no Node types, so `process`/`fetch` didn't typecheck) to the SDK package.

**Tests / verify.** Mode = scaffold/docs → smoke, not TDD (it's a thin client + example scripts; §13 says don't build a harness to test configuration/usage). Smoke: 16/16 turbo tasks green, and **examples 01 + 03 run live against the Railway API** — 01 created a wallet (`0xDE30…5276`), 03 signed a message and recovered the signer locally to the wallet's own address. That's the SDK exercising the full stack end to end.

**Gotchas** — (1) The SDK had no `@types/node`, so `process.env` and the global `fetch` failed typecheck until it was added. (2) The example `tsconfig` only includes `src`, so the example scripts aren't part of `tsc --noEmit` — they're validated by actually running them (tsx). (3) 04/05 deliberately log in as the seeded demo user instead of registering fresh, because a brand-new wallet is unfunded and every send would fail the balance check.

---

## v1.0.0 · Block 8 · T-036 Security &amp; custody writeup    ([#37](https://github.com/xbt-a4224j/vencura/issues/37) · [commit](https://github.com/xbt-a4224j/vencura/commit/00a68e8))
**What & why.** The single highest-value security deliverable for a custodial wallet platform: the brief explicitly accepts "a writeup" for security, and for a custody-focused system the *reasoning about custody* matters more than another feature. This is also the designated home for everything we **documented-not-built** across the project — rate limiting, the tamper-evident audit ledger, MPC, KMS — so the simplification cuts read as deliberate design decisions, not omissions.

**How it works (the document).** [docs/SECURITY.md](docs/SECURITY.md) is structured as: (1) scope & assets table; (2) a threat model with actors, trust boundaries, and a threat→mitigation→residual-risk table; (3) **key custody** as the centerpiece — the `Signer` seam, the built `EncryptedKeySigner` (AES-256-GCM envelope, in-memory-only decrypt, authenticated-encryption tamper detection), and the **custody spectrum** (encrypted-key *built* → Shamir 2-of-2 *designed* → MPC/threshold *designed* → non-custodial *designed*), each a drop-in behind the same interface; (4) auth/authz (JWT + per-wallet ownership + the timing-safe admin guard); (5) concurrency correctness as a *security* property (nonce lock, idempotency, live-state validation, in-lock policy to close the TOCTOU); (6) validation/error hygiene; (7) an **honest weaknesses** section that names the single-master-key risk, open registration, the cut rate limiter, the non-tamper-evident history, and the custodial-trust assumption; (8) the **how-it-scales** path (KMS/HSM, MPC, durable nonce pools, Redis lock, confirmation webhooks); (9) deployment secret hygiene.

**Files touched** — [docs/SECURITY.md](docs/SECURITY.md) (new).

**Verify.** Docs ticket — no test. Cross-checked every claim against the shipped code (the AES-GCM helper, `AdminGuard`'s `timingSafeEqual`, the advisory-lock critical section, the zod/RFC-7807 stack) so the writeup describes what's actually there, with the aspirational parts clearly labelled "designed, not built."

**Gotchas** — the writeup is honest about being a *testnet* posture: it scopes out real-asset loss and KYC, and it's explicit that the API (not the Vercel edge) is the security perimeter, since the Railway URL is reachable directly. Note: T-036 is technically a Block 8 ticket pulled forward — like the deploy, it doesn't depend on the remaining tickets and is the highest-leverage thing to have done.

---

## v0.7.0 · Block 7 · T-035 ★ BONUS ShamirSigner (2-of-2 key split)    ([#36](https://github.com/xbt-a4224j/vencura/issues/36) · [commit](https://github.com/xbt-a4224j/vencura/commit/881b0ec))
**What & why.** The headline security bonus, and the payoff for the whole architecture: a second custody model that drops in behind the `Signer` seam with **zero changes to any caller**. Where `EncryptedKeySigner` stores the *whole* key (encrypted), `ShamirSigner` splits it so the whole key is **never written anywhere** — only two shares are, and a single Shamir share is information-theoretically opaque (reveals nothing about the key, unlike a ciphertext which is the key behind a breakable cipher). This is the concrete bridge toward the MPC story in the security writeup: "the key never exists whole at rest."

**How it works (mechanism).** On `createKey()`, a fresh private key is split via 2-of-2 Shamir Secret Sharing (the maintained `shamirs-secret-sharing` lib — §3.1 never hand-roll crypto) into `[shareA, shareB]`. shareA is kept plaintext; shareB is AES-256-GCM-encrypted with the master key. Both are packed into the **existing** envelope columns — `encryptedPrivateKey = shareA(hex) . encrypted(shareB)`, with the iv/authTag columns holding shareB's — so it's a true drop-in with **no schema change**. At sign time (`withReconstructedKey`), the envelope is split on `.`, shareB is decrypted, `sss.combine([shareA, shareB])` reconstructs the key transiently in memory, it signs, and then `keyBuf.fill(0)` + `shareB.fill(0)` zeroize the sensitive buffers. The two-trust-domain property: a DB dump alone can't reconstruct (shareB is ciphertext needing the master key); the master key alone can't (no DB). `signMessage` and `signTransaction` share the one reconstruction helper.

**The seam in action.** `signer.module.ts` now provides both signers and a `useFactory` that picks one from `process.env.SIGNER` (`shamir` → ShamirSigner, else the encrypted-key default). Flipping custody models is a **one-line env change** with no code touched anywhere else — wallets/transactions call `signer.signTransaction(...)` and never know the difference. That's the architectural thesis (custody is pluggable) demonstrated as running code, not just asserted in a doc.

**Honest limitation (documented).** Both shares still live in one DB host, so this isn't true trust-domain separation — the real version splits shares across an HSM / MPC parties / the client. That's stated in [docs/SECURITY.md](docs/SECURITY.md) §3.3 as the next step. What this proves is the *primitive* (SSS reconstruction round-trips and signs correctly) and the *seam* (clean swap), which is the bonus's intent.

**Files touched** — [shamir.signer.ts](packages/api/src/signer/shamir.signer.ts) (new) · [shamirs-secret-sharing.d.ts](packages/api/src/signer/shamirs-secret-sharing.d.ts) (ambient types for the untyped lib) · [signer.module.ts](packages/api/src/signer/signer.module.ts) (env-selected factory) · [.env.example](.env.example) (`SIGNER`).

**Tests (red→green).** TDD: [shamir.signer.spec.ts](packages/api/src/signer/shamir.signer.spec.ts) — (1) `createKey` returns a valid address + a two-part envelope that is NOT the raw key; (2) **round-trip** — a message signed via the reconstructed key recovers (EIP-191) to the wallet address, proving split→encrypt→store→read→decrypt→combine→sign all line up; (3) neither stored part contains the whole key. 84 green.

**Demo / verify** — set `SIGNER=shamir`, restart the API, create a wallet, sign/send — identical behavior to encrypted-key, but the stored envelope is `shareA.encShareB` and the whole key is never persisted.

**Gotchas** — (1) the `shamirs-secret-sharing` package ships no types, hence the one-file ambient `declare module`. (2) Splitting `Buffer.from(privateKey, 'utf8')` (the `0x…` string bytes) and re-joining via `combine().toString('utf8')` round-trips the key exactly without hex juggling. (3) shareA is stored hex-encoded so it survives the `.`-delimited envelope intact.

---

## v1.0.0 · Block 8 · T-037 E2E happy-path test (real anvil + Postgres)    ([#38](https://github.com/xbt-a4224j/vencura/issues/38) · [commit](https://github.com/xbt-a4224j/vencura/commit/edbcaa9))
**What & why.** Testing is a graded focus area, and until now every test mocked the chain boundary. This is the one test that exercises **real everything** — the real Nest `AppModule`, real Postgres, a real chain (anvil), real key generation + signing, and the real confirmation poller — end to end: create wallet → fund → read balance → send → confirmed. It's the test that catches integration bugs the unit suite structurally can't (the kind that bit us in Block 4: the `$executeRaw` advisory-lock bug was invisible to mocks and only surfaced against a real DB).

**How it works (mechanism).** The spec boots the full `AppModule` via `Test.createTestingModule` (so every real module + the scheduler wire up), applies the `ZodValidationPipe`, and drives it through `supertest`: register → create two wallets → fund the sender with `createTestClient({mode:'anvil'}).setBalance(...)` → assert `GET /balance` confirmed > 0 → `POST /transactions` (asserts a real txHash + nonce 0). For confirmation it calls `ConfirmationWatcher.reconcile()` directly in a **bounded retry loop** (up to 20 × 250ms) rather than waiting on the watcher's 5s interval — deterministic, and fast because anvil mines on demand. `CONFIRMATIONS=1` is set so a tx in the head block confirms (head − block + 1 ≥ 1). The whole thing is gated by `RUN_DB_TESTS` so the normal `pnpm test` skips it (no infra required for the default suite).

**CI.** The `db-tests` job already had a Postgres service; it now also installs **Foundry** (`foundry-rs/foundry-toolchain@v1`) and starts `anvil --host 0.0.0.0 --chain-id 31337 &` as a background step, with `RPC_URL` pointed at it. The e2e is appended to the `--no-file-parallelism` gated run. (Service containers can't override the foundry image's entrypoint args, so anvil is started as a step, not a service.) CI green on the first run including the e2e.

**Files touched** — [happy-path.e2e.spec.ts](packages/api/src/transactions/happy-path.e2e.spec.ts) (new) · [.github/workflows/ci.yml](.github/workflows/ci.yml) (Foundry + anvil + the e2e in the gated run).

**Tests.** The spec IS the test — 1 e2e covering the full happy path, green locally (~4.3s) and in CI. 84 unit + 3 gated (lock, policy-race, happy-path) all pass.

**Demo / verify** — `docker compose up -d` (Postgres + anvil) then `RUN_DB_TESTS=1 pnpm --filter @vencura/api exec dotenv -e ../../.env -- vitest run src/transactions/happy-path.e2e.spec.ts`. Manual Sepolia variant: point `RPC_URL` at Sepolia and fund the wallet from a faucet instead of `setBalance`.

**Gotchas** — (1) the tx isn't always mined the instant `sendRawTransaction` returns, so a single `reconcile()` left it `pending`; the bounded retry loop absorbs that latency deterministically. (2) `CONFIRMATIONS` must be set to 1 for anvil (on-demand mining → head == block), else the tx never reaches the confirmation threshold. (3) booting the full `AppModule` also starts the 5s interval watcher; harmless (idempotent), but the manual `reconcile()` is what makes the test deterministic.

---

## v0.7.0 · Block 7 · T-040 Institutional UI theme    ([#41](https://github.com/xbt-a4224j/vencura/issues/41) · [commit](https://github.com/xbt-a4224j/vencura/commit/1e35f88))
**What & why.** A presentation pass — the admin was functional but entirely unstyled (zero CSS, zero classNames). For a custody reviewer the *first impression* matters, so this gives it an institutional dark theme: deep-ink surfaces, a restrained accent, and — the highest-signal detail — chain data (addresses, hashes, amounts) in **monospace tabular**, which reads "financial infrastructure." Strictly a presentation change: no API, no behavior, no new dependency.

**How it works (mechanism + the key decision).** The deliberate choice was **plain global CSS + design tokens, no component library** (Tailwind/MUI would be over-engineering for a handful of screens — §3.1). The strategy minimizes churn: style the *bare elements* (`body`, `button`, `input`, `code`, `h2–h4`, `ul/li`, `a`, `details`) globally so most of the institutional look lands with **no markup change at all**, then add only a few targeted classes where semantics need them — `.app` (layout container), `.tabs` (the Wallets/Admin nav), and `.pill` (status). Design tokens live in `:root` CSS variables (`--bg`, `--panel`, `--accent`, `--ok/--pending/--fail`, `--mono`), so the palette is swappable in one place. `code` gets `font-variant-numeric: tabular-nums` + `user-select: all` so hashes line up and click-copy cleanly. Status pills colour by class (`.pill.confirmed/.pending/.failed/.signed`) using `color-mix` for translucent tinted backgrounds.

**Accessibility (part of the AC).** AA contrast on the dark palette (muted text `#8c98a9` on `#0b0e14` ≈ 7:1), a visible `:focus-visible` outline (2px accent), and a `prefers-reduced-motion` block that kills all transitions/animations. Semantic HTML was preserved (real `<header>`, `<nav>`, `<form>`, `<label>`), so the theme is presentational only.

**Files touched** — [packages/web/src/index.css](packages/web/src/index.css) (new — the whole theme) · [main.tsx](packages/web/src/main.tsx) (`import './index.css'`) · [App.tsx](packages/web/src/App.tsx) (added `.app`/`.tabs`/`.pill` classes + a title in the dashboard header; ~5 small edits).

**Tests / verify.** Mode = presentation → no tests (a §13 config/presentation change; there's no behavior to test-drive). 4/4 web turbo tasks green (typecheck/lint/test/build). Auto-deploys to Vercel on push — viewable live.

**Gotchas** — (1) styling bare elements globally is powerful but blunt: it themes everything including the login screen for free, but means the few structural classes have to be specific enough not to fight the element rules. (2) `color-mix(in srgb, …)` for pill tints is well-supported in current browsers; a flat rgba fallback would be the conservative move if older browser support mattered. (3) `user-select: all` on `code` makes a single click select the whole hash — intentional for copy-paste, but worth knowing it changes default text-selection behavior there.

---

## v0.7.0 · Block 7 · T-034 Smart-wallet design spike (exploration)    ([#35](https://github.com/xbt-a4224j/vencura/issues/35) · [commit](https://github.com/xbt-a4224j/vencura/commit/0e4a6bd))
**What & why.** A design note + small spike — explicitly *not* a build — on where VenCura could go beyond externally-owned accounts (EOAs). It's forward-vision signal: account abstraction is the modern custody conversation, and the doc reasons about it *from this codebase's vantage point* (custodial EOAs behind the `Signer` seam), not in the abstract.

**How it works (the content).** [docs/smart-wallet-design.md](docs/smart-wallet-design.md) lays out: (1) where we are — dumb EOAs with off-chain policy; (2) what a smart account buys (on-chain policy, recovery, gas sponsorship/paymasters, batching, session keys); (3) the two live paths — **ERC-4337** (per-user account contract + UserOps + bundler + EntryPoint + paymaster; richest but real infra) and **EIP-7702** (an EOA temporarily adopts contract code via a signed authorization; keeps the existing address, lighter, incremental); (4) how either slots into the **`Signer` seam** as a new `SmartAccountSigner` that reuses the *current* signer for the inner signature — additive, not a rewrite — with pseudocode; (5) a recommendation: not now, and if pursued, start with 7702 because it keeps our already-custodied EOA addresses.

**Files touched** — [docs/smart-wallet-design.md](docs/smart-wallet-design.md) (new).

**Verify.** Docs/spike — no test. The through-line ties back to the architecture: both AA paths reuse the `Signer` seam for the inner signature, the same pluggability the ShamirSigner bonus demonstrated — so "smart wallet" would be another signer alongside the others, not a migration.

**Gotchas** — kept honest about maturity (7702 is post-Pectra and newer) and scope (4337 needs audited account code + bundler/paymaster infra, out of scope for the brief). The spike pseudocode is illustrative, not runnable.

---

## v0.7.0 · Block 7 · T-041 Separate tests from source    ([#42](https://github.com/xbt-a4224j/vencura/issues/42) · [commit](https://github.com/xbt-a4224j/vencura/commit/010ce45))
**What & why.** A structure/readability pass (CLAUDE.md §3.1): all 28 spec files lived co-located with source under `src/`, interleaving tests with functionality. They now live in a per-package `test/` tree that **mirrors** `src/` — `src/transactions/transactions.service.ts` ↔ `test/transactions/transactions.service.spec.ts` — so opening `src/` shows only shipped code. The locked decision was a full mirror (all spec types: `*.spec`, `*.int.spec`, `*.e2e.spec`) plus a tsconfig path alias so test imports stay clean. Done now, after the simplify/Shamir/e2e batches, so the spec set was final — move once, not twice.

**How it works (mechanism).** A migration script walked every `*.spec.ts` under `src/`, and for each: computed its mirror path under `test/`, and rewrote every **relative** import by resolving it against the spec's original `src/` directory and re-expressing it as the `@/*` alias. So `import { foo } from '../infra/lock/lock'` in `src/transactions/x.spec.ts` became `import { foo } from '@/infra/lock/lock'` — depth-independent, exact. Bare module imports (`vitest`, `@nestjs/*`, `@vencura/shared`) were untouched. The alias is declared in three places that must agree: `tsconfig.json` `paths` (`@/* → src/*`), and `resolve.alias` in both `vitest.config.ts` (api) and `vite.config.ts` (web).

**The config split (the subtle part).** Two tsconfigs deliberately diverge: `tsconfig.json` now `include`s `["src", "test"]` (so typecheck and the editor see the specs) with the alias + `baseUrl`, and `rootDir` removed; `tsconfig.build.json` re-pins `rootDir: "src"`, `include: ["src"]`, and excludes `test/` + all spec globs — so the production build emits **only** source. Conflating them would either leave tests untypechecked or leak test files into `dist/`. `vitest.config` `include` moved to `test/**`, `coverage.include` points at `src/**` (coverage maps to source, not tests), and the `lint` scripts widened to `eslint src test`. CI's `db-tests` job had explicit spec paths — updated to the `test/` locations.

**Files touched** — 28 specs moved `src/ → test/` (api 27, web 1) · [packages/api/tsconfig.json](packages/api/tsconfig.json) + [tsconfig.build.json](packages/api/tsconfig.build.json) + [vitest.config.ts](packages/api/vitest.config.ts) + package.json lint · web [tsconfig.json](packages/web/tsconfig.json) + [vite.config.ts](packages/web/vite.config.ts) + package.json lint · [.github/workflows/ci.yml](.github/workflows/ci.yml) gated paths.

**Tests / verify.** Smoke (structure change, no behavior): **same count** — 84 unit pass + 3 gated (lock/policy-race/happy-path) — typecheck/lint/build green, 9/9 turbo tasks, and CI green incl. `db-tests` hitting the new `test/` paths and the e2e resolving `@/app.module` from `test/transactions/`. `src/` has zero remaining spec files.

**Gotchas** — (1) the `@` alias must be set in all three configs or it resolves in one tool but not another (a green `pnpm test` with a red `tsc`, or vice-versa). (2) `rootDir` had to move from the shared tsconfig into the build-only one — keeping it in the shared config would error once `test/` files (outside `src/`) were included. (3) the migration is a one-time move — doing it before later batches would have meant re-moving newly-added specs.

---

### Block 6 recap — SDK, examples & deploy → **v0.6.0** ✅

**Shipped:** a typed **`VencuraClient`** (hand-written, not OpenAPI-generated — small surface) plus **5 runnable example scripts** (create-wallet, get-balance, sign-message+EIP-191 recovery, send-transaction, concurrency) verified live against the deployed API (T-025/T-026); and the **full live deployment** (T-027) — React web on **Vercel**, NestJS API in a multi-stage **Docker** image on **Railway**, **Neon** Postgres, Infura **Sepolia** RPC. The web reaches the API same-origin via a `/api/*` Vercel rewrite; `prisma migrate deploy` runs on container boot; `/admin/*` is hardened behind a timing-safe `x-admin-key`. **How to demo:** open **vencura-alpha.vercel.app**, register, create a wallet, sign a message — or run the SDK examples with `VENCURA_API_URL` pointed at the live API. The deploy was pulled forward (it depends only on CI), which surfaced and fixed a cluster of real-world gotchas — stale `origin/main` builds, Neon pooled-vs-direct host, Railway `PORT`/`targetPort`, the `x-vercel-forwarded-for` client IP. Issues #26–#28 closed.

---

### Block 7 recap — nice-to-haves & bonus → **v0.7.0** ✅ (selective)

**Shipped (the high-signal subset):** the **★ ShamirSigner bonus** (T-035) — a 2-of-2 Shamir key split that drops in behind the `Signer` seam with zero caller changes (`SIGNER=shamir`), proving custody is pluggable; the **institutional dark UI theme** (T-040) — token-driven, monospace chain data, status pills, AA-accessible, no behavior change; the **smart-wallet design spike** (T-034) — a doc reasoning about ERC-4337 vs EIP-7702 vs our EOA custody and how either slots into the seam; and **test/source separation** (T-041) — all specs into a `test/` mirror with a `@/*` alias. **Deliberately left optional** (per the simplicity directive — these are tangential to the custody story): T-028 many-accounts, T-029 account↔account transfers, T-030 shared access, T-032 contract read/write, T-033 XMTP. (T-031 on/off-chain history was satisfied during Block 5 via the activity reader.) Issues #34, #35, #41, #42 closed; #29–#33 left open as scoped-out stretch.

---

### Block 8 recap — hardening, writeup & README → **v1.0.0** ✅

**Shipped:** the **security & custody writeup** (T-036, `docs/SECURITY.md`) — threat model, the encrypted-key → Shamir → MPC → non-custodial spectrum, honest weaknesses, and the documented scale path (the home for everything cut as "documented, not built"); the **E2E happy-path test** (T-037) — real `AppModule` + Postgres + anvil, create → fund → send → confirmed, with anvil wired into CI; the **README with Mermaid system + sequence diagrams** (T-038); and **final polish** (T-039) — readability sweep (no TODOs/dead code), these block recaps, and a demo dry-run. Mid-stream this block also ran the **simplification sweep** — removing rate limiting and the tamper-evident audit-log design in favor of the requirement-true activity history — making the late codebase net-*smaller* while mapping tighter to `REQUIREMENTS.md`. Issues #37, #38 (+#39, #40) closed. **v1.0.0.**

---

## v0.x · Block 7 · T-029 Account↔account transfers + T-032 Contract read/write    ([#30](https://github.com/xbt-a4224j/vencura/issues/30) · [#32](https://github.com/xbt-a4224j/vencura/issues/32) · [commit](https://github.com/xbt-a4224j/vencura/commit/1edad22))
**What & why.** Two stretch features chosen because they *flex the architecture with near-zero new machinery* — both ride the existing locked send path. Account↔account transfer is the "checking → savings" move (send to one of your own wallets); generic contract read/write is the "this isn't just ERC-20-transfer hardcoded" generalization. The whole point: because `send()` was built as a real critical section (advisory lock → live nonce → policy → sign → broadcast → idempotent persist), both features are thin reuses rather than reimplementations.

**How #30 works.** `TransactionsService.transfer(fromWalletId, userId, {toWalletId, asset, amount})` calls `wallets.findOwnedOrThrow(toWalletId, userId)` — which throws 403 if the destination isn't the caller's, satisfying the "reject cross-owner" AC for free — then resolves the destination's address and delegates to `send(fromWalletId, userId, {to: dest.address, asset, amount})`. Zero new transaction logic; it's address-resolution + an ownership guard in front of the send path. `POST /wallets/:id/transfers`.

**How #32 works.** The realization: an ERC-20 transfer was *already* a generic contract call (`encodeFunctionData(erc20Abi, 'transfer', …)`) routed through `send()`. Generalizing it took **one optional `data` field** on the internal send input and **one branch** in the tx builder: `dto.data ? {to, data, value} : (native | erc20)`. So `writeContract(walletId, userId, {address, abi, functionName, args, value})` just `encodeFunctionData`s the call and delegates to `send()` with `to=contract, data=encoded, amount=value` — inheriting nonce/lock/idempotency/broadcast untouched. Read is a separate, lock-free `ChainService.readContract` (an `eth_call` + decode); its endpoint JSON-safes the result (bigints → strings) since viem returns bigints. `POST /contract/read`, `POST /wallets/:id/contract/write`.

**The UX decision (Alex's point: raw contract calls aren't demoable).** A paste-the-ABI textarea is a dev tool, not a product. So the web leads with **friendly, curated surfaces** over the same generic API: an **internal-transfer** form (dropdown of your other wallets), an **ERC-20 token inspector** (paste a token address → name/symbol/decimals/your `balanceOf`), and an **approve-a-spender** form — with the fully-generic `(abi, fn, args)` read/write tucked into a collapsed **"Advanced — raw call"** panel for power users. Generic capability underneath; curated front door on top.

**Files touched** — shared: [transfer.schema.ts](packages/shared/src/transfer.schema.ts), [contract.schema.ts](packages/shared/src/contract.schema.ts) · api: [transactions.service.ts](packages/api/src/transactions/transactions.service.ts) (transfer/writeContract + the `data` branch), [chain.service.ts](packages/api/src/infra/chain/chain.service.ts) (readContract), [transfers.controller.ts](packages/api/src/transactions/transfers.controller.ts), [contracts.controller.ts](packages/api/src/transactions/contracts.controller.ts) + DTOs · web: [api.ts](packages/web/src/api.ts), [App.tsx](packages/web/src/App.tsx) (`TransferForm`, `ContractPanel`, `RawContractCall`).

**Tests (red→green).** Test-first on the two genuinely-new logic bits in `transactions.service.spec`: (1) `send` with `data` builds a tx carrying that calldata + `value` (the contract-write path); (2) `transfer` ownership-checks the destination (`findOwnedOrThrow(toWalletId, …)`) and broadcasts via `send` (one `sendRawTransaction`). The thin wrappers + the chain read are smoke-verified. 86 unit + 3 gated green; 16/16 turbo tasks.

**Gotchas** — (1) viem `readContract` returns **bigints**; the read endpoint recursively stringifies them or the JSON response throws. (2) the generic write goes through policy too — a contract address must be allowlisted (or the wallet have no policy), same as any send. (3) the public `SendTransactionSchema` stays clean — `data` is on the *internal* send input only, set by `writeContract`, not exposed on the `/transactions` endpoint.

## UX overhaul · Phase 0 — light theme + ETH amounts + send validation    ([#41](https://github.com/xbt-a4224j/vencura/issues/41))
**What & why** — The UX review (`docs/study/ux-redressal.md`) flagged a dark dev-console read, raw-wei amounts, and a 500 on a bad recipient. Phase 0 ships the high-leverage core (presentation + one real API fix).
**How it works** — Light enterprise palette as CSS tokens in [index.css](packages/web/src/index.css) (dark `#0b0e14` removed). [format.ts](packages/web/src/format.ts) `toEth`/`shortHex` render balances + policy limits in ETH (wei in tooltips); policy editor now takes ETH and `parseEther`s on save. `SendTransactionSchema.to` is address-validated ([send.schema.ts](packages/shared/src/send.schema.ts)) so a bad recipient is a **400, not a 500**; the SendForm adds client `isAddress` + `amount>0` guards; `call()` never surfaces a bare "Internal server error" on a 5xx. Reusable `CopyButton`/`HashLink` make every address/hash/signature copyable + Etherscan-linked; a fund-first hint appears when ETH available is 0; the concurrency demo gained an explainer + fund/recipient gating; the auth menu defaults to **Log in**; recipients are grouped in `<optgroup>`s.
**Tests** — [send.schema.test.ts](packages/shared/src/send.schema.test.ts) proves a non-address `to` is rejected (the 400); `send.e2e.spec.ts` fixtures updated to valid addresses. Green: typecheck 5/5, lint 4/4, build ok, 86 api + 3 shared tests (3 gated-skipped).
**Gotchas** — the stricter `to` broke 2 HTTP e2e tests using a fake `0xRecipient` (they POST through the `ZodValidationPipe`); service-level unit tests call `send()` directly so bypass the pipe and were unaffected — fixed the e2e fixtures to a valid 0x address.

## UX overhaul · Phases 1–2 — policy pre-flight, concurrency viz, sign→verify, nicknames    ([#41](https://github.com/xbt-a4224j/vencura/issues/41))
**What & why** — Visual-system polish (Phase 1) + feature merchandising (Phase 2) from `docs/study/ux-redressal.md` §3–§5: make the strong-but-invisible features *visible*.
**How it works** — The send form is now a `.form-grid` (label-above-input) with a **live policy pre-flight** — a client mirror of the wallet's allowlist + per-tx limit shows green "within policy" / red "would be blocked: <reason>" as you type (daily limit stays server-enforced). The concurrency demo renders a **nonce-ordered timeline** (lock icon · `nonce N` · broadcast/failed pill) + an "N/N serialized ✓" verdict instead of the old bare line. A **sign → verify** loop recovers the signer via viem `recoverMessageAddress` and proves it equals the wallet. Editable per-wallet **nicknames** ([format.ts](packages/web/src/format.ts) `walletLabel`, client-side) show on the card + in recipient options; **policy badges** (Allowlist N · Per-tx ≤ X · Daily ≤ Y) summarize the policy; a freshly-created wallet **flashes**. (Typography/pills/a11y already landed in Phase 0's [index.css](packages/web/src/index.css).)
**Tests** — no API behavior change; typecheck 5/5, lint 4/4, build ok, full suite green.
**Gotchas** — `SendForm` now requires a `policy` prop (sole caller is `WalletItem`); the pre-flight previews allowlist + per-tx only (the daily cap needs today's spend, so it's left to the server).

## UX overhaul · Phase 3 (partial) — header status bar; master–detail deferred    ([#41](https://github.com/xbt-a4224j/vencura/issues/41))
**What & why** — Phase 3 (§4) is the layout architecture. Shipped the contained, verifiable piece: a header **status bar** (`Sepolia ●` + last-updated time + a global Refresh) in [App.tsx](packages/web/src/App.tsx) `Shell`. Dev/operator separation already exists via the Wallets/Admin tabs.
**Deferred (anti-churn) — the master–detail restructure + detail-pane tabs.** These are a large `App.tsx` rewrite (left rail + selection state + tab panels) whose only failure mode is *visual*: a build/typecheck pass does not prove the layout is usable, and this (headless) session can't render pixels to verify it. Per the task's own anti-churn rule ("if it isn't converging cleanly, STOP, keep what works, report"), I stopped rather than ship a blind restructure. The full spec is in `docs/study/ux-redressal.md §4` for a session that can eyeball it.
**Tests** — typecheck 5/5, lint 4/4, build ok, full suite green.

## Backend/wow · B1 — error taxonomy (codes + trace ids)    ([#41](https://github.com/xbt-a4224j/vencura/issues/41))
**What & why** — Coded, traceable errors read as a production system (ux-redressal §3 #3; the brainstorm's "audit & observability"). Every error now carries a stable `code` + a per-error `traceId`.
**How it works** — [chain-error.ts](packages/api/src/common/chain-error.ts) returns a `code` (INSUFFICIENT_FUNDS / NONCE_TOO_LOW / REPLACEMENT_UNDERPRICED / RPC_UNAVAILABLE). [all-exceptions.filter.ts](packages/api/src/common/all-exceptions.filter.ts) adds `code` (via a `codeFor` taxonomy — POLICY_VIOLATION, INVALID_ADDRESS, UNAUTHORIZED, NOT_FOUND, CONFLICT, INTERNAL, …) and a `traceId` (`randomBytes(4)`) to the RFC-7807 body, and logs `[traceId]` on a 5xx so a reported error maps to a server log line. The web client surfaces the traceId in 5xx messages.
**Tests** — chain-error.spec asserts the code; filter.spec asserts code + a traceId (+ no-leak still holds). 13 common tests green; full suite green.

## Backend/wow · B2 — live chain-head heartbeat (block + gas)    ([#41](https://github.com/xbt-a4224j/vencura/issues/41))
**What & why** — The "system is alive" ambient signal (the brainstorm's block-height heartbeat + metrics). A ticking block number reads as connected-to-a-live-chain even when idle.
**How it works** — `ChainService.getGasPrice()` + a public `GET /chain/head` ([chain.controller.ts](packages/api/src/infra/chain/chain.controller.ts)) return `{ network, blockNumber, gasGwei }`; the web `Shell` polls it every 6s and renders `Sepolia ● · block N · gas X gwei` in the status bar (block ticking = heartbeat). Public chain data, so unauthenticated.
**Tests** — thin passthrough controller (§13 config → smoke): typecheck 5/5, lint 4/4, build ok, full suite green.

## Backend/wow · recap — shipped vs roadmap
**Shipped (verified + committed):** B1 error taxonomy (codes + trace ids), B2 live chain-head heartbeat (block + gas) — on top of UX overhaul Phases 0–2 (concurrency timeline, sign→verify, policy pre-flight, light theme, wei→ETH, the 500→400 zod fix). **Designed-not-built (documented):** the live-log console (deploy-safe ring-buffer + polling approach), live deposit detection, count-up/optimistic polish, the master–detail layout, and the heavy custody infra (KMS/MPC signer split, m-of-n approval workflows, signed webhooks + replay, multi-chain abstraction, reconciliation). Full plan with approach/endpoints/data-model in `docs/study/backend-roadmap.md`. The call throughout: build what lands verified-green in this lean codebase, document the rest as the scale path — making the existing engine *visible* over half-building subsystems.

## Venmo redesign · one wallet per account + people directory + Venmo user view    ([#41](https://github.com/xbt-a4224j/vencura/issues/41))
**What & why** — Make the app feel like Venmo: every account has ONE auto-provisioned, master-funded wallet; the User view is a balance + people-picker Pay card; the engineering surfaces (create wallet, concurrency demo, internal transfer, policy editor) move into Admin.
**How it works** — [provisioning.service.ts](packages/api/src/wallets/provisioning.service.ts) `provision()` is idempotent (returns the existing wallet) else creates one and funds it with `PROVISION_ETH` (0.001) from a STATIC master wallet (`findMaster`: DEMO_FUNDED_PRIVKEY address, else demo user's oldest wallet), serialized on the **master's** advisory lock so concurrent provisioning can't reuse a nonce; gasless/missing master logs and leaves it unfunded (no 500). [people.service.ts](packages/api/src/wallets/people.service.ts) → `GET /people` lists other accounts' first wallet `{accountId,email,address}`. Web: [App.tsx](packages/web/src/App.tsx) `Venmo`/`VenmoSend` provision on entry, auto-poll balance every 12s (no Refresh button), annotate each person allowed ✓ / 🔒 vs the wallet's allowlist with an inline **Allow** (appends via `setPolicy`); Admin renders `WalletsTab` for the demo machinery.
**Files touched** — [provisioning.service.ts](packages/api/src/wallets/provisioning.service.ts), [people.service.ts](packages/api/src/wallets/people.service.ts) + [people.controller.ts](packages/api/src/wallets/people.controller.ts), [wallets.controller.ts](packages/api/src/wallets/wallets.controller.ts)/[wallets.module.ts](packages/api/src/wallets/wallets.module.ts), [scripts/consolidate.mjs](scripts/consolidate.mjs) (manual sweep-to-master ops tool), [api.ts](packages/web/src/api.ts), [App.tsx](packages/web/src/App.tsx).
**Tests** — [provisioning.service.spec.ts](packages/api/test/wallets/provisioning.service.spec.ts): second `provision` returns the same wallet + funds exactly once (red→green). e2e module tests get a @Global infra mock (Chain+LOCK) now that WalletsModule hosts ProvisioningService. Full suite green (88 passed / 3 skipped), lint 4/4, typecheck 5/5, build ok.
**Demo / verify** — sign in as any account → wallet appears funded; pick a person, Pay; non-allowlisted shows 🔒 + Allow. `node --env-file=.env scripts/consolidate.mjs` (dry run) prints the sweep plan.
**Gotchas** — Master funding reuses the send critical section inline (not `TransactionsService.send`, which is owner-scoped) so the SYSTEM transfer isn't attributed to the caller. With DEMO_FUNDED_PRIVKEY unset locally, master = demo user's oldest wallet — fund THAT address for provisioning to actually move ETH.

## v0.x.0 · Block 5 · Event bus + audit-grade activity (#8)
**What & why** — Durable governance/audit trail + a live "system log", from one source two sinks: `emit()` → ephemeral ring buffer (live log), `record()` → `audit_log` row + ring. Backs the Activity tab's two subviews.
**How it works** — [EventsService](packages/api/src/infra/events/events.service.ts) holds a 200-line bounded ring keyed by a monotonic `seq`; `GET /events?after=seq` tails it. `record()` also writes [audit_log](packages/api/prisma/schema.prisma). Policy changes + wallet creation now emit durable events. [ActivityService.recentForUser](packages/api/src/transactions/activity.service.ts) merges tx + signatures + audit across all a user's wallets → `GET /activity`.
**Files touched** — events.{service,controller,module}.ts · activity-merge.ts (audit kind + walletId) · activity.controller.ts (UserActivityController) · policy.controller.ts + wallets.service.ts (record) · api.ts (listAllActivity/events).
**Tests** — [events.service.spec.ts](packages/api/src/infra/events/events.service.spec.ts): seq monotonicity, `since(after)` cursor, 200-cap eviction, `record()` persists+rings. Green: 88 passed.
**Gotchas** — Ring is per-process (fine on Railway's long-lived node; poll over Vercel rewrite). audit_log has no FK relations on purpose — history outlives the wallet/user.

## v0.x.0 · Block 5 · Admin → 5-tab console + trust/polish (#1,#2,#4,#7,#10,#11,#12)
**What & why** — The single 4,000px Admin scroll became a real tablist console: Overview · Wallets · Policies · Activity · Settings. De-crowds by job, and the Activity tab surfaces #8 (audit log + live system log).
**How it works** — [Tabs](packages/web/src/App.tsx) = role=tablist + ←/→/Home/End + aria-selected; [useHashTab](packages/web/src/App.tsx) deep-links the active tab (#admin/wallets). Wallets are accordion rows (one panel mounted at a time). PolicyEditor rebuilt as a card (labels-above-field grid, dirty-gated save, invalid-address hint). Pay got a confirm step with auto-allow unbundled (explicit opt-in checkbox). Concurrency demo gained a fund-free **Simulate** dry-run. Balance display rounds to 6dp. Demo-mode banner + admin-key shown as "configured ✓", never the value.
**Files touched** — App.tsx (Tabs/useHashTab/DemoBanner/OverviewTab/PoliciesTab/ActivityTab/LiveLog/ActivityTable/SettingsTab, rebuilt WalletsTab+PolicyEditor+VenmoSend+ConcurrencyDemo) · format.ts (toEth dp) · index.css (tablist/cards/table/console/banner).
**Tests** — web typecheck + lint + build green; api 88 passed (unchanged).
**Gotchas** — `react-hooks/exhaustive-deps` rule isn't configured here, so the disable directive itself errors — don't add it. Overview fetches per-wallet balances (N calls) only on its own tab.

## v0.x.0 · Block 5 · Finish trust/a11y/hierarchy (#5,#4,#13)
**What & why** — Closed the three deferred audit items. Cross-tenant enumeration (account picker + payee directory) is now a deliberate DEMO_MODE affordance with the production posture in code; emails masked; the User balance is the visual hero; section headings use real levels.
**How it works** — [demo-mode.ts](packages/api/src/common/demo-mode.ts): `isDemoMode()` (default on; `DEMO_MODE=false` → endpoints stop enumerating tenants) + `maskEmail()`. [PeopleService](packages/api/src/wallets/people.service.ts) + [AuthService.listAccounts](packages/api/src/auth/auth.service.ts) gate on it; payee emails masked. Web: balance → `.bal-hero`, Venmo captions → semantic `<h2 className="cap">`, aria-labels on the contract/transfer/raw-call inputs, nicknames in the transfer dropdown.
**Tests** — [demo-mode.spec.ts](packages/api/test/common/demo-mode.spec.ts) (maskEmail). 96 api tests pass; web green.
**Gotchas** — DEMO_MODE defaults ON so the live demo is unchanged; set it false to see the prod posture (picker empty, no payee directory).

## v0.x.0 · Block 5 · Login as an audited event (#8)
**What & why** — A successful authentication is now a durable governance event, so the audit trail covers session creation alongside policy/wallet/send.
**How it works** — [AuthService.login](packages/api/src/auth/auth.service.ts) injects EventsService (now global) and `record({ type: 'auth.login', detail:{email} })` after a verified login; surfaces on the live log + persists to `audit_log` (no new migration). Failed logins are intentionally NOT recorded as the user (no userId; same 401 to avoid enumeration).
**Files touched** — auth.service.ts (inject + record); test wiring (auth.service.spec, auth.e2e) given an EventsService/EventsModule.
**Tests** — 96 api tests pass.
**Gotchas** — EventsModule imports AuthModule and AuthService injects EventsService (a global provider) — fine because it's not an `imports` cycle, only a global-provider injection.

## v0.x.0 · Block 5 · Picker lists only demo accounts (login bug fix)
**What & why** — Root cause: the User picker listed EVERY user, but each account has its own password; only the seeded `demo@vencura.local` uses the shared `demo-password`, so picking any test/audit registration 401'd. Fix: an `isDemo` flag — the picker shows only demo accounts (all shared-password), so pick-and-click always works.
**How it works** — `users.isDemo` ([schema](packages/api/prisma/schema.prisma); migration backfills the existing demo account). [listAccounts](packages/api/src/auth/auth.service.ts) filters `isDemo:true`, demo first. [seed](packages/api/src/admin/seed.ts) marks the demo account + adds peer accounts alice/bob (unfunded, shared password) so switching + "pay someone" have real accounts. Admin "create account" now goes through admin-gated [POST /admin/accounts](packages/api/src/admin/admin.controller.ts) (demo-password + isDemo) instead of public register.
**Files touched** — schema + migration · auth.service.ts · seed.ts · admin.controller.ts (+ dto) · web api.ts/auth-context.tsx · UserView clearer 401 hint.
**Tests** — 96 api pass; web green.
**Gotchas** — Post-deploy the picker shows only `demo@vencura.local` (junk hidden, not deleted); alice/bob appear after a reset/seed (admin key). Admin create-account now needs the admin key set (it's an admin action).

---

## v0.x.0 · Block 5 · Live-polling toggle, OFF by default    (no issue · commit TBD)
**What & why** — Backend pollers (ConfirmationWatcher, BalanceRefresher) and web pollers (chain head, balance, activity feed) were hitting the Infura RPC 24/7. A single `PollingStateService` boolean (default `false`) gates all of them, slashing idle RPC usage.
**How it works** — [PollingStateService](packages/api/src/infra/chain/polling-state.service.ts) is a global singleton in ChainModule. Pollers check `isLive()` as their first line and return early if off. `GET /chain/polling` (public) reads state; `POST /admin/polling` (admin-gated, Zod-validated) flips it. Web hooks do one initial fetch then start `setInterval` only when `live === true`.
**Files touched** — polling-state.service.ts (new) · chain.module.ts · chain.controller.ts · admin.controller.ts · balance-refresher.service.ts · confirmation-watcher.service.ts · polling-context.tsx (new) · api.ts · App.tsx (useChainHead, usePolledBalance, ActivityFeed, PollingToggle, App root).
**Tests** — Added no-op tests for both pollers when OFF; admin.controller.spec updated. 98 passed.
**Gotchas** — In-memory singleton: restart resets to OFF (desired safe default). Multi-instance deploys get independent state — acceptable for single-node Railway target.

## v0.x.0 · Block 5 · Single-user model + simplification (UX/API)
**What & why** — Big simplification per review: one self-registered User (register if none → login after; no picker), Admin = the seeded funded account. Dropped the recipient allowlist (keep limits), the cross-user people directory, and email masking.
**How it works** — User view = [UserAuth](packages/web/src/App.tsx) (register/login via real credentials) → manage many wallets (reuses WalletsTab). Recipients = own wallets + custom 0x. Policies tab → **Limits** (per-tx/daily only). Nickname is an explicit "Edit nickname…" toggle. Backend: register closes after one non-admin user; GET /auth/user; allowlist removed from schema/engine/policy; people module deleted.
**Files touched** — App.tsx (UserView/UserAuth, SendForm/WalletItem/PolicyEditor de-allowlisted, nickname), auth-context (loginUser/registerUser), api.ts (drop Person/allowlist, +singleUser); api: auth.service/controller, policy.engine/controller, seed, wallets.module, demo-mode (drop maskEmail), migration.
**Tests** — api 94 pass; web typecheck/lint/build green.
**Gotchas** — On deploy the prod DB still has isDemo=false junk accounts → /auth/user would surface one → must run admin reset to clean (done post-deploy). ERC-20 approve/transferFrom demo is the remaining unit.
