# [AI-002] AI pipeline A1 categorization (Feature 3)

## Summary

Wires the A1 per-test categorization stage into the AI pipeline. Adds the durable `ai_pipeline_log` journal table, extends `TestResult` with four `ai_category*` columns, and implements the reserve-execute-commit lifecycle with heartbeat + boot-time recovery. The categorizer subscribes to `RunEvents.RUN_INGESTED`, runs failed results through the injected `AiProvider` in batches of 20 (cap 500/run), validates output via Zod, commits results back to `TestResult`, and publishes `RunEvents.RUN_AI_CATEGORIZED`. Two-gate consent (`AI_CLOUD_PIPELINE` env + `organizations.ai_cloud_ack_at`) silently skips when either gate is closed. No real LLM calls in any test — `MockAiProvider` exclusively.

## Acceptance criteria

Verbatim from `docs/planning/tasks.md §AI-002` (terminology read as schema-generator-equivalent post-INFRA-005 — no migration files):

- [x] `ai_pipeline_log` table created on both dialects (via schema-generator from `AiPipelineLog` entity)
- [x] A1 stage subscribes to `run.ingested`
- [x] Reserve-execute-commit pattern implemented
- [x] Heartbeat every 15 s while `status='running'`
- [x] Boot-time recovery query (stale heartbeat → pending; exhausted retries → failed; pending re-enqueued)
- [x] Privacy/consent gate (`AI_CLOUD_PIPELINE` + `organizations.ai_cloud_ack_at`)
- [x] Batch size 20, cap 500 failed results per run
- [x] `ai_category`, `ai_category_override`, `ai_category_model`, `ai_category_at` columns on `test_results`
- [x] Publishes `run.ai_categorized` on completion
- [x] Integration tests use `MockAiProvider`
- [x] No real API calls in tests

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | yes (consent gate, schemas) | ✓ | 35 tests across `src/__tests__/unit/ai-consent-gate.test.ts` (12) + `src/__tests__/unit/ai-pipeline-schemas.test.ts` (23) |
| Integration | yes (`MockAiProvider`) | ✓ | 19 tests in `src/__tests__/integration/ai-categorization.test.ts` + 2 additions to `schema-sqlite.test.ts` |
| E2E | no | N/A | No rendered routes |

Total suite: **403 tests pass / 19 files / 0 failures**. `tsc --noEmit` clean.

## Page verification tiers

| Tier | Declared | Result | Report location (story branch) |
|---|---|---|---|
| T1 Headless | yes | ✓ (20 integration checks + 12 unit checks) | `.argos/AI-002/tier-1-report.md` |
| T2 ARIA (clean room) | no — pipeline only, no rendered routes | N/A | — |
| T2.5 Authenticated State | no — no rendered routes | N/A | — |
| T3 Visual | no — non-UI story | N/A | — |

## Decisions that deviate from spec

Surfaced for André's review. All have been evaluated by Spec-enforcer (verdict PASS).

- **Staleness threshold = 2 minutes (not 60s)** — `recovery.ts`. Brief line 23 said 60s; both `ai-features.md §Durability` and `skills/ai-pipeline-event-bus.md §Boot-time recovery` specify 2 minutes. Used 2 min per the canonical docs.
- **Status enum is `pending | running | done | failed`** — `AiPipelineLog.ts`. Matches `database-design.md §4.8`. The brief used `terminal_failed` informally; the canonical schema uses `failed`.
- **Coverage thresholds: lines 82.62% ✓, branches 83.77% ✓, functions 74.57% ✗** — pre-existing miss from AI-001 real-provider files (~31% function coverage in `src/services/ai/providers/`). Not introduced by AI-002. AI-002-specific files are 90–100% function coverage. Already addressed by #32's threshold/exclusion change for the SDK wrappers.
- **NIT from spec-audit (Finding #1)** — `src/services/ai/pipeline/recovery.ts:84` uses SQLite-specific `datetime()` to normalize ISO-8601 vs `CURRENT_TIMESTAMP` strings. Will need replacement before the first PostgreSQL deployment (PG handles `timestamptz` comparison natively). Tracked as a follow-up; no impact today since all integration paths are SQLite `:memory:`.
- **UNIQUE on `(test_run_id, stage)` enforced via `ON CONFLICT` SQL, not DDL** — MikroORM v7 `defineEntity()` doesn't expose top-level `indexes`. Application-layer enforcement is sufficient for current single-worker deployments; tests create the index via raw `CREATE UNIQUE INDEX IF NOT EXISTS`. DDL hook is a multi-worker follow-up.
- **`SELECT changes()` fallback for SQLite affectedRows** — `categorizer.ts`. MikroORM SQLite driver returns `[]` (not `{ affectedRows }`) for UPDATE `execute()`. Dual-path: PG uses `affectedRows`, SQLite falls back to `SELECT changes()`. Adjoins `skills/mikroorm-dual-dialect.md`.
- **EventBus shape guard** — `app.ts` checks `typeof eventBus.subscribe === 'function'` before subscribing. Defensive against minimal `{ close() }` test doubles (e.g., `health.test.ts`).
- **Error handling: transient (attempt < 3) releases to `pending` without event; terminal (attempt = 3) marks `failed` and publishes `RUN_AI_CATEGORIZED` with `{ partial: true }`** — `categorizer.ts`. Lets downstream stages run with degraded input on terminal failure.

## Gaps filed during this story

- none

## Spec-enforcer verdict

**PASS** — see `.argos/AI-002/spec-audit.md`
**Date:** 2026-04-26

## Next assignable stories (after this merges)

- `AI-003` — A2 root-cause correlation + A3 run narrative (deps AI-002 — unblocks once this lands)
- `CTRF-003` — Artifact co-upload with ingest (deps CTRF-002 ✅ — assignable now, no AI-002 dependency)
- `CTRF-004` — CI reporter packages (deps CTRF-002 ✅ — assignable now)
- `DATA-001` — Data retention nightly job (deps CTRF-002 ✅ — assignable now)

---
_Generated from `.argos/AI-002/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._
