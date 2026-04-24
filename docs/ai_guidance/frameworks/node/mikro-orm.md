# MikroORM v7 Conventions

> Sources: [MikroORM v7 Docs](https://mikro-orm.io/docs/), [defineEntity Guide](https://mikro-orm.io/docs/defining-entities), [Migrations Guide](https://mikro-orm.io/docs/migrations)

---

## Core Principles

- **Single entity definition** — one file, works on both PostgreSQL and SQLite. Dialect is set by config/env only.
- **`defineEntity` + class pattern** — the v7-recommended approach. No decorators.
- **Stick to portable types** — avoid Postgres-only features in entity files.
- **Migrations per dialect** — separate migration folders for PG and SQLite.
- **Request-scoped `EntityManager` fork** — never share an `em` across requests.

---

## Entity Definition Pattern

Always use `defineEntity` + a class extension. This gives clean TypeScript hover types, domain methods, and performance.

```typescript
// src/entities/TestRun.ts
import { defineEntity, p } from '@mikro-orm/core';

const TestRunSchema = defineEntity({
  name: 'TestRun',
  tableName: 'test_runs',
  properties: {
    id:          p.integer().primary(),
    projectId:   p.integer(),           // FK — reference by ID, not relation for portability
    tool:        p.string(100),
    environment: p.string(100).nullable(),
    passed:      p.integer().default(0),
    failed:      p.integer().default(0),
    skipped:     p.integer().default(0),
    total:       p.integer().default(0),
    durationMs:  p.integer().nullable(),
    createdAt:   p.datetime().defaultRaw('now()'),
  },
});

export class TestRun extends TestRunSchema.class {
  get passRate(): number {
    return this.total > 0 ? this.passed / this.total : 0;
  }
}

TestRunSchema.setClass(TestRun);
export type TestRunType = InstanceType<typeof TestRun>;
```

---

## Portable Types — What to Use and Avoid

| ✅ Use (portable) | ❌ Avoid (Postgres-only) |
|---|---|
| `p.integer()` | `p.bigint()` (mapped to string in JS — use carefully) |
| `p.string()` | `p.array()` — no SQLite support |
| `p.text()` | `p.jsonb()` — use `p.json()` instead |
| `p.boolean()` | Custom `p.enum()` — SQLite stores as string anyway |
| `p.datetime()` | `p.uuid()` as PK — SQLite stores as text, fine for reads but slower |
| `p.json()` | Partial indexes, materialized views (migration-only) |
| `p.float()` | |
| `p.decimal()` | |

> **Rule**: If you need JSONB operators (`@>`, `?`) or array functions, move that logic into a raw query helper and gate it behind a dialect check. Don't put it in the entity.

---

## Config: Dialect Switching via Env

Two config files, one shared entity list. The `DATABASE_URL` env var determines which is loaded.

```typescript
// src/mikro-orm.config.ts  (runtime selector)
import type { Options } from '@mikro-orm/core';

const isPg = process.env.DATABASE_URL?.startsWith('postgres');

export default (isPg
  ? await import('./mikro-orm.config.pg')
  : await import('./mikro-orm.config.sqlite')
).default as Options;
```

```typescript
// src/mikro-orm.config.pg.ts
import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import * as entities from './entities';

export default defineConfig({
  clientUrl: process.env.DATABASE_URL,
  entities: Object.values(entities),
  extensions: [Migrator],
  migrations: {
    path:   './dist/migrations/pg',
    pathTs: './src/migrations/pg',
  },
});
```

```typescript
// src/mikro-orm.config.sqlite.ts
import { defineConfig } from '@mikro-orm/sqlite';
import { Migrator } from '@mikro-orm/migrations';
import * as entities from './entities';

export default defineConfig({
  dbName: process.env.SQLITE_PATH ?? './data/ctrfhub.db',
  entities: Object.values(entities),
  extensions: [Migrator],
  migrations: {
    path:   './dist/migrations/sqlite',
    pathTs: './src/migrations/sqlite',
  },
});
```

**Migration folder layout:**
```
src/
└── migrations/
    ├── pg/
    │   ├── Migration20260422001_init.ts
    │   └── Migration20260422002_add_retention.ts
    └── sqlite/
        ├── Migration20260422001_init.ts
        └── Migration20260422002_add_retention.ts
```

**package.json scripts:**
```json
{
  "scripts": {
    "migrate:pg":     "mikro-orm migration:up --config src/mikro-orm.config.pg.ts",
    "migrate:sqlite": "mikro-orm migration:up --config src/mikro-orm.config.sqlite.ts",
    "migrate:create:pg":     "mikro-orm migration:create --config src/mikro-orm.config.pg.ts",
    "migrate:create:sqlite": "mikro-orm migration:create --config src/mikro-orm.config.sqlite.ts"
  }
}
```

---

## Migration Rules

- Always generate migrations with `migration:create` — never write them by hand unless adding raw SQL.
- Use `this.execute()` or raw SQL inside migrations, **not** `EntityManager`. Entity definitions change over time and break historical migrations.
- Keep both PG and SQLite migration files in sync — run `migrate:create` against both after any entity change.
- Migrations are transactional by default. One failed statement rolls back the whole migration.

```typescript
// src/migrations/pg/Migration20260422001_init.ts
import { Migration } from '@mikro-orm/migrations';

export class Migration20260422001_init extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE test_runs (
        id          SERIAL PRIMARY KEY,
        project_id  INT NOT NULL,
        tool        VARCHAR(100) NOT NULL,
        passed      INT NOT NULL DEFAULT 0,
        failed      INT NOT NULL DEFAULT 0,
        total       INT NOT NULL DEFAULT 0,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE test_runs');
  }
}
```

---

## Fastify Integration — Request-Scoped `EntityManager`

Register MikroORM as a global Fastify plugin (see `fastify.md`). Fork `em` per request, never share it.

```typescript
// Always fork — never use orm.em directly in a request context
fastify.addHook('onRequest', async (request) => {
  request.em = fastify.orm.em.fork();
});
```

```typescript
// ✅ Correct — use request.em inside handlers
async handler(request, reply) {
  const runs = await request.em.find(TestRun, { failed: { $gt: 0 } });
}

// ❌ Wrong — sharing orm.em across concurrent requests causes state corruption
async handler(request, reply) {
  const runs = await fastify.orm.em.find(TestRun, {});
}
```

---

## Seeding

Use a dedicated seed script, not migrations.

```typescript
// src/seed.ts
import { MikroORM } from '@mikro-orm/core';
import config from './mikro-orm.config';
import { Project } from './entities/Project';

const orm = await MikroORM.init(config);
const em = orm.em.fork();

em.create(Project, { name: 'Demo Project', slug: 'demo' });
await em.flush();
await orm.close();
console.log('Seeded.');
```

Run with: `npx tsx src/seed.ts`

---

## Common Gotchas

| Symptom | Cause | Fix |
|---|---|---|
| "Entity not found" error | Entity not in `entities` array in config | Export from `src/entities/index.ts` barrel |
| SQLite migration fails on column drop | SQLite doesn't support `ALTER TABLE DROP COLUMN` before v3.35 | Use `recreate table` pattern in migration |
| Shared `em` state between requests | Using `orm.em` directly instead of forking | Always use `request.em` (forked per request) |
| ESM import errors | MikroORM v7 is native ESM | Set `"type": "module"` in `package.json` |
| `migration:create` generates empty file | No entity change detected since last snapshot | Check `migrations/.snapshot-*.json` is committed |
| Datetime mismatch PG vs SQLite | PG returns `Date`, SQLite returns string | Always use `p.datetime()` and let MikroORM hydrate |
