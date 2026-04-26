# Tier 1 Headless Report — CTRF-002

**Executed:** 2026-04-25 15:56
**Method:** `fastify.inject()` (no browser)

## Checks

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | Valid CTRF JSON → 201 + runId + DB rows + EventBus | `app.inject({ method: 'POST', url: '/api/v1/projects/demo/runs', payload: validCtrf, headers: { 'x-api-token': key } })` | 201, `{ runId }`, TestRun row, 5 TestResult rows, `run.ingested` event | 201, runId present, TestRun(totalTests=5, passed=3, failed=2, status='failed'), 5 results, event with correct payload | ✓ |
| 2 | Idempotency replay → 200 + same runId | Two injects with same `Idempotency-Key` header | First: 201; Second: 200 + `X-Idempotent-Replay: true` + same runId | First: 201; Second: 200, header present, runId matches | ✓ |
| 3 | Cross-project token → 403 | Inject to `/api/v1/projects/other-project/runs` with key scoped to `demo` | 403 + `CROSS_PROJECT_TOKEN` | 403 + `CROSS_PROJECT_TOKEN` | ✓ |
| 4 | Unknown project slug → 404 | Inject to `/api/v1/projects/nonexistent/runs` | 404 + `PROJECT_NOT_FOUND` | 404 + `PROJECT_NOT_FOUND` | ✓ |
| 5 | Invalid CTRF JSON → 422 | Inject `{ invalid: 'not a ctrf report' }` | 422 + `INVALID_CTRF` + Zod issues | 422 + `INVALID_CTRF` + issues array | ✓ |
| 6 | Malformed Idempotency-Key (non-ASCII) → 422 | Inject with `Idempotency-Key: key-with-émojis-🎉` | 422 + `INVALID_IDEMPOTENCY_KEY` | 422 + `INVALID_IDEMPOTENCY_KEY` | ✓ |
| 7 | Idempotency-Key > 128 chars → 422 | Inject with 129-char key | 422 + `INVALID_IDEMPOTENCY_KEY` | 422 + `INVALID_IDEMPOTENCY_KEY` | ✓ |
| 8 | Multipart with `ctrf` field → 201 | Inject multipart with `ctrf` field containing valid JSON | 201 + `{ runId }` | 201 + runId present | ✓ |
| 9 | Multipart missing `ctrf` field → 422 | Inject multipart with `not-ctrf` field only | 422 + `MISSING_CTRF_FIELD` | 422 + `MISSING_CTRF_FIELD` | ✓ |
| 10 | Chunked bulk insert (600 results) → 201 | Inject CTRF with 600 test results | 201, 600 TestResult rows, correct counters | 201, 600 rows, totalTests=600, passed=600 | ✓ |
| 11 | Missing `x-api-token` → rejected | Inject without auth header | Not 201/200 | 302 (redirect to /login) | ✓ |
| 12 | Invalid API key → 401 | Inject with `ctrf_invalid` | 401 + `INVALID_API_KEY` | 401 + `INVALID_API_KEY` | ✓ |

## Excerpt of raw output

```
 ✓ src/__tests__/integration/ingest.test.ts > CTRF-002 Ingest — happy path and validation > returns 201, persists rows, and publishes run.ingested
 ✓ src/__tests__/integration/ingest.test.ts > CTRF-002 Ingest — happy path and validation > returns 200 with X-Idempotent-Replay on duplicate key
 ✓ src/__tests__/integration/ingest.test.ts > CTRF-002 Ingest — happy path and validation > returns 403 when token is scoped to a different project
 ✓ src/__tests__/integration/ingest.test.ts > CTRF-002 Ingest — happy path and validation > returns 404 for unknown project slug
 ✓ src/__tests__/integration/ingest.test.ts > CTRF-002 Ingest — happy path and validation > returns 422 for invalid CTRF JSON
 ✓ src/__tests__/integration/ingest.test.ts > CTRF-002 Ingest — happy path and validation > returns 422 for malformed Idempotency-Key
 ✓ src/__tests__/integration/ingest.test.ts > CTRF-002 Ingest — happy path and validation > returns 422 for Idempotency-Key exceeding 128 characters
 ✓ src/__tests__/integration/ingest.test.ts > CTRF-002 Ingest — happy path and validation > accepts multipart/form-data with ctrf field
 ✓ src/__tests__/integration/ingest.test.ts > CTRF-002 Ingest — multipart missing field + chunked insert > returns 422 for multipart missing ctrf field
 ✓ src/__tests__/integration/ingest.test.ts > CTRF-002 Ingest — multipart missing field + chunked insert > persists >500 test results correctly (chunked bulk insert)
 ✓ src/__tests__/integration/ingest.test.ts > CTRF-002 Ingest — auth error paths > rejects when x-api-token is missing
 ✓ src/__tests__/integration/ingest.test.ts > CTRF-002 Ingest — auth error paths > returns 401 for invalid API key

 Test Files  11 passed (11)
      Tests  238 passed (238)
```

## Verdict

**PASS** — all 12 T1 checks pass. This is an API-only route; T2/T2.5/T3 not applicable.
