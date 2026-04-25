# Spec-enforcer Audit — CTRF-002

**Executed:** 2026-04-25 16:04
**Scope:** diff `main..story/CTRF-002`
**Checklists run:** Architecture rules, Coverage, Planning docs conformance, Skills violations (ctrf-ingest-validation, mikroorm-dual-dialect, fastify-route-convention, vitest-three-layer-testing)

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| — | — | — | — | — |

**No drift detected against `skills/` or `docs/planning/*`.**

## Coverage gaps

| # | What's missing | Required by | Severity |
|---|---|---|---|
| 1 | No integration test for 413 (body too large) | Brief §acceptance criteria "413 payload too large" | **NIT** |
| 2 | No integration test for 429 (rate limit exceeded) | Brief §acceptance criteria "429 rate-limited" | **NIT** |

Both gaps are documented in the test-handoff with sound justification:
- **413**: `bodyLimit` enforcement happens at Fastify's HTTP parser level and cannot be triggered via `app.inject()` (which bypasses TCP). Unit-tested via `parseMaxJsonSize()` in `size-limit.test.ts` (13 tests).
- **429**: Sending 120+ requests per test suite is expensive and fragile. `@fastify/rate-limit` is well-tested upstream; the config (`max: 120, timeWindow: '1 hour'`) is statically verifiable.

**Coverage otherwise matches the story's declared test tiers.** 12 integration tests cover 201, 200 (idempotency replay), 401, 403, 404, 422 (3 variants: invalid CTRF, malformed idempotency key, missing multipart field), multipart happy path, and >500-row chunked insert. 13 unit tests cover `parseMaxJsonSize()`. 4 additional migration assertions added.

## Planning-doc conformance (only lines relevant to this story's scope)

- [x] Ingest endpoint uses `x-api-token` header (not `Authorization: Bearer`) — `skills/ctrf-ingest-validation.md`, `docs/planning/architecture.md §519`
- [x] Migrations generated for both PG and SQLite after entity change — `skills/mikroorm-dual-dialect.md`; SQLite auto-generated, PG hand-written (feature-handoff documents the ECONNREFUSED reason)
- [x] Bulk inserts use 500-row chunked pattern with `setImmediate` yield — `skills/ctrf-ingest-validation.md`; `CHUNK_SIZE = 500` at `service.ts:38`, `setImmediate` yield at `service.ts:196`
- [x] `run.ingested` event published with `RunEvents.RUN_INGESTED` constant — `docs/planning/ai-features.md §86`; no raw string duplication in publisher or test code
- [x] No separate `/api/artifact` endpoint — `skills/ctrf-ingest-validation.md`, `skills/artifact-security-and-serving.md`
- [x] `Idempotency-Key` header validated as printable ASCII, 1–128 chars — `docs/planning/database-design.md §DD-019`
- [x] Route has `schema:` declaration with Zod schema for params — `skills/fastify-route-convention.md`
- [x] `CtrfReportSchema` imported from `src/modules/ingest/schemas.ts` (CTRF-001), not redefined — `skills/zod-schema-first.md`
- [x] `request.em` used throughout route handler (never `fastify.orm.em`) — `skills/mikroorm-dual-dialect.md`, `skills/fastify-route-convention.md`
- [x] Multipart file parts consumed and discarded (CTRF-003 scope) — brief §"Don't ship CTRF-003"
- [x] EventBus injected via DI seam (`options.eventBus`), defaults to `MemoryEventBus` — `docs/planning/testing-strategy.md §125`

## Forbidden-pattern scan (from CLAUDE.md)

Scan the diff for each forbidden pattern; note explicitly if none were found.

- [x] No `hx-target`/`hx-swap` inherited from a parent — N/A (API-only route, no templates in diff)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — N/A (no HTMX in diff)
- [x] No `hx-disable` anywhere in templates — N/A (no templates in diff)
- [x] No Alpine `x-data` inside an HTMX swap target (or vice versa) — N/A (no templates in diff)
- [x] No Postgres-only SQL / dialect-specific features without a SQLite equivalent — entity uses `p.integer()`, `p.string()`, `p.datetime()`, `p.manyToOne()` — all portable. Both PG and SQLite migrations present.
- [x] No DB mocked in integration tests — all 3 describe blocks use real SQLite via `buildApp({ db: tmpDbPath })`
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — N/A (API-only, no T2/T3)
- [x] No layout-token change without a T2 backdrop-contrast re-check — N/A (no CSS/layout changes)
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — auth handled by global preHandler
- [x] No Zod schema defined ad-hoc in a handler — params schema uses inline `z.object({ slug: z.string().min(1) })` which is a trivial param schema, not a body schema; the body validation uses `CtrfReportSchema` from `schemas.ts` per the single-source-of-truth rule
- [x] No `fastify.orm.em` used in any route handler — only `request.em` at `routes.ts:105`
- [x] No real AI API calls in test files — no `openai`, `anthropic`, `groq` imports in `src/__tests__/`
- [x] All integration test suites call `afterAll(() => app.close())` — all 3 describe blocks call `teardownFixture()` which calls `app.close()`
- [x] No duplicate TypeScript interface alongside Zod schema — `CtrfReport` type is `z.infer<typeof CtrfReportSchema>`, not a parallel interface
- [x] API token values never appear in log output — no `log.info/warn/error/debug` calls mentioning token or authorization in ingest module

## Verdict

**PASS** — story may proceed to Argos Phase 7 close-out and PR open.

### Notes for Argos

1. **413/429 not integration-tested** — acknowledged as NITs, not blocking. The test-handoff documents the rationale (Fastify framework-level enforcement not reachable via `app.inject()`; upstream well-tested). Accept as-is.

2. **`run.ingested` vs `run.created` naming discrepancy** — flagged by feature-implementer in handoff. Implementation correctly uses `run.ingested` per acceptance criteria. Argos should reconcile in `gaps.md` whether `run.created` (referenced in `testing-strategy.md §159` and `database-design.md §SSE`) is a distinct event or a documentation typo.

3. **PG migration hand-written** — SQLite migration was auto-generated; PG was manually written due to no PG server in the VM. CI should validate the PG migration against a real Postgres instance in the dialect matrix.

4. **Better Auth rate limiter ceiling** — tests split into 3 describe blocks to stay under the internal 10-per-10s API key verification limit. Feature-handoff suggests configuring `rateLimit: { enabled: false }` in `buildAuth()` when `testing: true` as a future improvement (Feature-implementer scope).
