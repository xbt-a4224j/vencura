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
