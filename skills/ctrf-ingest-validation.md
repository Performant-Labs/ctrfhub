---
name: ctrf-ingest-validation
description: The canonical CTRF ingest endpoint contract — route, auth header, Zod schema validation, idempotency key handling, multipart vs JSON, artifact co-upload, error codes, and bulk-insert chunking.
trigger: implementing or modifying the ingest route; implementing CTRF schema validation; handling multipart artifact uploads with a run; adding idempotency support
source: docs/planning/product.md §Feature 1 Acceptance criteria, §Feature 4 Acceptance criteria; docs/planning/architecture.md §CI/CD; ~/Sites/ai_guidance/frameworks/mikro-orm/conventions.md §Chunked Bulk Insert
---

## Rule

The ingest endpoint is `POST /api/v1/projects/:slug/runs`; authentication uses `x-api-token: <ctrf_*>` (not a session cookie); the CTRF JSON body is validated with a Zod schema before any DB write; artifacts are co-uploaded in the same multipart request as the CTRF JSON; bulk test-result inserts use the 500-row chunked pattern with event-loop yielding; there is no separate `/api/artifact` endpoint.

## Why

This is the critical path of the product. Every CI pipeline integration depends on this contract being stable, well-validated, and idempotent. The spec in `product.md §Feature 1 Acceptance criteria` is precise: 201 on success, 422 on Zod validation failure, 401 on missing/invalid token, 429 on rate limit exceeded, 413 on artifact size limit exceeded. The "no separate artifact endpoint" rule is also explicit (`product.md §Feature 4`: "There is no separate `/api/artifact` endpoint — artifacts are always submitted with the run that owns them"). Getting these contracts wrong means every downstream CI integration breaks.

The chunked bulk-insert rule exists because CTRF reports can contain thousands of test results. Without chunking (500-row batches with `setImmediate` yields between batches), a large ingest blocks the Node.js event loop and makes the server unresponsive during the write (`mikro-orm/conventions.md §Chunked Bulk Insert (Event Loop Yielding)`).

## How to apply

### Route shape

```
POST /api/v1/projects/:slug/runs
Headers:
  x-api-token: ctrf_<project-scoped token>
  Content-Type: application/json          — raw JSON body (no artifacts)
            OR: multipart/form-data       — ctrf JSON field + optional artifact file parts

Response 201: { "runId": "E2E-042" }
Response 401: { "error": "Invalid or missing API token" }
Response 404: { "error": "Project not found" }
Response 413: { "error": "Artifact size limit exceeded", "limit": "1073741824" }
Response 422: { "error": "...", "issues": [ Zod validation errors ] }
Response 429: { "error": "Rate limit exceeded" }
```

### Zod CTRF schema

Define `CtrfReportSchema` in `src/modules/ingest/schemas.ts` covering the full CTRF spec. Key fields:
- `results.required`: `testId`, `name`, `status` (`passed | failed | skipped | other`)
- `results.optional`: `message`, `trace`, `duration`, `attachments`, `flaky`, `retries`, `suite`
- `summary`: `tests`, `passed`, `failed`, `pending`, `skipped`, `other`, `suites`, `start`, `stop`
- `tool.name`: required

**Note:** `status: 'other'` is a valid CTRF status (`gap-review-merged.md #27`) — the Zod schema must allow it and the rollup logic must handle it (map to the `other` counter on `test_runs`).

### Idempotency key

`Idempotency-Key` header (optional):
- If present and a matching key exists in `ingest_idempotency_keys` within 24 h: return `200` with original `{ runId }` + `X-Idempotent-Replay: true` header.
- If absent: always create a new run (no duplicate detection).
- `?on_duplicate=replace` with `ingest:replace` token permission: overwrite the existing run.
- See `product.md §Feature 1 Acceptance criteria` for the full contract.

### Multipart uploads

When `Content-Type: multipart/form-data`:
1. The `ctrf` field contains the CTRF JSON string — parse and validate with Zod.
2. Each additional file part is an artifact. The part `name` matches `attachment.path` values in the CTRF JSON.
3. Artifacts exceeding per-file size limits return `413` — images 10 MB, video 100 MB, zips 200 MB, logs 5 MB. Per-run total limit is `MAX_ARTIFACT_SIZE_PER_RUN` (default 1 GB).
4. External URL attachments (`attachment.path` starting `http://` or `https://`) are stored by reference only — no file upload.

### Chunked bulk insert (required for all test-result inserts)

```typescript
const CHUNK_SIZE = 500;

async function bulkInsertResults(em: EntityManager, results: TestResultDto[]) {
  for (let i = 0; i < results.length; i += CHUNK_SIZE) {
    const chunk = results.slice(i, i + CHUNK_SIZE);
    for (const dto of chunk) em.create(TestResult, dto);
    await em.flush();
    em.clear();  // Release identity map memory between chunks
    if (i + CHUNK_SIZE < results.length) {
      await new Promise<void>(resolve => setImmediate(resolve));  // yield event loop
    }
  }
}
```

Use this for any insert of more than ~1,000 rows in a single request handler.

### Post-ingest event

After the DB write commits, publish `run.ingested` on the EventBus. The AI pipeline subscribes to this event — the 201 response must **not** wait for AI processing.

## Bad example

```typescript
// ❌ No chunking — blocks event loop for large CTRF files
await Promise.all(results.map(dto => {
  em.create(TestResult, dto);
}));
await em.flush();  // one giant flush — blocks server for seconds on 5,000-test runs

// ❌ Separate artifact endpoint — contradicts the spec
fastify.post('/api/artifact', async (request, reply) => { ... });
// Artifacts must be part of the multipart ingest POST

// ❌ Accepting attachment uploads after the run is created
fastify.patch('/api/v1/runs/:id/artifacts', async (request, reply) => { ... });
// No post-hoc artifact endpoint — artifacts co-upload with the run
```
