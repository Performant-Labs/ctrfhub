# Spec-enforcer Audit — INFRA-005

**Executed:** 2026-04-25 18:55 PDT
**Scope:** diff `main..story/INFRA-005` (4 commits, 25 files changed: +610 −1532)
**Checklists run:** Architecture rules, Coverage, Planning docs conformance, Skills violations (mikroorm-dual-dialect)

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| 1 | `src/app.ts:237` | Internal consistency — comment says "entities, migrations, skipTables" but `migrations` block was removed | Change comment to "entities, schemaGenerator, skipTables" | **NIT** |
| 2 | `src/__tests__/integration/ingest.test.ts:108-120` | Dead-code hygiene — raw-SQL `CREATE TABLE IF NOT EXISTS "organization"` guard is now redundant since schema-generator creates the `organization` table at boot | Remove the `CREATE TABLE IF NOT EXISTS` fallback and the `orgExists` check. The `INSERT` is still needed to seed data. (Note: this file was NOT touched in this diff — pre-existing from CTRF-002.) | **NIT** |
| 3 | `.github/workflows/ci.yml:170` | Internal consistency — inline comment says "run migrations" but the boot path is now schema-generator | Change comment to "run schema sync" or similar. (Note: this line was NOT in the diff — pre-existing from CI-001.) | **NIT** |

No **BLOCKING** findings.

## Coverage gaps

| # | What's missing | Required by | Severity |
|---|---|---|---|
| — | — | — | — |

**Coverage matches the story's declared Test tiers required and Page verification tiers.**

- Unit: 10 new regression-guard tests in `schema-generator-guards.test.ts` ✓
- Integration: 16 tests in `schema-sqlite.test.ts` (renamed + repurposed) ✓
- E2E: No new E2E required per brief ✓
- Full suite: 250/250 pass across 12 files ✓
- `tsc --noEmit`: zero errors ✓
- Coverage: lines 89.97%, functions 88.88%, branches 80.74% — all above thresholds ✓

## Planning-doc conformance (only lines relevant to this story's scope)

- [x] App boot uses `orm.schema.updateSchema()` (not `migrator.up()`) — `src/app.ts:281`
- [x] `src/migrations/` directory deleted entirely — verified via `test -d src/migrations` → `DELETED`
- [x] `organization` removed from `skipTables` in PG config — `src/mikro-orm.config.pg.ts:41`
- [x] `organization` removed from `skipTables` in SQLite config — `src/mikro-orm.config.sqlite.ts:42`
- [x] `migrate:create:pg` and `migrate:create:sqlite` scripts removed from `package.json` ✓
- [x] New `schema:emit:pg`, `schema:emit:sqlite`, `schema:update:pg`, `schema:update:sqlite` scripts added ✓
- [x] CI e2e job `continue-on-error: true` removed — `ci.yml:122-126` (no `continue-on-error` on the e2e job definition) ✓
- [x] CI e2e job soft-fail comment block removed ✓
- [x] CI health wait loop tightened: 30×2s → 20×1s — `ci.yml:174` ✓
- [x] `architecture.md §Database migrations` → `§Database schema management` ✓
- [x] `architecture.md §Migrations in production` → `§Schema sync at boot` ✓
- [x] `architecture.md §Health endpoint` updated for schema-generator context ✓
- [x] `architecture.md` forward-looking note about v1.0 baseline migration ✓
- [x] `tasks.md §INFRA-004` acceptance reworded for schema-generator ✓
- [x] `tasks.md §INFRA-005` story entry added with acceptance criteria ✓
- [x] `skills/mikroorm-dual-dialect.md` fully rewritten for schema-generator pattern ✓
- [x] `bootState 'migrating'` enum value retained for backward compat — documented in `health/schemas.ts` JSDoc ✓
- [x] `/health` returns 503 during `bootState='migrating'` and 200 when `ready` — verified by integration tests ✓
- [x] `schema.update()` idempotency verified — integration test runs `update()` twice without error ✓
- [x] Existing 250 tests still pass ✓

## Forbidden-pattern scan (from CLAUDE.md)

- [x] No `hx-target`/`hx-swap` inherited from a parent — not applicable to this diff (no templates changed)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — not applicable
- [x] No `hx-disable` anywhere in templates — confirmed via grep (zero results)
- [x] No Alpine `x-data` inside an HTMX swap target — not applicable
- [x] No Postgres-only SQL / dialect-specific features without a SQLite equivalent — confirmed via grep on entity files (zero `p.array`, `p.jsonb`, `p.uuid` results)
- [x] No DB mocked in integration tests — all integration tests use real SQLite `:memory:`
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — not applicable (no visual tiers)
- [x] No layout-token change without a T2 backdrop-contrast re-check — not applicable (no CSS changes)
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — not applicable
- [x] No Zod schema defined ad-hoc in a handler — no new handlers in this diff
- [x] No `migrator.up()`, `migrator.down()`, or `MigrationRunner` reference on the boot path — `src/app.ts` confirmed: only reference is in an INFRA-005 comment (line 278)
- [x] No `@mikro-orm/migrations` import in `src/app.ts` — confirmed via grep (only test file references the pattern as a negative assertion)
- [x] No new migration files — `src/migrations/` directory fully deleted
- [x] No `fastify.orm.em` used directly in a request handler — all references are in JSDoc/comments warning against it
- [x] No real AI API calls in test files — confirmed via grep (zero `openai`/`anthropic`/`groq` imports)
- [x] All integration test suites call `afterAll(() => app.close())` — confirmed across all 4 integration test files

## Anti-pattern scan (from brief §Anti-patterns)

- [x] No `migrator.up()`, `migrator.down()`, or `MigrationRunner` on boot path ✓
- [x] Better Auth tables not migrated via MikroORM — `skipTables` correctly excludes `user`, `session`, `account`, `verification`, `apikey`; Better Auth runs its own `runMigrations()` ✓
- [x] No CTRFHub entity skipped from schema-generator — `organization` removed from `skipTables` ✓
- [x] No hardcoded table names outside entity definitions — all table names come from entity `tableName` property ✓
- [x] No new migration files added ✓
- [x] `gaps.md` G-P1-006/007/008 untouched ✓
- [x] No Dockerfile changes ✓

## Verdict

**PASS** — story may proceed to Argos Phase 7 close-out and PR open.

Three NITs noted (stale comment in `app.ts:237`, dead organization-CREATE guard in `ingest.test.ts`, stale migration comment in `ci.yml:170`) — all pre-existing or cosmetic; none block the story. They can be swept in a future cleanup commit.
