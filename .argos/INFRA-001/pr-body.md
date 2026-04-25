# [INFRA-001] Project scaffold and toolchain

## Summary

First story in the dependency chain — lays the project's foundation. No application code, just the toolchain everything else stands on: TypeScript strict, Vitest with the 80/80/75 coverage gate, Playwright two-viewport matrix, three MikroORM dialect configs, ESLint, an empty `htmx-events.ts` constants module, and all 14 required `package.json` scripts. After this lands, INFRA-002 and INFRA-004 unblock immediately; INFRA-003 unblocks once G-P0-001/002 are signed off.

## Acceptance criteria

(verbatim from `docs/planning/tasks.md` §INFRA-001)

- [x] `npm install` succeeds (424 packages, 0 vulnerabilities)
- [x] `tsc --noEmit` passes on the empty `src/`
- [x] ESLint config in place; `npx eslint src/ --ext .ts` clean
- [x] `package.json` has all required scripts: `dev`, `build`, `test`, `test:unit`, `test:int`, `test:e2e`, `test:coverage`, `migrate:pg`, `migrate:sqlite`, `migrate:create:pg`, `migrate:create:sqlite`, `css:dev`, `css:build` (plus bonus: `lint`, `typecheck`, `test:watch`)
- [x] `vitest.config.ts` with coverage thresholds **80% lines / 80% functions / 75% branches**, v8 provider
- [x] `e2e/playwright.config.ts` with two-viewport matrix `[1280×800, 375×800]` and `playwright-ctrf-json-reporter` wired
- [x] Three MikroORM config files: `mikro-orm.config.ts` (runtime dialect selector), `mikro-orm.config.pg.ts`, `mikro-orm.config.sqlite.ts`
- [x] `src/client/htmx-events.ts` bootstrapped as empty module (`export {}` with TODO comment)

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | yes | ✓ | 7 tests in `src/__tests__/unit/scaffold.test.ts` — Vitest globals, node env, PG & SQLite config imports, `resolveOrmConfig` both branches, htmx-events import |
| Integration | no | N/A | No routes exist yet; INFRA-002 will add `buildApp()` + `/health` |
| E2E | no | N/A | No running app to test yet |

## Page verification tiers

| Tier | Declared | Result | Report location |
|---|---|---|---|
| T1 Headless | yes | ✓ (11/11 checks) | `.argos/INFRA-001/tier-1-report.md` |
| T2 ARIA (clean room) | no — no rendered routes | N/A | — |
| T2.5 Authenticated State | no — no rendered routes | N/A | — |
| T3 Visual | no — non-UI story | N/A | — |

## Decisions that deviate from spec

Six decisions documented in `.argos/INFRA-001/feature-handoff.md`. Spec-enforcer evaluated each and flagged none as risks; surfaced here for independent review.

- **Zod v4 instead of v3.** `@fastify/type-provider-zod@1.0.0` requires `zod@>=4.2.0` as peer dep. Zod v4 API is backwards-compatible for the patterns in `skills/zod-schema-first.md`. (Adjoins `architecture.md §Backend (Zod row)`)
- **`@fastify/swagger` + `openapi-types` added as deps.** Required as peer deps of `@fastify/type-provider-zod@1.0.0`. (Adjoins `architecture.md §Backend`)
- **`playwright-ctrf-json-reporter` (unscoped) instead of `@ctrf-io/playwright-ctrf-json-reporter`.** Scoped name returns 404 on npm; the actual published package is unscoped. (Adjoins `testing-strategy.md §dog-food rule`)
- **`@fastify/static@^9`, `@fastify/view@^11`.** Versions chosen to match current npm latest; speculative older pins failed install. (Adjoins `architecture.md §Backend`)
- **ESLint v8 (with deprecation warning) used.** `@typescript-eslint/parser@8.x` still supports v8. Flat-config migration to v9+ tracked as a follow-up. (Adjoins `tasks.md §INFRA-001`)
- **Node.js v25.9.0 local runtime; code targets Node 22 LTS.** `engines` field pins ≥ 22. CI will run on Node 22 (CI-001 will own the workflow). (Adjoins `architecture.md §Runtime`)

## Gaps filed during this story

None.

## Spec-enforcer verdict

**PASS** — see `.argos/INFRA-001/spec-audit.md`.
**Date:** 2026-04-24

Coverage from `npm run test:coverage`: lines **96.77%** · functions **100%** · branches **100%** (thresholds 80/80/75 — comfortable margin).

## Next assignable stories (after this merges)

Per the dependency chain in `docs/planning/project-architecture.md` §3:

- **INFRA-002** — Base Fastify app factory (depends on INFRA-001 only) — **unblocked**
- **INFRA-004** — Core database entities and first migration (depends on INFRA-001 only) — **unblocked**
- **INFRA-003** — Base Tailwind CSS entry and layout template (depends on INFRA-001 + G-P0-001 + G-P0-002 sign-off) — still gated on the two P0 gaps

INFRA-002 and INFRA-004 can run in parallel.

## Note on first-run friction

This is the first story exercising the multi-session relay end-to-end. The Feature-implementer flagged two non-blocking follow-ups worth tracking:

- ESLint v8 deprecation warning (consider migrating to v9 flat-config in a follow-up story)
- `fsevents` optional-dependency build failures on macOS (chokidar falls back to polling — non-blocking)

Neither is a gap in the spec; both are real-world friction surfaces. If patterns emerge across stories we'll capture them in `docs/planning/gaps.md` per the architecture's escalation rules.
