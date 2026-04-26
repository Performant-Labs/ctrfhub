# INFRA-005 Feature Handoff

**Story:** Replace migration runner with schema-generator at boot
**Branch:** `story/INFRA-005`
**Feature-implementer:** Daedalus (AntiGravity, bare-metal Mac)
**Date:** 2026-04-25

---

## Summary

Replaced MikroORM's migration runner (`orm.migrator.up()`) with the schema-generator (`orm.schema.update()`) at app boot. This eliminates the FK ordering bug that caused the e2e job to soft-fail (the `organization` table must exist before `projects` can reference it via FK, and the migrator didn't guarantee topological order).

### Changes Made

#### Boot path (`src/app.ts`)
- `orm.migrator.up()` → `orm.schema.update()`
- Removed migration snapshot config from test path
- Updated bootState comments (migrating → syncing semantically, but kept `'migrating'` enum value for backward compat)

#### MikroORM configs
- **`mikro-orm.config.pg.ts`**: Removed `migrations: {}` block; removed `'organization'` from `skipTables`
- **`mikro-orm.config.sqlite.ts`**: Same changes
- **`mikro-orm.config.ts`**: Updated JSDoc only

#### Deleted `src/migrations/`
- 4 migration files (2 PG, 2 SQLite) + 2 `.gitkeep` + 1 snapshot deleted

#### `package.json` scripts
- `migrate:pg` and `migrate:sqlite` now alias `schema:update --run`
- New: `schema:emit:pg`, `schema:emit:sqlite`, `schema:update:pg`, `schema:update:sqlite`
- Removed: `migrate:create:pg`, `migrate:create:sqlite`

#### CI (`.github/workflows/ci.yml`)
- Removed `continue-on-error: true` from e2e job (revives hard gating)
- Tightened health wait loop: 30×2s → 20×1s (schema-generator is faster)

#### Tests
- `migrations-sqlite.test.ts` → `schema-sqlite.test.ts` (16 tests, all pass)
- `scaffold.test.ts` assertions: `migrations` → `schemaGenerator` (3 assertions fixed)

#### Entity update
- `Organization.ts` JSDoc updated: now "CTRFHub-owned" (not "Better Auth managed")

#### Spec docs updated
- `architecture.md`: §Database migrations → §Database schema management; §Migrations in production → §Schema sync at boot; §Health endpoint updated
- `tasks.md`: §INFRA-004 acceptance reworded
- `skills/mikroorm-dual-dialect.md`: Full rewrite for schema-generator pattern

---

## Verification Results

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ Zero errors |
| `npm run test` | ✅ 240/240 tests pass (11 files) |
| Schema-generator test (16 assertions) | ✅ All pass — 6 CTRFHub-owned tables created, BA tables excluded |
| Idempotency | ✅ `orm.schema.update()` runs twice without error |

---

## Notes for Test-Writer

1. The renamed test file (`schema-sqlite.test.ts`) is already comprehensive with 16 tests. Additional tier verification may include:
   - T1: Confirm `npm run schema:emit:sqlite` CLI works (dumps DDL without errors)
   - T1: Confirm `/health` endpoint transitions `booting → migrating → ready` within 15s

2. The `@mikro-orm/migrations` package is still in `node_modules` but no longer imported anywhere. It can be removed in a future cleanup story.

3. The `'migrating'` bootState value is intentionally kept for backward compatibility — any external monitoring that watches for `"migrating"` continues to work.

---

## Files Modified

- `src/app.ts`
- `src/mikro-orm.config.ts`
- `src/mikro-orm.config.pg.ts`
- `src/mikro-orm.config.sqlite.ts`
- `src/modules/health/schemas.ts`
- `src/entities/Organization.ts`
- `package.json`
- `.github/workflows/ci.yml`
- `docs/planning/architecture.md`
- `docs/planning/tasks.md`
- `skills/mikroorm-dual-dialect.md`
- `src/__tests__/unit/scaffold.test.ts`
- `src/__tests__/integration/schema-sqlite.test.ts` (renamed from `migrations-sqlite.test.ts`)

## Files Deleted

- `src/migrations/` (entire directory)
