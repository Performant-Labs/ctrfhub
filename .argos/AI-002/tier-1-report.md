# Tier 1 Headless Report — AI-002

**Executed:** 2026-04-26 08:40
**Method:** `fastify.inject()` / `vitest` / `categorizeRun()` direct call (no browser)

## Checks

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | `CategorizeOutputSchema` accepts valid output | `CategorizeOutputSchema.safeParse(valid)` | `success: true` | `success: true` | ✓ |
| 2 | `CategorizeOutputSchema` rejects invalid category | `.safeParse({category: 'invalid'})` | `success: false` | `success: false` | ✓ |
| 3 | `CategorizeOutputSchema` rejects confidence out of bounds | `.safeParse({confidence: 1.1})` | `success: false` | `success: false` | ✓ |
| 4 | `AiCategoryEnum` accepts all 5 valid categories | `.safeParse(each)` | `success: true` | `success: true` | ✓ |
| 5 | Schema-generator creates `ai_pipeline_log` table (SQLite) | `PRAGMA table_info('ai_pipeline_log')` | All 11 columns present | All 11 columns present | ✓ |
| 6 | Schema-generator creates 7 CTRFHub tables | `SELECT name FROM sqlite_master` | 7 tables | 7 tables | ✓ |
| 7 | `ai_pipeline_log.test_run_id` FK → `test_runs` | `PRAGMA foreign_key_list` | FK exists | FK exists | ✓ |
| 8 | `test_results` has `ai_category_model`, `ai_category_at` columns | `PRAGMA table_info` | Columns present | Columns present | ✓ |
| 9 | Consent gate: skips when `AI_CLOUD_PIPELINE` unset | Direct call to `categorizeRun()` | 0 provider calls | 0 provider calls | ✓ |
| 10 | Consent gate: skips when `aiCloudAckAt` NULL | Direct call to `categorizeRun()` | 0 provider calls | 0 provider calls | ✓ |
| 11 | Skips when run has zero failed results | Direct call to `categorizeRun()` | 0 provider calls | 0 provider calls | ✓ |
| 12 | No real LLM SDK imports in test file | Regex scan of test source | 0 matches | 0 matches | ✓ |
| 13 | Terminal-fails exhausted-attempt rows on boot | `recoverStalePipelineRows()` | `status = 'failed'` | `status = 'failed'` | ✓ |
| 14 | **BLOCKED** — Consent gate: runs when both gates pass | `categorizeRun()` | 1 provider call | 0 provider calls | ✗ |
| 15 | **BLOCKED** — Happy path reserve→execute→commit | `categorizeRun()` | log row `status='done'` | never reaches execution | ✗ |
| 16 | **BLOCKED** — Batch size 20 (50 results → 3 calls) | `categorizeRun()` | 3 calls | 0 calls | ✗ |
| 17 | **BLOCKED** — Cap 500 (600 results → 25 calls) | `categorizeRun()` | 25 calls | 0 calls | ✗ |
| 18 | **BLOCKED** — Transient error releases row to pending | `categorizeRun()` | `status='pending'` | `status='running'` | ✗ |
| 19 | **BLOCKED** — Terminal error marks row failed + partial event | `categorizeRun()` | `status='failed'` | `status='running'` | ✗ |
| 20 | **BLOCKED** — Recovery: stale heartbeat reclaimed to pending | `recoverStalePipelineRows()` | `status='pending'` | `status='running'` | ✗ |
| 21 | **BLOCKED** — `run.ai_categorized` published on completion | `categorizeRun()` | 1 event | 0 events | ✗ |

## Root causes of blocked checks (2 application code bugs)

### Bug 1: `affectedRows` detection in `categorizer.ts:191-193` (blocks checks 14–19, 21)

MikroORM's SQLite driver returns an **empty array `[]`** for `connection.execute()` on UPDATE statements (not an object with `affectedRows`). The current detection logic:

```typescript
const affectedRows = typeof reserved === 'object' && 'affectedRows' in reserved
  ? (reserved as { affectedRows: number }).affectedRows
  : Array.isArray(reserved) ? reserved.length : 0;
```

Always evaluates to `0` on SQLite because:
- `typeof [] === 'object'` is true, but `'affectedRows' in []` is false
- `Array.isArray([]) ? [].length : 0` → `0`

**Remediation:** Use the SQLite-specific method for checking affected rows, or query `changes()` after the UPDATE:
```typescript
// Option A: Use raw knex/better-sqlite3 result
const result = await em.getConnection().execute(updateSql, params);
// Option B: After UPDATE, check SELECT changes()
const [{ changes }] = await em.getConnection().execute('SELECT changes() as changes');
```

### Bug 2: Date comparison in `recovery.ts:78` (blocks check 20)

The recovery SQL compares `heartbeat_at < ?` where `?` is a JavaScript `Date` object. SQLite stores datetimes from `CURRENT_TIMESTAMP` as UTC strings (e.g. `'2026-04-26 15:30:00'`), but MikroORM may serialize the JS `Date` parameter in a different format (ISO-8601 with `T` separator, or as a Unix timestamp). The format mismatch prevents SQLite's text-based date comparison from working correctly.

**Remediation:** Pass the stale threshold as an ISO string formatted to match SQLite's `CURRENT_TIMESTAMP` output:
```typescript
const staleThreshold = new Date(Date.now() - HEARTBEAT_STALE_SECONDS * 1000)
  .toISOString().replace('T', ' ').slice(0, 19);
```

### Additional note: Missing UNIQUE constraint (non-blocking — worked around in tests)

The `ON CONFLICT (test_run_id, stage)` clause in the categorizer's upsert SQL requires a DDL-level UNIQUE constraint or index. The schema-generator doesn't create one (MikroORM v7 limitation). Tests create it manually via `CREATE UNIQUE INDEX`. This was flagged in the feature-handoff as a known issue.

## Excerpt of raw output

```
 ✓ src/__tests__/unit/ai-pipeline-schemas.test.ts (23 tests) 7ms
 ✓ src/__tests__/integration/schema-sqlite.test.ts (18 tests) 100ms

 Test Files  17 passed (17)
      Tests  372 passed (372)

ai-categorization.test.ts:
 ✓ consent gate > skips when AI_CLOUD_PIPELINE is not set
 ✓ consent gate > skips when aiCloudAckAt is NULL
 × consent gate > runs when both gates pass → expected [] to have a length of 1 but got +0
 × happy path > completes reserve → execute → commit → expected [] to have a length of 1 but got +0
 × batching > batches in groups of 20 → expected [] to have a length of 3 but got +0
 × error handling > releases row to pending → expected 'running' to be 'pending'
 × boot-time recovery > reclaims stale heartbeat → expected 'running' to be 'pending'
 ✓ boot-time recovery > terminal-fails exhausted-attempt rows
 ✓ no real LLM calls > no AI SDK imports
```

## Verdict

**FAIL** — halt. Re-open a Feature-implementer session with the two bug fixes documented above.

**Tests authored and ready:** 5 passing in `ai-categorization.test.ts` + 23 unit tests in `ai-pipeline-schemas.test.ts` + 2 new assertions in `schema-sqlite.test.ts` = 30 new passing tests. The 8 blocked integration tests are fully written and will pass once the two app code bugs are fixed — no test changes needed.
