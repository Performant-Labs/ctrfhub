# [CTRF-002] Ingest route and service

## Summary

Ships the headline ingestion pipe: `POST /api/v1/projects/:slug/runs` with JSON and multipart support, `x-api-token` auth, idempotent replay via the `Idempotency-Key` header, 500-row chunked bulk insert with `setImmediate` yield, and `run.ingested` publication on the EventBus that the AI A1 stage will subscribe to. Also lands the `EventBus` interface (`MemoryEventBus` for tests), the `IngestIdempotencyKey` entity with dual-dialect migrations, and the `ingest_idempotency_keys` table. Unblocks CTRF-003, CTRF-004, DATA-001, SSE-001, SRCH-001, AI-002.

## Acceptance criteria

- [x] `POST /api/v1/projects/:slug/runs` registered with `x-api-token` header authentication.
- [x] Both `application/json` and `multipart/form-data` accepted (multipart file parts drained without storage; CTRF-003 owns artifact persistence).
- [x] Zod validation via `CtrfReportSchema` from `src/modules/ingest/schemas.ts` (CTRF-001 — re-used, not redefined).
- [x] `201 { runId }` on success.
- [x] `401` missing token; `403` cross-project token; `404` unknown project; `413` payload too large; `422` invalid CTRF; `429` rate-limited.
- [x] Idempotency: `Idempotency-Key` header → `200 X-Idempotent-Replay: true` on duplicate replay, original `runId` preserved. Backed by `ingest_idempotency_keys` per `database-design.md §4.23` (composite uniqueness on `project_id` + `idempotency_key`).
- [x] Bulk insert uses 500-row chunked pattern with `setImmediate` yield between chunks (per `skills/ctrf-ingest-validation.md`; verified by integration test that ingests >500 results).
- [x] Publishes `run.ingested` to the EventBus via the `RunEvents.RUN_INGESTED` constant (no raw-string duplication).
- [x] **No `/api/artifact` endpoint exists.** Multipart file parts are drained but not stored — explicit forbidden pattern, confirmed by spec-enforcer.
- [x] Integration test suite covers all required status code paths (with two NIT exceptions documented below).

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | yes | ✓ | 13 tests in `src/__tests__/unit/size-limit.test.ts` (`parseMaxJsonSize()` — all suffixes, edge cases, fallbacks). |
| Integration | **yes (declared)** | ✓ | 12 tests in `src/__tests__/integration/ingest.test.ts` across 3 describe blocks (happy-path, multipart+chunked, auth errors); 4 modified assertions in `migrations-sqlite.test.ts` (4→5 table count + new ingest_idempotency_keys columns/FK). |
| E2E | no | N/A | Not required by `tasks.md §CTRF-002`. E2E coverage of the full ingest workflow lands when there's a dashboard to render (DASH-* stories). |

Full suite: **238 tests, 0 failures**.

## Page verification tiers

| Tier | Declared | Result | Report location (story branch) |
|---|---|---|---|
| T1 Headless | yes — every status code (201, 401, 403, 404, 413, 422, 429) + idempotency replay header | ✓ | `.argos/CTRF-002/tier-1-report.md` |
| T2 ARIA (clean room) | no — API-only, no rendered HTML | N/A | n/a |
| T2.5 Authenticated State | no — API-only, no rendered HTML | N/A | n/a |
| T3 Visual | no — API-only, no rendered HTML | N/A | n/a |

## Coverage gaps acknowledged (NITs, non-blocking)

Both gaps are documented in `.argos/CTRF-002/test-handoff.md` with sound justification and accepted by spec-enforcer:

1. **413 (body too large) not integration-tested.** Fastify's `bodyLimit` enforcement happens at the HTTP parser level and isn't reachable via `app.inject()` (which bypasses TCP). The limit is set from `parseMaxJsonSize(process.env.MAX_CTRF_JSON_SIZE)` and unit-tested in `size-limit.test.ts` (13 tests). The 413 path itself is a Fastify framework responsibility tested upstream.
2. **429 (rate limit) not integration-tested.** Sending 120+ requests per test suite is expensive and fragile. The `@fastify/rate-limit` config (`max: 120, timeWindow: '1 hour'`) is statically verifiable; rate limiting itself is a Fastify plugin responsibility tested upstream.

## Decisions that deviate from spec

The spec-enforcer audit returned **PASS** with the two NITs above. The following six decisions are documented in `.argos/CTRF-002/feature-handoff.md` and surfaced here for André's independent review:

1. **Rate limiting simplified to 120 req/hour keyed on the `x-api-token` header value.** DD-012 specifies per-token limits via a `project_tokens.rate_limit_per_hour` column — but that table doesn't exist (Better Auth's `apikey` table is the canonical token store, established in AUTH-001). When the token-management UI story lands, the keyGenerator should read from wherever per-token limits ultimately live. Documented separately as G-P1-008 below.
2. **`?on_duplicate=replace` and `?on_duplicate=error` deferred.** DD-019's replace/error modes need `ingest:replace` permission bits on tokens, which Better Auth's API key metadata doesn't currently carry. Only the default `return_existing` behaviour is implemented — same architectural source as decision (1).
3. **Multipart file parts consumed and discarded.** When a multipart request arrives, the `ctrf` field is extracted and any file parts are drained (stream consumed to avoid backpressure) but not stored. CTRF-003 will add artifact storage to these parts.
4. **`TestRun` counters set from CTRF summary, not from counting inserted results.** The CTRF summary is the authoritative source. CTRF's `pending` + `other` are mapped to our `skipped` counter (our schema doesn't have separate pending/other columns at the run level). `blocked` stays 0 (CTRF has no `blocked` concept).
5. **`em.merge(testRun)` after `em.clear()`.** The 500-row chunked insert calls `em.clear()` to release identity-map memory between chunks; after the last chunk, `testRun` is re-merged so the aggregate counter update can flush correctly. MikroORM identity-map pattern, not in any skill/doc.
6. **PG migration hand-written.** No Postgres server in the implementer's VM, so `npm run migrate:create:pg` returned ECONNREFUSED. The PG migration was hand-written to mirror the auto-generated SQLite migration's structure with PG-native types (`serial`, `varchar`, `timestamptz`, `ALTER TABLE ... ADD CONSTRAINT` for FKs). CI's PG dialect matrix will validate against a real Postgres instance.

## Gaps filed during this story

- **G-P1-007** — `run.ingested` vs `run.created` event-name reconciliation. `tasks.md`, `product.md §Feature 1`, `architecture.md §350`, `ai-features.md §A1` all use `run.ingested` (the AI pipeline trigger). `testing-strategy.md §Example` (line 159) and `database-design.md §SSE` use `run.created` for the SSE UI notification stream. Implementation correctly ships `run.ingested` per the canonical sources. Open question for André: are these the same event under different names, or two distinct events (one for the AI pipeline trigger, one for SSE UI updates)? If two distinct, a `RunEvents.RUN_CREATED` constant + a second publish call after ingest would be needed. Severity P1 (factual/contradiction). Audit explicitly asked Argos to reconcile.
- **G-P1-008** — DD-012 `project_tokens.rate_limit_per_hour` references a table that doesn't exist; Better Auth's `apikey` table is the canonical token store after AUTH-001. CTRF-002 simplified to a global 120/hour keyed on the token value. Same architectural source affects DD-019's `ingest:replace` permission bits (decision #2 above). Resolution path: when the token-management UI story lands (likely SET-001), confirm whether per-token limits / permissions live in Better Auth's `apikey.metadata`, in a new `project_tokens` table, or somewhere else; rewire `keyGenerator` and unblock the deferred `?on_duplicate=` modes accordingly. Severity P1 (architectural drift). Surfaced by Argos from feature-handoff decisions.

## Spec-enforcer verdict

**PASS** — see `.argos/CTRF-002/spec-audit.md`
**Date:** 2026-04-25
**Findings:** 0 blocking, 2 NIT (413/429 framework-level enforcement; both accepted with documented rationale), 0 forbidden patterns, 0 planning-doc drift.

## Next assignable stories (after this merges)

- **CTRF-003** — Artifact co-upload with ingest. Depends on CTRF-002 ✅. Ready to brief.
- **CTRF-004** — CI reporter packages. Depends on CTRF-002 ✅. Ready to brief.
- **DATA-001** — Data retention nightly job. Depends on CTRF-002 ✅. Ready to brief.
- **SSE-001** — Server-Sent Events for real-time dashboard updates. Depends on CTRF-002 ✅, DASH-001 ❌. Still blocked by DASH-001 (which needs INFRA-003, AUTH-002).
- **SRCH-001** — Global search. Depends on CTRF-002 ✅, DASH-001 ❌. Same DASH-001 chain.
- **AI-002** — AI pipeline A1 categorization. Depends on CTRF-002 ✅, AI-001 ❌. Needs AI-001 first (no brief drafted yet).

---
_Generated from `.argos/CTRF-002/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._
