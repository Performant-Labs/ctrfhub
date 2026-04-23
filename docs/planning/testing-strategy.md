# CTRFHub — Testing Strategy

CTRFHub uses a three-layer pyramid: unit → integration → E2E. Each layer has a clear scope, a single framework, and a rule about what does and does not belong there.

---

## Frameworks

| Layer | Framework | Why |
|---|---|---|
| Unit | **Vitest** | Native ESM, fast, same API as Jest, first-class TypeScript |
| Integration | **Vitest + `fastify.inject()`** | No real HTTP server; SQLite in-memory for DB isolation |
| E2E | **Playwright** | First-class CTRF reporter; we dog-food our own ingest pipeline |

---

## Layer 1 — Unit Tests

**Rule:** No database, no HTTP, no filesystem, no external processes. Pure functions only.

**Run time:** < 200ms total.

### What belongs here

| Test file | What it covers |
|---|---|
| `ctrf-validator.test.ts` | Zod schema: valid reports pass, edge cases rejected (missing fields, wrong types) |
| `storage-key.test.ts` | Key generation: `buildStorageKey(orgId, projectId, runId, resultId, filename)` |
| `duration-format.test.ts` | `formatDuration(1500)` → `"1.5s"`, `formatDuration(80)` → `"80ms"` |
| `artifact-type-detect.test.ts` | `detectArtifactType('image/png', 'screenshot.png')` → `'screenshot'` |
| `retention-policy.test.ts` | `effectiveRetentionDays(project, org)` — project overrides org, 0 = keep forever |
| `embed-type-detect.test.ts` | `detectEmbedType('https://loom.com/share/abc')` → `'loom'` |
| `pass-rate.test.ts` | `TestRun.passRate` computed property; division by zero guard |
| `run-id-format.test.ts` | `formatRunId('E2E', 42)` → `'E2E-042'` |
| `disk-bar-level.test.ts` | `diskBarLevel(0.71)` → `'amber'`, `diskBarLevel(0.91)` → `'red'` |

### File structure

```
src/
└── __tests__/
    └── unit/
        ├── ctrf-validator.test.ts
        ├── storage-key.test.ts
        ├── duration-format.test.ts
        ├── artifact-type-detect.test.ts
        ├── retention-policy.test.ts
        ├── embed-type-detect.test.ts
        ├── pass-rate.test.ts
        ├── run-id-format.test.ts
        └── disk-bar-level.test.ts
```

### Example

```typescript
// src/__tests__/unit/storage-key.test.ts
import { describe, it, expect } from 'vitest';
import { buildStorageKey } from '../../lib/artifact-storage/storage-key';

describe('buildStorageKey', () => {
  it('builds the full hierarchical path', () => {
    expect(buildStorageKey(1, 7, 99, 450, 'screenshot.png'))
      .toBe('orgs/1/projects/7/runs/99/results/450/screenshot.png');
  });

  it('rejects traversal attempts', () => {
    expect(() => buildStorageKey(1, 7, 99, 450, '../etc/passwd'))
      .toThrow('Invalid filename');
  });
});
```

---

## Layer 2 — Integration Tests

**Rule:** Test Fastify routes end-to-end including middleware, auth, DB, and service logic. No real HTTP server — use `fastify.inject()`. No real PostgreSQL — use SQLite in-memory.

**Run time:** < 30s total.

### Key enablers

**SQLite in-memory:** The dual-dialect MikroORM setup (`mikro-orm.config.ts`) selects the driver from `DATABASE_URL`. In tests, pass `SQLITE_PATH=:memory:` — each suite gets a fresh, isolated database with migrations applied automatically.

**Interface-based test doubles:** `ArtifactStorage` and `EventBus` are interfaces. Pass mock implementations directly to `buildApp()` — no mocking framework required.

**Test auth hook:** `buildApp({ testing: true })` replaces Better Auth's session check with a test hook that injects a fixture user on every request. Individual tests can override the fixture user to test permission boundaries.

### `buildApp()` test signature

```typescript
// src/app.ts
export interface AppOptions {
  testing?: boolean;
  db?: string;                        // ':memory:' for tests
  artifactStorage?: ArtifactStorage; // inject test double
  eventBus?: EventBus;               // inject test double
}

export async function buildApp(opts: AppOptions = {}) { ... }
```

### File structure

```
src/
└── __tests__/
    └── integration/
        ├── ingest.test.ts           ← POST /api/v1/projects/:slug/runs
        ├── runs.test.ts             ← GET /runs, GET /runs/:id
        ├── settings-org.test.ts     ← PATCH /org/settings/*
        ├── settings-project.test.ts ← PATCH /projects/:slug/settings/*
        ├── sse.test.ts              ← SSE connection lifecycle
        ├── artifacts.test.ts        ← upload, serve, delete
        ├── auth.test.ts             ← login, session, token auth
        ├── rate-limit.test.ts       ← 429 responses, per-token limits
        └── system-status.test.ts    ← GET /org/settings/system
```

### Example — ingest route

```typescript
// src/__tests__/integration/ingest.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../app';
import { MemoryArtifactStorage } from '../../lib/artifact-storage/memory';
import { MemoryEventBus } from '../../lib/event-bus/memory';
import { validCtrfReport, ctrfWithAttachments } from '../fixtures/ctrf';

describe('POST /api/v1/projects/:slug/runs', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let storage: MemoryArtifactStorage;
  let bus: MemoryEventBus;

  beforeAll(async () => {
    storage = new MemoryArtifactStorage();
    bus = new MemoryEventBus();
    app = await buildApp({ testing: true, db: ':memory:', artifactStorage: storage, eventBus: bus });
  });

  afterAll(() => app.close());

  it('creates a run and returns 201 with runId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/demo/runs',
      headers: { 'x-api-token': 'token-001' },
      payload: validCtrfReport,
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toHaveProperty('runId');
  });

  it('publishes run.created event on the EventBus', async () => {
    const events: unknown[] = [];
    bus.subscribe('org:1', (event) => events.push(event));

    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/demo/runs',
      headers: { 'x-api-token': 'token-001' },
      payload: validCtrfReport,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'run.created' });
  });

  it('stores uploaded screenshots via ArtifactStorage', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects/demo/runs',
      headers: { 'x-api-token': 'token-001', 'content-type': 'multipart/form-data' },
      payload: ctrfWithAttachments, // multipart: ctrf.json + screenshot.png
    });

    expect(storage.keys()).toContain(
      expect.stringMatching(/orgs\/\d+\/projects\/\d+\/runs\/\d+\/results\/\d+\/screenshot\.png/)
    );
  });

  it('stores external URL attachments as url type without calling storage.store()', async () => {
    // ctrfWithLoomLink has attachment.path = 'https://loom.com/share/abc123'
    await app.inject({ /* ... */ });
    expect(storage.storedCount()).toBe(0); // nothing uploaded to storage
  });

  it('returns 429 when token rate limit is exceeded', async () => {
    // token-ratelimited has rate_limit_per_hour = 2; make 3 requests
    for (let i = 0; i < 2; i++) {
      await app.inject({ method: 'POST', url: '/api/v1/projects/demo/runs',
        headers: { 'x-api-token': 'token-ratelimited' }, payload: validCtrfReport });
    }
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/demo/runs',
      headers: { 'x-api-token': 'token-ratelimited' }, payload: validCtrfReport });
    expect(res.statusCode).toBe(429);
  });

  it('returns 413 when multipart total exceeds MAX_ARTIFACT_SIZE_PER_RUN', async () => { /* ... */ });
  it('returns 401 when x-api-token is missing', async () => { /* ... */ });
  it('returns 422 when CTRF JSON fails schema validation', async () => { /* ... */ });
});
```

### Testing HTMX routes

HTMX routes return HTML fragments when `HX-Request: true`. Assert on the HTML content:

```typescript
it('returns run-list partial for HTMX requests', async () => {
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
  const res = await app.inject({ method: 'GET', url: '/projects/demo/runs', headers: { Cookie: testSession } });
  expect(res.body).toContain('<html');
  expect(res.body).toContain('class="run-card"');
});
```

### Test fixtures

```
src/__tests__/
└── fixtures/
    ├── ctrf.ts              ← validCtrfReport, ctrfWithAttachments, ctrfWithExternalUrls
    ├── users.ts             ← adminUser, memberUser, ownerUser fixtures
    ├── projects.ts          ← demoProject, archivedProject fixtures
    └── runs.ts              ← passedRun, failedRun, mixedRun fixtures
```

---

## Layer 3 — E2E Tests (Playwright)

**The dog-food rule:** CTRFHub's own Playwright E2E tests generate CTRF reports via `playwright-ctrf-json-reporter` and ingest those reports into a running CTRFHub instance. The product validates itself.

**Test environment:** A local `docker compose up` instance (or `npm run dev` with SQLite for faster iteration).

### File structure

```
e2e/
├── playwright.config.ts
├── tests/
│   ├── login.spec.ts            ← sign in, sign out, bad credentials
│   ├── ingest-and-view.spec.ts  ← POST CTRF → view Run Detail → assert HTML (not JSON)
│   ├── settings-autosave.spec.ts ← type in field, blur, assert "✓ Saved"
│   ├── settings-theme.spec.ts   ← palette switch, data-theme attribute, auto mode
│   ├── system-status.spec.ts    ← table sizes, disk bar, version numbers visible
│   ├── artifact-upload.spec.ts  ← screenshot inline, video player, trace viewer link
│   ├── sse-update.spec.ts       ← ingest run → banner or silent update on dashboard
│   └── run-detail.spec.ts       ← all CTRF fields rendered; no raw JSON visible
└── ctrf/                        ← CTRF output from these test runs (auto-generated)
```

### Example — Run Detail must render HTML, not JSON (PL-007)

```typescript
// e2e/tests/run-detail.spec.ts
import { test, expect } from '@playwright/test';
import { ingestFixtureRun } from '../helpers/ingest';

test('Run Detail renders structured HTML — no raw JSON', async ({ page }) => {
  const { runId } = await ingestFixtureRun('failed-with-attachments');

  await page.goto(`/runs/${runId}`);

  // Required sections
  await expect(page.locator('.run-header')).toBeVisible();
  await expect(page.locator('.run-summary')).toBeVisible();
  await expect(page.locator('.test-results-table')).toBeVisible();

  // At least one failure row with expanded detail
  await page.locator('.test-row--failed').first().click();
  await expect(page.locator('.failure-detail')).toBeVisible();

  // No raw JSON on the page
  const body = await page.textContent('body');
  expect(body).not.toMatch(/^\s*\{/);  // doesn't start with raw JSON brace
  expect(body).not.toContain('"results":{');
});
```

### Dog-food reporter config

```typescript
// e2e/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['@ctrf-io/playwright-ctrf-json-reporter', {
      outputFile: 'ctrf/report.json',
      appName: 'CTRFHub E2E',
    }],
  ],
  // ...
});
```

After E2E tests run in CI, the generated `ctrf/report.json` is posted to the staging CTRFHub instance:

```bash
curl -X POST https://staging.ctrfhub.io/api/v1/projects/ctrfhub-e2e/runs \
  -H "x-api-token: $CTRF_INGEST_TOKEN" \
  -H "content-type: application/json" \
  -d @e2e/ctrf/report.json
```

---

## Vitest configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/migrations/**', 'src/entities/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
    },
    // Integration tests can be slower — give them room
    testTimeout: 15_000,
    // Run unit tests first (they're faster)
    sequence: { shuffle: false },
  },
});
```

```json
// package.json scripts
{
  "scripts": {
    "test":           "vitest run",
    "test:unit":      "vitest run src/__tests__/unit",
    "test:int":       "vitest run src/__tests__/integration",
    "test:watch":     "vitest",
    "test:coverage":  "vitest run --coverage",
    "test:e2e":       "playwright test",
    "test:e2e:ui":    "playwright test --ui"
  }
}
```

---

## CI pipeline

```yaml
# .github/workflows/ci.yml (abridged)

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
      - run: npm run test:unit

  integration:
    needs: unit
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
      - run: npm run test:int

  e2e:
    needs: integration
    runs-on: ubuntu-latest
    services:
      postgres: { image: postgres:16-alpine, ... }
    steps:
      - run: npm ci && npx playwright install --with-deps chromium
      - run: npm run build && npm start &
      - run: npm run test:e2e
      - name: Ingest E2E results into CTRFHub staging
        run: |
          curl -X POST $CTRF_STAGING_URL/api/v1/projects/ctrfhub-e2e/runs \
               -H "x-api-token: $CTRF_INGEST_TOKEN" \
               -H "content-type: application/json" \
               -d @e2e/ctrf/report.json
```

---

## Coverage targets

| Layer | Target | Measured by |
|---|---|---|
| Unit | 90% lines / 90% functions | `vitest --coverage` |
| Integration | Every route + every named error case | Manual audit against route list |
| E2E | Every major user workflow (happy path) | Playwright test list review |

Coverage percentage is a floor, not a goal. An 80% coverage score with no integration test for the ingest endpoint is worse than 60% coverage with full ingest coverage.

---

## What not to test

| Concern | Reason |
|---|---|
| MikroORM internals | Not our code |
| Better Auth internals | Not our code |
| Template pixel layout | E2E visual screenshots via Playwright if needed; not unit |
| SSE reconnect logic | HTMX SSE extension handles it; not our code |
| Docker Compose wiring | Infrastructure, not application logic |

---

*Last updated: 2026-04-22*
