# Tier 1 Headless Report — INFRA-005

**Executed:** 2026-04-25 18:40
**Method:** `fastify.inject()` / `npm run test` / `npm run schema:emit:sqlite` (no browser)

## Checks

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | Schema-generator creates all 6 CTRFHub tables on fresh SQLite | `orm.schema.update()` via Vitest | 6 tables: organization, projects, test_runs, test_results, test_artifacts, ingest_idempotency_keys | 6 tables created ✓ | ✓ |
| 2 | Better Auth tables (user, session, account, verification, apikey) NOT created by schema-generator | Vitest assertion on sqlite_master | 0 BA tables | 0 BA tables ✓ | ✓ |
| 3 | FK: projects.organization_id → organization | `PRAGMA foreign_key_list('projects')` | FK exists | FK exists ✓ | ✓ |
| 4 | FK: test_runs.project_id → projects | `PRAGMA foreign_key_list('test_runs')` | FK exists | FK exists ✓ | ✓ |
| 5 | FK: test_results.test_run_id → test_runs | `PRAGMA foreign_key_list('test_results')` | FK exists | FK exists ✓ | ✓ |
| 6 | FK: test_artifacts.test_result_id → test_results | `PRAGMA foreign_key_list('test_artifacts')` | FK exists | FK exists ✓ | ✓ |
| 7 | FK: ingest_idempotency_keys.project_id → projects | `PRAGMA foreign_key_list('ingest_idempotency_keys')` | FK exists | FK exists ✓ | ✓ |
| 8 | FK: ingest_idempotency_keys.test_run_id → test_runs | `PRAGMA foreign_key_list('ingest_idempotency_keys')` | FK exists | FK exists ✓ | ✓ |
| 9 | `orm.schema.update()` is idempotent (running twice = no errors) | Vitest: second `update()` call | resolves without throw | resolves ✓ | ✓ |
| 10 | `/health` returns 200 after buildApp() (schema-generator boot completes) | `app.inject({ GET, /health })` | 200 + `{ status: 'ok', bootState: 'ready', dbReady: true }` | 200 ✓ | ✓ |
| 11 | `/health` returns 503 during bootState='migrating' | `setBootState('migrating')` + inject | 503 + `{ status: 'migrating' }` | 503 ✓ | ✓ |
| 12 | `/health` transitions 503→200 across booting→migrating→ready | Sequential setBootState + inject | 503, 503, 200 | 503, 503, 200 ✓ | ✓ |
| 13 | `npm run schema:emit:sqlite` dumps DDL without errors | CLI: `npm run schema:emit:sqlite` | exit 0 + CREATE TABLE statements for all 6 tables | exit 0 + DDL for 6 tables ✓ | ✓ |
| 14 | PG config has `schemaGenerator` (not `migrations`) | Dynamic import of config | `schemaGenerator` key present, `migrations` key absent | ✓ | ✓ |
| 15 | SQLite config has `schemaGenerator` (not `migrations`) | Dynamic import of config | `schemaGenerator` key present, `migrations` key absent | ✓ | ✓ |
| 16 | `organization` is NOT in `skipTables` (PG or SQLite) | Dynamic import of config | not in array | not in array ✓ | ✓ |
| 17 | `app.ts` does NOT import `@mikro-orm/migrations` | Static source scan | no import statement | no import ✓ | ✓ |
| 18 | `app.ts` calls `orm.schema.update()` (not `migrator.up()`) | Static source scan | `schema.update()` present, no executable `migrator.up()` | ✓ | ✓ |
| 19 | `package.json` has `schema:emit:*` and `schema:update:*` scripts | JSON parse | 4 scripts present with correct flags | ✓ | ✓ |
| 20 | `package.json` has no `migrate:create:*` scripts | JSON parse | absent | absent ✓ | ✓ |
| 21 | `src/migrations/` directory does NOT exist | `readFileSync` attempt | ENOENT | ENOENT ✓ | ✓ |
| 22 | Full test suite: 250/250 pass across 12 files | `npm run test` | all pass | 250/250 ✓ | ✓ |
| 23 | `tsc --noEmit` compiles cleanly | `npx tsc --noEmit` | exit 0 | exit 0 ✓ | ✓ |

## Excerpt of raw output

```
$ npm run test
 ✓ src/__tests__/unit/schema-generator-guards.test.ts (10 tests)
 ✓ src/__tests__/integration/schema-sqlite.test.ts (16 tests) 221ms
 ✓ src/__tests__/integration/health.test.ts (25 tests) 460ms
 ...
 Test Files  12 passed (12)
      Tests  250 passed (250)
   Duration  3.17s

$ npm run schema:emit:sqlite
create table `organization` (`id` text not null primary key, ...);
create table `projects` (`id` integer not null primary key autoincrement, ...);
create table `test_runs` (...);
create table `test_results` (...);
create table `test_artifacts` (...);
create table `ingest_idempotency_keys` (...);
```

## Verdict

**PASS** — all 23 T1 checks green. No T2/T2.5/T3 required (INFRA-005 is an infrastructure story with no rendered routes — brief states "Page verification tiers: None").
