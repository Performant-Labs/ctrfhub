# Spec-enforcer Audit — INFRA-001

**Executed:** 2026-04-24 19:08
**Scope:** diff `main..story/INFRA-001` (commits: `3a5a44d feat(INFRA-001): project scaffold and toolchain`, `c42b470 test(INFRA-001): scaffold smoke tests`)
**Checklists run:** Architecture rules, Coverage, Planning docs conformance, Skills violations (htmx-4-forward-compat, mikroorm-dual-dialect, ctrf-ingest-validation, zod-schema-first)

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|

**No drift detected against `skills/` or `docs/planning/*`.**

## Coverage gaps

| # | What's missing | Required by | Severity |
|---|---|---|---|

**Coverage matches the story's declared Test tiers required and Page verification tiers.**

Verification:
- Story declares **Test tiers required:** unit only ("one test that proves the vitest config wires up correctly")
- `src/__tests__/unit/scaffold.test.ts` provides 7 tests covering: Vitest globals, node environment, PG config import, SQLite config import, `resolveOrmConfig` SQLite branch, `resolveOrmConfig` PG branch, htmx-events import
- Story declares **Page verification tiers:** none (no rendered routes)
- No integration tests required (no routes exist — INFRA-002 adds `buildApp()` and `/health`)
- No E2E tests required (no running app)
- `npm run test:coverage` passes: lines 96.77%, functions 100%, branches 100% (thresholds: 80/80/75)

## Planning-doc conformance (only lines relevant to this story's scope)

- [x] `package.json` has all 14 required scripts per `docs/planning/tasks.md §INFRA-001` acceptance criteria: `dev`, `build`, `test`, `test:unit`, `test:int`, `test:e2e`, `test:coverage`, `test:watch`, `migrate:pg`, `migrate:sqlite`, `migrate:create:pg`, `migrate:create:sqlite`, `css:dev`, `css:build` (plus bonus: `lint`, `typecheck`)
- [x] `tsc --noEmit` passes with zero errors — `docs/planning/tasks.md §INFRA-001`
- [x] ESLint config in place; lint passes — `docs/planning/tasks.md §INFRA-001`
- [x] `vitest.config.ts` exists with coverage thresholds 80% lines / 80% functions / 75% branches — `docs/planning/testing-strategy.md`, `docs/planning/tasks.md §INFRA-001`
- [x] `e2e/playwright.config.ts` exists with two-viewport matrix [1280×800, 375×800] — `skills/viewport-mobile-first-desktop-only.md`
- [x] `playwright-ctrf-json-reporter` wired in Playwright config — `docs/planning/testing-strategy.md §dog-food rule`
- [x] Three MikroORM config files exist: `mikro-orm.config.ts` (runtime selector), `mikro-orm.config.pg.ts`, `mikro-orm.config.sqlite.ts` — `skills/mikroorm-dual-dialect.md`
- [x] Migration directories for both dialects: `src/migrations/pg/`, `src/migrations/sqlite/` — `skills/mikroorm-dual-dialect.md`
- [x] `src/client/htmx-events.ts` bootstrapped as empty constants module — `skills/htmx-4-forward-compat.md`, `docs/planning/tasks.md §INFRA-001`
- [x] TypeScript strict mode enabled with `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax` — `docs/planning/architecture.md §Runtime & Language`
- [x] ESM module system (`"type": "module"`) — `docs/planning/architecture.md §Runtime & Language`
- [x] Node.js 22 LTS floor enforced via `engines` field — `docs/planning/architecture.md §Runtime & Language`

## Forbidden-pattern scan (from CLAUDE.md)

Scan applied to the full diff (`main..story/INFRA-001`). All patterns checked explicitly.

- [x] No `hx-target`/`hx-swap` inherited from a parent — no HTMX attributes exist in this scaffold (confirmed: `grep -r 'hx-target\|hx-swap\|hx-disable' src/` returns zero results)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — only occurrences of `htmx:` are inside `htmx-events.ts` comments (TODO example block), not executable code
- [x] No `hx-disable` anywhere in templates — zero results
- [x] No Alpine `x-data` inside an HTMX swap target (or vice versa) — no `x-data` exists anywhere in `src/`
- [x] No Postgres-only SQL / dialect-specific features without a SQLite equivalent — `grep -r 'p\.array\|p\.jsonb\|p\.uuid' src/` returns zero; entity files are empty (`entities: []`)
- [x] No DB mocked in integration tests — no integration tests exist yet (by design for INFRA-001)
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — no Playwright tests exist yet
- [x] No layout-token change without a T2 backdrop-contrast re-check — N/A, no templates
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — no auth code exists yet
- [x] No Zod schema defined ad-hoc in a handler — no handlers exist yet
- [x] No `interface *Request` or `interface *Body` patterns duplicating a Zod schema — zero results from `grep -r 'interface.*Request\|interface.*Body' src/`
- [x] No `/api/artifact` separate endpoint — zero results
- [x] No `dark:` Tailwind variant in any template — zero results
- [x] No `fastify.orm.em` used directly in a request handler — zero results
- [x] No real AI API calls in test files — zero results from `grep -r 'openai\|anthropic\|groq' src/__tests__/`

## Decisions noted (informational, not findings)

The feature-handoff documents several decisions not explicitly covered by planning docs. None contradict the spec:

| Decision | Adjoins | Risk |
|---|---|---|
| Zod v4 (not v3) | `architecture.md §Backend` | None — v4 API is backwards-compatible for all patterns in `zod-schema-first.md` |
| `@fastify/swagger` + `openapi-types` added | `architecture.md §Backend` | None — peer deps of `@fastify/type-provider-zod` |
| `playwright-ctrf-json-reporter` (unscoped) | `testing-strategy.md` | None — scoped `@ctrf-io/` package returns 404 on npm |
| ESLint v8 (deprecated) | `tasks.md §INFRA-001` | Low — functional; migration to v9 flat config tracked as follow-up |
| Node.js v25.9.0 local runtime | `architecture.md §Runtime` | None — `engines` field pins ≥22; CI will use 22 LTS |

## Verdict

**PASS** — story may proceed to Argos Phase 7 close-out and PR open.

All acceptance criteria from `docs/planning/tasks.md §INFRA-001` are satisfied. No forbidden patterns detected. No spec drift. Test coverage exceeds declared thresholds. The scaffold is ready to support INFRA-002 (Fastify app factory + `/health`).
