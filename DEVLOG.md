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
