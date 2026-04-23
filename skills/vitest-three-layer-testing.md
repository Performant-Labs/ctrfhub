---
name: vitest-three-layer-testing
description: The three-layer testing pyramid (unit → integration → E2E) with Vitest and Playwright, the buildApp() test factory, MemoryArtifactStorage and MockAiProvider test doubles, the dog-food E2E rule, and coverage as a floor.
trigger: writing any test file; choosing a test layer for a new behaviour; setting up a new integration test suite; writing a mock/double
source: docs/planning/testing-strategy.md §all; ~/Sites/ai_guidance/frameworks/vitest/conventions.md §all
---

## Related

This skill covers the **three Vitest layers** (unit / integration / E2E) — i.e. *where the code runs*. For the orthogonal **three page-verification tiers** (T1 Headless / T2 ARIA / T3 Visual) — i.e. *what fidelity a rendered page is verified at* — see `page-verification-hierarchy.md`. A single E2E test typically exercises T1 → T2 → T3 against the same route.

## Rule

Unit tests are zero-I/O pure function tests (Vitest, < 200 ms total); integration tests use `fastify.inject()` with SQLite in-memory and interface-based test doubles (Vitest, < 30 s total); E2E tests use Playwright against a running app and generate a CTRF report that is ingested back into CTRFHub (dog-food rule); coverage thresholds are a floor not a goal.

## Three-Layer Pyramid

### Layer 1 — Unit Tests
- **Scope:** Pure functions only. Zero DB, zero HTTP, zero filesystem, zero external processes.
- **Location:** `src/__tests__/unit/*.test.ts`
- **Framework:** Vitest, `globals: true`, `environment: 'node'`
- **Run time target:** < 200 ms total for all unit tests combined.

**What belongs here:**
- Zod schema parsing (valid and invalid inputs)
- Pure utility functions: `buildStorageKey`, `formatDuration`, `detectArtifactType`, `effectiveRetentionDays`, `TestRun.passRate`, `formatRunId`, `diskBarLevel`, `getEffectiveCategory`, `getCategorySource`, `splitIntoBatches`
- **What does NOT belong:** anything that touches the DB, an HTTP endpoint, the filesystem, or an external service.

### Layer 2 — Integration Tests
- **Scope:** Fastify routes end-to-end including middleware, auth, DB, and service logic.
- **Location:** `src/__tests__/integration/*.test.ts`
- **Framework:** Vitest + `fastify.inject()` (no real HTTP server, no real ports).
- **DB:** SQLite in-memory — pass `db: ':memory:'` to `buildApp()`.
- **Run time target:** < 30 s total for all integration tests combined.

**The `buildApp()` test factory:**
```typescript
// Every integration test suite calls buildApp() in beforeAll
const app = await buildApp({
  testing: true,          // replaces Better Auth with a fixture user injector
  db: ':memory:',         // fresh SQLite database, migrations applied automatically
  artifactStorage: new MemoryArtifactStorage(),
  eventBus: new MemoryEventBus(),
  aiProvider: new MockAiProvider(),  // omit to disable AI pipeline entirely
});
afterAll(() => app.close());
```

**Interface-based test doubles (no mocking library):**
- `MemoryArtifactStorage` — in-memory map; exposes `.keys()`, `.storedCount()`, `.has(key)` for assertions.
- `MemoryEventBus` — processes events synchronously in tests (no async timing issues).
- `MockAiProvider` — records calls in `calls[]`; returns deterministic canned categories.

**What belongs here:**
- Every Fastify route's happy path, error cases, 401, 422, 413, 429 responses.
- HTMX-specific behaviour: `HX-Request: true` returns a partial; direct navigation returns full layout.
- AI pipeline chain: categorize → correlate → summarize in order.

**What does NOT belong:** Real API calls to AI providers, real PostgreSQL, real S3.

### Layer 3 — E2E Tests (Playwright)
- **Scope:** Every major user workflow (happy path) against a running app.
- **Location:** `e2e/tests/*.spec.ts`
- **Framework:** Playwright.
- **Dog-food rule:** E2E tests generate CTRF reports via `playwright-ctrf-json-reporter` and ingest those reports into a running CTRFHub staging instance. The product validates itself.
- **Config:** `e2e/playwright.config.ts` must include the `@ctrf-io/playwright-ctrf-json-reporter` reporter.

### Coverage Targets

| Layer | Target | Measured by |
|---|---|---|
| Unit | 90% lines / 90% functions | `npm run test:coverage` |
| Integration | Every route + every named error case | Manual audit against route list |
| E2E | Every major user workflow (happy path) | Playwright test list review |

**Coverage is a floor, not a goal.** An 80% coverage score with no integration test for the ingest endpoint is worse than 60% coverage with full ingest coverage.

## Good example

```typescript
// src/__tests__/unit/storage-key.test.ts — pure function, zero I/O
import { describe, it, expect } from 'vitest';
import { buildStorageKey } from '../../lib/artifact-storage/storage-key';

describe('buildStorageKey', () => {
  it('builds full hierarchical path', () =>
    expect(buildStorageKey(1, 7, 99, 450, 'screenshot.png'))
      .toBe('orgs/1/projects/7/runs/99/results/450/screenshot.png'));
  it('rejects path traversal', () =>
    expect(() => buildStorageKey(1, 7, 99, 450, '../etc/passwd')).toThrow('Invalid filename'));
});
```

```typescript
// src/__tests__/integration/ingest.test.ts — route test, inject + SQLite
describe('POST /api/v1/projects/:slug/runs', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let storage: MemoryArtifactStorage;

  beforeAll(async () => {
    storage = new MemoryArtifactStorage();
    app = await buildApp({ testing: true, db: ':memory:', artifactStorage: storage, eventBus: new MemoryEventBus() });
  });
  afterAll(() => app.close());

  it('returns 201 with runId for valid CTRF', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/projects/demo/runs',
      headers: { 'x-api-token': 'token-001' },
      payload: validCtrfReport,
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toHaveProperty('runId');
  });
});
```

## Bad example

```typescript
// ❌ Integration test that makes a real AI API call
it('categorizes failures', async () => {
  // This will hit api.openai.com — slow, flaky, costs money, and is non-deterministic
  const app = await buildApp({ testing: true, db: ':memory:' });  // no aiProvider override
  await app.inject({ method: 'POST', url: '/api/v1/projects/demo/runs', payload: failedRun });
  // AI pipeline runs against real provider
});
// Fix: pass aiProvider: new MockAiProvider() to buildApp()

// ❌ Unit test with DB call
it('computes pass rate', async () => {
  const run = await em.findOne(TestRun, { id: 1 });  // hits the DB — should be pure
  expect(run.passRate).toBe(0.75);
});
// Fix: test TestRun.passRate as a pure method: const run = new TestRun(); run.passed = 75; run.total = 100;
```
