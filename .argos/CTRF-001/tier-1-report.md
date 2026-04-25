# Tier 1 Headless Report — CTRF-001

**Executed:** 2026-04-25 12:21
**Method:** Vitest `safeParse()` — pure Zod parsing, zero I/O (Layer 1 unit tests)

## Checks

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | CtrfStatusSchema accepts all 5 canonical statuses | `CtrfStatusSchema.safeParse(status)` | `success: true` for each | All 5 pass | ✓ |
| 2 | CtrfStatusSchema rejects invalid strings | `CtrfStatusSchema.safeParse('completed')` | `success: false` | `false` | ✓ |
| 3 | Minimal valid CTRF report accepted | `CtrfReportSchema.safeParse(minimalReport)` | `success: true` | `true` | ✓ |
| 4 | Full-shape CTRF report (all optional fields) accepted | `CtrfReportSchema.safeParse(fullReport)` | `success: true` | `true` | ✓ |
| 5 | `status: 'other'` accepted at test level (G-P2-004) | `safeParse({ status: 'other' })` | `success: true` | `true` | ✓ |
| 6 | `status: 'other'` accepted in retryAttempt | `safeParse({ retryAttempts: [{ status: 'other' }] })` | `success: true` | `true` | ✓ |
| 7 | `status: 'other'` accepted in step | `safeParse({ steps: [{ status: 'other' }] })` | `success: true` | `true` | ✓ |
| 8 | Each of 3 required top-level fields rejected when missing | `safeParse(report)` with field deleted | `success: false` | All 3 fail | ✓ |
| 9 | Required `results` sub-fields rejected when missing (tool, summary, tests) | `safeParse(report)` with each deleted | `success: false` | All 3 fail | ✓ |
| 10 | Each of 8 required summary fields rejected when missing | `safeParse(report)` with field deleted | `success: false` | All 8 fail | ✓ |
| 11 | Each of 3 required test fields rejected when missing | `safeParse(report)` with field deleted | `success: false` | All 3 fail | ✓ |
| 12 | Wrong types rejected (11 cases: string/float/invalid-enum/UUID/datetime/boolean) | `safeParse(report)` with wrong type | `success: false` | All 11 fail | ✓ |
| 13 | Strict mode rejects unknowns at top-level, results, tool, summary, test | `safeParse({ ...valid, badProp: true })` | `success: false` | All 5 fail | ✓ |
| 14 | Strict mode rejects unknowns in environment, insights, baseline, retryAttempt, step, attachment | `safeParse({ ...valid, badProp: true })` | `success: false` | All 6 fail | ✓ |
| 15 | Attachment required fields enforced (name, contentType, path) | `safeParse(report)` with each deleted | `success: false` | All 3 fail | ✓ |
| 16 | RetryAttempt required fields enforced (attempt, status) | `safeParse(report)` with each deleted | `success: false` | Both fail | ✓ |
| 17 | Step required fields enforced (name, status) | `safeParse(report)` with each deleted | `success: false` | Both fail | ✓ |
| 18 | Baseline required field enforced (reportId) | `safeParse({ baseline: { source: '...' } })` | `success: false` | `false` | ✓ |
| 19 | Format validation: non-URL baseline.buildUrl rejected | `safeParse({ buildUrl: 'not-a-url' })` | `success: false` | `false` | ✓ |
| 20 | Format validation: non-datetime baseline.timestamp rejected | `safeParse({ timestamp: 'yesterday' })` | `success: false` | `false` | ✓ |
| 21 | Format validation: non-UUID test.id rejected | `safeParse({ id: 'not-a-uuid' })` | `success: false` | `false` | ✓ |
| 22 | Edge cases: empty tests array, min-length name, empty suite, retryAttempt min, all 5 statuses, semver format | Various | Mixed pass/fail per spec | All correct | ✓ |
| 23 | Zod error shape: issues array with code/message/path on validation failure | `safeParse({})` | `error.issues` present | Present with correct shape | ✓ |

## Excerpt of raw output

```
 ✓ src/__tests__/unit/ctrf-validator.test.ts (76 tests) 18ms

 Test Files  1 passed (1)
      Tests  76 passed (76)
   Start at  12:21:43
   Duration  620ms (transform 57ms, setup 0ms, collect 113ms, tests 18ms, environment 0ms, prepare 114ms)
```

## Full suite regression check

```
 Test Files  8 passed (8)
      Tests  188 passed (188)
   Start at  12:21:59
   Duration  1.06s
```

## Coverage (schema file only)

```
 ...modules/ingest |     100 |      100 |     100 |     100 |
  schemas.ts       |     100 |      100 |     100 |     100 |
```

## Verdict

**PASS** — all 76 unit tests pass, no regressions across 188-test full suite, schema at 100% coverage. This is a schema-only story — T2/T2.5/T3 are N/A (no rendered routes).
