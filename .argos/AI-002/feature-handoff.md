# Feature Handoff — AI-002: AI pipeline A1 categorization

**Branch:** `story/AI-002`
**Commits on this branch since `main`:**
- a196056 fix(AI-002): fix SQLite affectedRows detection in categorizer and date format in recovery
- ad2c1e2 test(AI-002): add unit tests for Zod schemas, extend schema-sqlite test for ai_pipeline_log, add integration test suite for A1 categorization
- 043cb47 feat(AI-002): implement A1 categorization pipeline with reserve-execute-commit
- c83960f chore(AI-002): assign

## What was built

- **`AiPipelineLog` entity** (`src/entities/AiPipelineLog.ts`) — durable journal for AI pipeline stages per database-design.md §4.8. All columns: id, testRun (FK), stage, status, workerId, heartbeatAt, attempt, error, tokensUsed, startedAt, completedAt. Schema-generator creates the table on both dialects.
- **Organization consent column** — `aiCloudAckAt: p.datetime().nullable()` added to Organization entity for the two-gate AI consent model.
- **Consent gate** (`src/services/ai/pipeline/consent.ts`) — `isAiCloudPipelineConsented(em, orgId)` checks both `AI_CLOUD_PIPELINE=on` env var and `organizations.ai_cloud_ack_at IS NOT NULL`.
- **Zod output validation** (`src/services/ai/pipeline/schemas.ts`) — `CategorizeOutputSchema` validates LLM response shape; parse failures become recoverable errors.
- **A1 categorizer** (`src/services/ai/pipeline/categorizer.ts`) — full reserve-execute-commit lifecycle: consent gate → load failed results (cap 500, sorted by id) → idempotency check → upsert+reserve in ai_pipeline_log → heartbeat timer (15s) → batch-20 execution with setImmediate yielding → Zod validation → commit to test_results → mark done → publish `RUN_AI_CATEGORIZED`.
- **Boot-time recovery** (`src/services/ai/pipeline/recovery.ts`) — on app boot: reclaims stale-heartbeat rows (>2 min threshold), terminal-fails exhausted retries (attempt≥3), re-enqueues pending rows for runs from last 24h.
- **App wiring** (`src/app.ts`) — when `aiProvider` is injected: runs recovery before serving traffic, subscribes to `RunEvents.RUN_INGESTED` in the `'ai'` group. Guarded against minimal EventBus test doubles that lack subscribe/publish.
- **Pipeline barrel** (`src/services/ai/pipeline/index.ts`) — clean exports for all pipeline services.

### Remediation fixes (post-T1 audit)

- **Bug 1 fix (categorizer.ts:188-202):** MikroORM's SQLite driver returns `[]` for UPDATE `execute()`, not `{ affectedRows }`. Replaced broken ternary with a dual-path approach: PostgreSQL returns `{ affectedRows }` natively; SQLite falls back to `SELECT changes() as cnt`.
- **Bug 2 fix (recovery.ts:69-86):** JS `Date` object was serialized with `T` separator, breaking SQLite's text-based date comparison. Formatted `staleThreshold` as `'YYYY-MM-DD HH:MM:SS'` and wrapped both sides of the WHERE comparison with `datetime()` to normalize ISO-8601 and CURRENT_TIMESTAMP formats.

## Commands run locally (results)

- `tsc --noEmit` — 0 errors
- `npm run test` — 385 tests pass, 0 failures (18 test files)
- `npm run schema:emit:sqlite` — succeeded, shows `ai_pipeline_log` table with all expected columns
- Schema-generator creates the table correctly on both dialects

## Files created or modified

Grouped by directory. One line per file, with a short purpose note.

- `src/entities/Organization.ts` — added `aiCloudAckAt` nullable datetime column for AI consent gate
- `src/entities/AiPipelineLog.ts` — **[NEW]** durable journal entity per database-design.md §4.8
- `src/entities/index.ts` — added barrel export for `AiPipelineLog`
- `src/mikro-orm.config.sqlite.ts` — registered `AiPipelineLog` in entities array
- `src/mikro-orm.config.pg.ts` — registered `AiPipelineLog` in entities array
- `src/services/ai/pipeline/consent.ts` — **[NEW]** two-gate consent helper
- `src/services/ai/pipeline/schemas.ts` — **[NEW]** Zod schema for categorization output validation
- `src/services/ai/pipeline/categorizer.ts` — **[NEW]** A1 stage handler with reserve-execute-commit + heartbeat; fixed SQLite `affectedRows` detection
- `src/services/ai/pipeline/recovery.ts` — **[NEW]** boot-time recovery for stale/crashed pipeline rows; fixed date format for SQLite comparison
- `src/services/ai/pipeline/index.ts` — **[NEW]** barrel exports for pipeline services
- `src/app.ts` — wired EventBus subscription + recovery when aiProvider is injected

## Decisions not covered by planning docs

- **Staleness threshold: 2 minutes (not 60s).** The brief line 23 said "heartbeat_at < (NOW() - 60s)" but the brief also said "ai-features.md is canonical" — and `ai-features.md §Durability` and `ai-pipeline-event-bus.md §Boot-time recovery` both specify 2 minutes. Used 2 minutes.
- **Status enum: `done` (not `completed`).** Used the exact values from database-design.md §4.8: `pending | running | done | failed`. No `terminal_failed` value exists in the schema.
- **No UNIQUE index on (test_run_id, stage) in DDL.** MikroORM v7's `defineEntity()` doesn't support a top-level `indexes` option. The uniqueness is enforced by the `ON CONFLICT (test_run_id, stage) DO NOTHING` clause in the upsert SQL. Integration tests create it manually with `CREATE UNIQUE INDEX`. A schema-generator hook or raw DDL can be added later for production.
- **`SELECT changes()` for SQLite affectedRows.** MikroORM does not expose affected row counts for SQLite UPDATE statements via `execute()`. The `changes()` built-in scalar function is the SQLite-idiomatic approach. On PostgreSQL, the driver returns `{ affectedRows }` directly. This adjoins `skills/mikroorm-dual-dialect.md`.
- **`datetime()` normalization in recovery SQL.** Heartbeat values may be stored in either ISO-8601 (`T` separator) or `CURRENT_TIMESTAMP` format (space separator). Wrapping both sides with SQLite's `datetime()` normalizes both formats. PostgreSQL handles `timestamptz` comparison natively. This adjoins `skills/mikroorm-dual-dialect.md`.
- **EventBus guard for minimal test doubles.** The existing `health.test.ts` passes a `{ close() }` mock eventBus. Added a `typeof eventBus.subscribe === 'function'` guard so the pipeline doesn't crash when given a minimal mock.
- **`aiProvider` DI seam unchanged.** The categorizer receives `aiProvider` from app.ts, not from `process.env` — consistent with AI-001's design.
- **Error handling: transient vs terminal.** On transient error (attempt < 3): row released to `pending`, no event published — recovery will retry. On terminal error (attempt = 3): row marked `failed`, `RUN_AI_CATEGORIZED` published with `{ partial: true }` so downstream stages can still run with degraded input.

## Known issues / follow-ups

- **UNIQUE constraint on (test_run_id, stage) is enforced at the application layer only** (via ON CONFLICT in SQL). For multi-worker deployments, a DDL-level unique index should be added. Integration tests create it manually via `CREATE UNIQUE INDEX IF NOT EXISTS idx_apl_run_stage ON ai_pipeline_log (test_run_id, stage)`.
- **No stuck-stage sweeper timer** (the 60s periodic sweep from `ai-features.md §Durability`). The boot-time recovery handles the same cases at startup; the periodic sweeper is a follow-up for production robustness (could be added in AI-003 or as a chore).
- **Prompt quality for A1 is minimal** (per AI-001 feature-handoff). The categorizer uses whatever `AiProvider.categorizeFailures()` returns — prompt tuning happens in the real provider implementations.

## Next action (Test-writer)

1. Open a new session. Paste `.antigravity/agents/test-writer.md` as the first message, then this handoff as the second.
2. Check out `story/AI-002` (already on it if continuing locally).
3. Start with T1 Headless. The categorizer is not an HTTP route — test the pipeline end-to-end using `buildApp({ testing: true, db: ':memory:', eventBus: new MemoryEventBus(), aiProvider: new MockAiProvider() })`.
4. Critical test paths from the brief:
   - `AiPipelineLog` entity created on both dialects (extend `schema-sqlite.test.ts` table count to 7).
   - A1 subscribes to `run.ingested` (assert via `MemoryEventBus` subscribers or by publishing an event and checking results).
   - Reserve → execute → commit lifecycle observable in `ai_pipeline_log` rows.
   - Heartbeat advances during execution.
   - Boot-time recovery: seed a stale row, boot app, assert it's reset to pending or re-enqueued.
   - Consent gate: verify pipeline skips when `AI_CLOUD_PIPELINE` unset or `ai_cloud_ack_at` NULL.
   - Batch size 20: assert `MockAiProvider.calls[0].input.results.length === 20` for 50-result run.
   - Cap 500 failed results: assert with 600-failed fixture.
   - Publishes `run.ai_categorized` on completion.
   - **No real LLM calls** — grep test file for SDK imports, expect zero.
