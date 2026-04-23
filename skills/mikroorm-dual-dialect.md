---
name: mikroorm-dual-dialect
description: How to write MikroORM entities and migrations that work on both PostgreSQL (production) and SQLite (single-node / test), and which features are off-limits in entity files.
trigger: writing any MikroORM entity, migration, or service-layer query; setting up database config
source: docs/planning/architecture.md §Backend (MikroORM row); ~/Sites/ai_guidance/frameworks/mikro-orm/conventions.md §Core Principles, §Portable Types, §Config: Dialect Switching via Env
---

## Rule

Entity definitions are written once using only portable `p.*` types; the dialect (Postgres vs SQLite) is selected at runtime by `DATABASE_URL`; Postgres-only SQL features (arrays, JSONB operators, partial indexes, FTS) are isolated behind a `SearchProvider` interface or a raw query helper, never in entity files.

## Why

CTRFHub ships both a PostgreSQL deployment (production) and a SQLite deployment (single-node self-hosting and integration tests). MikroORM v7 supports both dialects from a single codebase if entity files use only portable column types. Keeping dialect-specific SQL out of entities means the same TypeScript source compiles and tests against either backend.

Reference: `architecture.md §Backend` specifies "MikroORM (single entity definitions, dialect switched via env var)"; `mikro-orm/conventions.md §Portable Types` lists the exact type constraints.

## How to apply

1. **Use only portable column types in entity files:**
   - ✅ `p.integer()`, `p.string()`, `p.text()`, `p.boolean()`, `p.datetime()`, `p.json()`, `p.float()`, `p.decimal()`
   - ❌ `p.bigint()` (mapped to string — avoid unless necessary), `p.array()` (no SQLite), `p.jsonb()` (use `p.json()` instead), `p.uuid()` as PK (slower on SQLite — use auto-increment `p.integer()`), custom `p.enum()` with DB-level CHECK constraints

2. **Two config files, one shared entity list:**
   - `src/mikro-orm.config.ts` — runtime selector (reads `DATABASE_URL`)
   - `src/mikro-orm.config.pg.ts` — PostgreSQL config, migrations in `src/migrations/pg/`
   - `src/mikro-orm.config.sqlite.ts` — SQLite config, migrations in `src/migrations/sqlite/`

3. **Generate migrations against both dialects** after every entity change:
   ```
   npm run migrate:create:pg
   npm run migrate:create:sqlite
   ```

4. **Isolate dialect-sensitive search behind a `SearchProvider` interface.** Architecture specifies Postgres FTS (`tsvector` + GIN index) and SQLite FTS5 as separate implementations selected at boot. Do not write `websearch_to_tsquery()` or `MATCH` directly in an entity or shared service.

5. **JSONB merge:** Postgres uses an atomic `UPDATE orgs SET settings = settings || $1 WHERE id = $2` raw query; SQLite uses read-modify-write in the application layer. Gate on dialect or use the helper in `src/lib/db/json-merge.ts`.

6. **Integration tests always use SQLite in-memory.** Pass `db: ':memory:'` to `buildApp()` — migrations run automatically. Never import a PG-specific query helper in a file that integration tests execute.

## Good example

```typescript
// src/entities/TestRun.ts — portable entity, works on both dialects
import { defineEntity, p } from '@mikro-orm/core';

const TestRunSchema = defineEntity({
  name: 'TestRun',
  tableName: 'test_runs',
  properties: {
    id:          p.integer().primary(),          // ✅ portable
    projectId:   p.integer(),
    tool:        p.string(100),
    environment: p.string(100).nullable(),
    passed:      p.integer().default(0),
    failed:      p.integer().default(0),
    total:       p.integer().default(0),
    aiSummary:   p.text().nullable(),            // ✅ text, not varchar limit
    aiRootCauses: p.json().nullable(),           // ✅ p.json(), not p.jsonb()
    createdAt:   p.datetime().defaultRaw('now()'),
  },
});

export class TestRun extends TestRunSchema.class {
  get passRate(): number {
    return this.total > 0 ? this.passed / this.total : 0;
  }
}
TestRunSchema.setClass(TestRun);
```

## Bad example

```typescript
// ❌ Postgres-only types in entity file — SQLite migrations will fail
const BadSchema = defineEntity({
  properties: {
    tags:     p.array(),   // no SQLite support
    meta:     p.jsonb(),   // p.json() required for portability
    searchVec: p.text(),   // if you're storing a tsvector directly — don't; use a migration-only computed column
  },
});
```

Why it's wrong: the SQLite migration step will fail or silently create an incompatible schema, breaking single-node self-hosted deployments and all integration tests.
