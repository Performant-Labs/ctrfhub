# Vitest Conventions

> Sources: [Vitest Docs](https://vitest.dev/), [Fastify Testing Guide](https://fastify.dev/docs/latest/Guides/Testing/)

Used for unit and integration tests in Node.js/TypeScript projects. Playwright is used for E2E (see `../frameworks/` for Playwright patterns if documented separately).

---

## Core Principles

- **Unit tests have zero I/O** — no DB, no HTTP, no filesystem, no external processes.
- **Integration tests use `fastify.inject()`** — no real HTTP server, no real ports.
- **SQLite in-memory for integration DB** — fast, isolated, migrations applied automatically.
- **Interfaces = free test doubles** — design services behind interfaces; swap in mock implementations via constructor/factory injection. No mocking library needed.
- **Fixtures over factories** — prefer simple exported fixture objects over complex builder patterns.

---

## Project Structure

```
src/
└── __tests__/
    ├── unit/                    # Pure function tests — no I/O
    │   ├── storage-key.test.ts
    │   └── ...
    ├── integration/             # Fastify route tests — SQLite in-memory
    │   ├── ingest.test.ts
    │   └── ...
    └── fixtures/                # Shared test data
        ├── ctrf.ts              # Valid CTRF report objects
        ├── users.ts             # User fixture objects
        └── projects.ts          # Project fixture objects
```

---

## vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    testTimeout: 15_000,   // Integration tests can be slow
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/migrations/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
});
```

```json
// package.json
{
  "scripts": {
    "test":          "vitest run",
    "test:unit":     "vitest run src/__tests__/unit",
    "test:int":      "vitest run src/__tests__/integration",
    "test:watch":    "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

---

## Unit Test Pattern

No setup required. Import the pure function, assert.

```typescript
// src/__tests__/unit/storage-key.test.ts
import { describe, it, expect } from 'vitest';
import { buildStorageKey } from '../../lib/artifact-storage/storage-key';

describe('buildStorageKey', () => {
  it('builds the full hierarchical path', () => {
    expect(buildStorageKey(1, 7, 99, 450, 'screenshot.png'))
      .toBe('orgs/1/projects/7/runs/99/results/450/screenshot.png');
  });

  it('rejects path traversal attempts', () => {
    expect(() => buildStorageKey(1, 7, 99, 450, '../etc/passwd'))
      .toThrow('Invalid filename');
  });
});
```

---

## Integration Test Pattern

### App factory with test overrides

The `buildApp()` factory must accept test configuration so integrations tests can inject a SQLite DB and mock services:

```typescript
// src/app.ts
export interface AppOptions {
  testing?: boolean;                  // enables test auth hook
  db?: string;                        // ':memory:' for SQLite in-memory
  artifactStorage?: ArtifactStorage;  // inject test double
  eventBus?: EventBus;                // inject test double
}

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: !opts.testing })
    .withTypeProvider<ZodTypeProvider>();
  // ...
  if (opts.testing) {
    // Replace Better Auth session check with fixture user injection
    app.addHook('onRequest', async (request) => {
      (request as any).user = opts.testUser ?? defaultTestUser;
    });
  }
  return app;
}
```

### Test file structure

```typescript
// src/__tests__/integration/ingest.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../app';
import { MemoryArtifactStorage } from '../../lib/artifact-storage/memory';
import { MemoryEventBus } from '../../lib/event-bus/memory';
import { validCtrfReport } from '../fixtures/ctrf';

describe('POST /api/v1/projects/:slug/runs', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let storage: MemoryArtifactStorage;

  beforeAll(async () => {
    storage = new MemoryArtifactStorage();
    app = await buildApp({
      testing: true,
      db: ':memory:',
      artifactStorage: storage,
      eventBus: new MemoryEventBus(),
    });
  });

  afterAll(() => app.close());

  it('returns 201 with runId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/demo/runs',
      headers: { 'x-api-token': 'token-001' },
      payload: validCtrfReport,
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toHaveProperty('runId');
  });
});
```

### Testing HTMX routes

```typescript
it('returns HTML partial for HTMX requests', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/projects/demo/runs',
    headers: { 'HX-Request': 'true', Cookie: testSession },
  });
  expect(res.headers['content-type']).toContain('text/html');
  expect(res.body).toContain('class="run-card"');
  expect(res.body).not.toContain('<html'); // partial only
});

it('returns full layout for direct navigation', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/projects/demo/runs',
    headers: { Cookie: testSession },
  });
  expect(res.body).toContain('<html');
});
```

### Interface-based test doubles (no mocking library)

```typescript
// src/lib/artifact-storage/memory.ts  — test double
export class MemoryArtifactStorage implements ArtifactStorage {
  private files = new Map<string, Buffer>();

  async store(key: string, buffer: Buffer): Promise<void> {
    this.files.set(key, buffer);
  }

  async getUrl(key: string): Promise<string> {
    return `http://localhost/test-files/${key}`;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  async deletePrefix(prefix: string): Promise<void> {
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) this.files.delete(key);
    }
  }

  // Test helper methods
  keys(): string[] { return [...this.files.keys()]; }
  storedCount(): number { return this.files.size; }
  has(key: string): boolean { return this.files.has(key); }
}
```

---

## SQLite In-Memory for Integration Tests

Requires dual-dialect MikroORM config (see `mikro-orm/conventions.md`). Pass `db: ':memory:'` to `buildApp()` — migrations run automatically on startup.

```typescript
// src/mikro-orm.config.sqlite.ts
export default defineConfig({
  dbName: process.env.SQLITE_PATH ?? './data/ctrfhub.db', // ':memory:' in tests
  migrations: { pathTs: './src/migrations/sqlite' },
});
```

Each integration test suite gets a completely fresh database — no test data leaks between suites.

---

## Coverage as a Floor, Not a Goal

A high coverage percentage with no tests for the critical ingest endpoint is worse than lower coverage with comprehensive ingest tests. Coverage thresholds prevent obvious gaps; code review catches strategic gaps.

---

## Common Gotchas

| Symptom | Cause | Fix |
|---|---|---|
| Integration test hangs | `app.close()` not called in `afterAll` | Always call `app.close()` |
| SQLite migration fails | Migration uses Postgres-only SQL | Check migration for `pg_*` functions, UUID generation, etc. |
| `inject()` body is empty | Forgot `payload` or wrong content-type | Set `payload` + `headers: { 'content-type': 'application/json' }` |
| Test double not used | Service creates its own instance internally | Pass instance via `buildApp()` options; don't instantiate inside the app |
| Tests interfere with each other | Shared mutable state in test double | Create fresh test double instance per `describe` block |
| ESM import error in test | Vitest and project both need `"type": "module"` | Check `package.json` and `vitest.config.ts` |
