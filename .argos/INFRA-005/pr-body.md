# [INFRA-005] Replace migration runner with schema-generator at boot

## Summary

Replaces MikroORM's migration runner (`orm.migrator.up()`) with the schema-generator (`orm.schema.update()`) at app boot. Eliminates the FK-ordering bug that soft-failed PR #24's e2e job (the `organization` table needed to exist before `projects` could reference it via FK, and the migrator didn't guarantee topological order). `src/migrations/` deleted entirely. `Organization` is now created from its entity definition by schema-generator (the `skipTables: ['organization']` workaround documented in CTRF-002's feature-handoff is gone). e2e job's `continue-on-error: true` removed — hard e2e gating restored.

## Acceptance criteria

- [x] App boot uses `orm.schema.updateSchema()` instead of migrator (`src/app.ts:281`).
- [x] `src/migrations/` deleted entirely (4 migration files + 2 `.gitkeep` + 1 snapshot).
- [x] `skipTables: ['organization']` removed from both `mikro-orm.config.pg.ts` and `mikro-orm.config.sqlite.ts`. Better Auth's tables (`user`, `session`, `account`, `verification`, `apikey`) remain in `skipTables` per Better Auth's own plugin lifecycle.
- [x] `Organization` entity created by schema-generator from definition.
- [x] `package.json` scripts: `migrate:create:*` removed; `migrate:pg`/`migrate:sqlite` re-aliased to `schema:update --run` for transition friendliness; new `schema:emit:*` and `schema:update:*` scripts added.
- [x] CI dialect-verification step uses schema-generator. e2e job's `continue-on-error: true` removed and the inline soft-fail comment block removed. Health wait loop tightened: 30×2s → 20×1s (schema-generator is faster than migrations).
- [x] Existing tests pass and grow: 250/250 across 12 files (was 240/240 across 11 files). Coverage above thresholds (89.97% L / 88.88% F / 80.74% B vs 80/80/75 minimums).
- [x] `architecture.md §Database migrations` → `§Database schema management`; `§Migrations in production` → `§Schema sync at boot`; `§Health endpoint` updated; forward-looking v1.0-baseline note added.
- [x] `tasks.md §INFRA-004` acceptance reworded for schema-generator.
- [x] `skills/mikroorm-dual-dialect.md` fully rewritten for the schema-generator pattern.

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | yes (entity-shape sanity) | ✓ | 10 new regression-guard tests in `src/__tests__/unit/schema-generator-guards.test.ts`. Existing scaffold-config assertions updated (3 lines: `migrations` → `schemaGenerator`). |
| Integration | yes (schema-generator on both dialects) | ✓ | 16 tests in `src/__tests__/integration/schema-sqlite.test.ts` (renamed + repurposed from `migrations-sqlite.test.ts`). Verifies all 6 CTRFHub-owned tables created in topological FK order; Better Auth tables correctly excluded; `update()` idempotency on second run. |
| E2E | no (revival is a side effect) | N/A — the previously-soft-failing e2e job in CI is now hard-required and is expected to pass on this PR's CI run. |

Full suite: **250/250 tests pass, zero `tsc --noEmit` errors.**

## Page verification tiers

| Tier | Declared | Result | Notes |
|---|---|---|---|
| T1 Headless | yes (`/health` returns 200 within 15s on fresh DB) | ✓ | Verified via integration tests; bootState transitions `booting → migrating → ready`. |
| T2 ARIA (clean room) | no — no rendered routes | N/A | n/a |
| T2.5 Authenticated State | no — no rendered routes | N/A | n/a |
| T3 Visual | no — no rendered routes | N/A | n/a |

## Decisions that deviate from spec

The spec-enforcer audit returned **PASS** with three NITs (one in-scope, two pre-existing). The following five decisions are documented in `.argos/INFRA-005/feature-handoff.md` and surfaced here for André's independent review:

1. **`bootState 'migrating'` enum value retained for backward compat.** The semantic was renamed to "syncing" (schema-generator runs, not a migration chain) but the enum literal `'migrating'` was kept so any existing external monitoring or test fixtures watching for `bootState === 'migrating'` continue to work. Documented in `src/modules/health/schemas.ts` JSDoc.
2. **`migrate:pg` and `migrate:sqlite` aliases preserved.** Brief said "remove migration scripts." Implementer kept the names as aliases for `schema:update --run` so any cached muscle memory or external tooling still works. Net effect identical to running schema-generator. Acceptable.
3. **`@mikro-orm/migrations` package retained in `node_modules`.** No imports remain (verified by grep), but the package itself wasn't `npm uninstall`'d. Trivial follow-up cleanup; not required for correctness.
4. **CI health wait loop tightened to 20×1s** (was 30×2s in CI-001). Brief recommended this; implementer executed. Schema-generator boot is fast enough that the original 60s window was overkill; 20s catches real boot regressions faster.
5. **NIT #1 fixed in close-out:** stale comment in `src/app.ts:237` ("entities, migrations, skipTables" → "entities, schemaGenerator, skipTables"). Single-line fix; bundled into this PR's close-out commit since it was attributable to INFRA-005's diff.

## Spec-enforcer verdict

**PASS** — see `.argos/INFRA-005/spec-audit.md`
**Date:** 2026-04-25
**Findings:** 0 blocking, 3 NIT (1 in-scope and fixed; 2 pre-existing — see below), 0 coverage gaps, 0 forbidden patterns, 0 planning-doc drift.

**Pre-existing NITs (out of scope here, deferred to follow-up):**

- **NIT #2** — Dead `CREATE TABLE IF NOT EXISTS "organization"` guard in `src/__tests__/integration/ingest.test.ts:108-120`. Shipped by CTRF-002 as a workaround for the now-fixed bug. Now redundant — schema-generator creates `organization` at boot. Trivial follow-up to remove.
- **NIT #3** — Stale "run migrations" inline comment in `.github/workflows/ci.yml:170`. Pre-existing from CI-001. Not in this diff. Trivial comment update in a follow-up.

## Next assignable stories (after this merges)

- **CTRF-003** — Artifact co-upload with ingest (deps CTRF-002 ✅). Now unblocked from the migration architecture standpoint; assignable.
- **CTRF-004** — CI reporter packages (deps CTRF-002 ✅). Assignable.
- **DATA-001** — Data retention nightly job (deps CTRF-002 ✅). Assignable.
- **CI-003** — Tugboat per-PR previews (deps AUTH-001 / CI-001 / CI-002 — all ✅). Always-ready; just needs a brief.
- **AI-001** — already in flight on `story/AI-001` (parallel-safe with this PR; one shared file `src/app.ts` but different sections — adds the `aiProvider` DI seam).
- **AUTH-002 / AUTH-003 / DASH-001 / SET-* / SSE-001 / SRCH-001** — still blocked on G-P0-001 / G-P0-002 (INFRA-003 prerequisites) or G-P0-003 (settings DB schema gap).

---
_Generated from `.argos/INFRA-005/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._
