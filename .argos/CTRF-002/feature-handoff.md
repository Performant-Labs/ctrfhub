# Feature Handoff — CTRF-002: Ingest route and service

**Branch:** `story/CTRF-002`
**Commits on this branch since `main`:**
- 84b8d7b feat(CTRF-002): Ingest route, service, EventBus, and idempotency store

## What was built

- **EventBus service** (`src/services/event-bus.ts`) — `EventBus` interface, `MemoryEventBus` implementation with `published[]` for test assertions, `RunEvents` constants (`RUN_INGESTED`, `RUN_AI_CATEGORIZED`, `RUN_AI_CORRELATED`, `RUN_AI_SUMMARIZED`), `RunIngestedPayload` type
- **IngestIdempotencyKey entity** (`src/entities/IngestIdempotencyKey.ts`) — MikroORM entity for `ingest_idempotency_keys` table with `UNIQUE (project_id, idempotency_key)` composite constraint
- **Dual-dialect migrations** for `ingest_idempotency_keys` (SQLite + PG)
- **IngestService** (`src/modules/ingest/service.ts`) — Zod validation, idempotency check/record, 500-row chunked TestResult insert with `setImmediate` yield, aggregate counter rollup, `run.ingested` event publication
- **Ingest route** (`src/modules/ingest/routes.ts`) — `POST /api/v1/projects/:slug/runs` with JSON and multipart content-type support, scope check, rate limiting (120/hour per token), body size limit from `MAX_CTRF_JSON_SIZE`, Idempotency-Key header validation
- **Size-limit parser** (`src/modules/ingest/size-limit.ts`) — parses human-readable size strings (e.g. "10mb") into bytes
- **App.ts wiring** — EventBus always present (defaults to MemoryEventBus), `@fastify/multipart` registered, ingest plugin registered
- **Types** — `src/types.ts` re-exports `EventBus` from `src/services/event-bus.ts` (no longer a stub)

## Commands run locally (results)

- `tsc --noEmit` — 0 errors
- `npm run migrate:create:sqlite` — succeeded, generated `Migration20260425215643.ts`
- `npm run migrate:create:pg` — ECONNREFUSED (no PG server in VM); PG migration hand-written to match SQLite schema
- `npm run dev` — server booted on :3000; `/health` returned 200; ingest route returns 302 (auth redirect, expected — no user seeded)
- `npm run test` — 209 passed, 1 failed (see Known Issues)

## Files created or modified

Grouped by directory. One line per file, with a short purpose note.

- `src/services/event-bus.ts` — EventBus interface, MemoryEventBus, RunEvents constants, RunIngestedPayload type
- `src/entities/IngestIdempotencyKey.ts` — MikroORM entity for `ingest_idempotency_keys`
- `src/entities/index.ts` — added barrel export for IngestIdempotencyKey
- `src/modules/ingest/routes.ts` — Fastify plugin: POST /api/v1/projects/:slug/runs
- `src/modules/ingest/service.ts` — IngestService class with ingest(), bulkInsertResults(), checkIdempotency(), recordIdempotencyKey()
- `src/modules/ingest/size-limit.ts` — parseMaxJsonSize() utility
- `src/mikro-orm.config.sqlite.ts` — added IngestIdempotencyKey to entities array
- `src/mikro-orm.config.pg.ts` — added IngestIdempotencyKey to entities array
- `src/migrations/sqlite/Migration20260425215643.ts` — SQLite migration for ingest_idempotency_keys table
- `src/migrations/pg/Migration20260425215643.ts` — PostgreSQL migration for ingest_idempotency_keys table (hand-written)
- `src/app.ts` — registered @fastify/multipart, ingest plugin, default MemoryEventBus
- `src/types.ts` — EventBus re-exported from src/services/event-bus.ts instead of stub interface

## Decisions not covered by planning docs

- **Rate limiting simplified for MVP.** DD-012 specifies per-token rate limiting via `project_tokens.rate_limit_per_hour`, but that table doesn't exist — Better Auth's `apikey` table is the token store. Used a simplified 120 req/hour keyed on the `x-api-token` header value instead. When `project_tokens` lands (token management UI story), the keyGenerator should read from that row.

- **`?on_duplicate=replace` and `?on_duplicate=error` deferred.** These modes require `ingest:replace` permission bits on tokens, which Better Auth's API key metadata doesn't carry. Only the default `return_existing` behaviour is implemented. The DD-019 replace/error modes should land alongside token management.

- **Multipart file parts discarded.** When a multipart request arrives, the `ctrf` field is extracted and file parts are drained (stream consumed to avoid backpressure) but not stored. CTRF-003 will add artifact storage to these parts.

- **TestRun counters set from CTRF summary, not from counting inserted results.** The CTRF summary is the authoritative source — its `tests`, `passed`, `failed`, `skipped`, `pending`, `other` counters are used directly. CTRF's `pending` + `other` are mapped to our `skipped` counter since our schema doesn't have separate pending/other columns at the run level. `blocked` stays 0 (CTRF has no blocked concept).

- **`em.merge(testRun)` after `em.clear()`.** The 500-row chunked insert calls `em.clear()` to release identity map memory between chunks. After the last chunk, `testRun` is re-merged into the identity map so the aggregate counter update can flush correctly. This is an implementation detail not in any skill/doc but is required by the MikroORM identity map clearing pattern.

- **PG migration hand-written.** No Postgres server available in the VM. The migration was written manually matching the SQLite migration's structure with PG-native types (serial, varchar, timestamptz, ALTER TABLE for FKs). Should be validated against a real PG instance in CI.

## Known issues / follow-ups

- **Test `creates exactly 4 CTRFHub-owned tables` fails.** The existing `src/__tests__/integration/migrations-sqlite.test.ts` assertion expects 4 tables but CTRF-002 added `ingest_idempotency_keys` (table #5). The Test-writer needs to update this assertion to 5.

- **`run.ingested` vs `run.created` naming discrepancy.** Per Argos's note: the acceptance criteria, `product.md §Feature 1`, and `ai-features.md §A1` all use `run.ingested`. But `testing-strategy.md §Example` uses `run.created` and `database-design.md §SSE` uses `run.created` for SSE UI notifications. I implemented `run.ingested` per the acceptance criteria (it's the literal string the AI pipeline A1 stage subscribes to). **Open question for Argos:** are these the same event under different names, or two distinct events (one for AI pipeline trigger, one for SSE UI updates)? If two distinct events, a second `RunEvents.RUN_CREATED` constant and a second `eventBus.publish()` call are needed after ingest.

- **No `/api/artifact` endpoint exists** in this diff — confirmed per the spec.

## Next action (Test-writer)

1. Open a new session. Paste `.antigravity/agents/test-writer.md` as the first message, then this handoff as the second.
2. Check out `story/CTRF-002` (already on it if continuing locally).
3. Start with T1 Headless. Routes to focus on: `POST /api/v1/projects/:slug/runs`. Tier-report templates are in `.antigravity/agents/test-writer.md`.

Key test scenarios:
- **201** — valid CTRF JSON with a seeded project and API key
- **200 + X-Idempotent-Replay: true** — second POST with same Idempotency-Key
- **401** — missing `x-api-token` header (handled by global preHandler)
- **403** — API key metadata.projectId doesn't match target project
- **404** — unknown project slug
- **413** — body exceeding MAX_CTRF_JSON_SIZE
- **422** — invalid CTRF JSON (Zod validation failure)
- **422** — malformed Idempotency-Key header (non-ASCII or >128 chars)
- **429** — rate limit exceeded (120 requests to the same endpoint)
- **Multipart** — `multipart/form-data` with `ctrf` field containing valid JSON
- **EventBus** — verify `run.ingested` event published with correct payload
- **Chunked insert** — verify >500 test results are persisted correctly

Test doubles needed:
- `MemoryEventBus` — inject via `buildApp({ eventBus: new MemoryEventBus() })` and inspect `.published[]`
- Seed: Organization → Project → Better Auth user + API key with `metadata.projectId`

Also update `src/__tests__/integration/migrations-sqlite.test.ts` to expect 5 tables instead of 4.
