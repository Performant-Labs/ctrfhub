# Spec-enforcer Audit — AI-003

**Executed:** 2026-05-02 20:59 UTC (re-audit after datetime() fix)
**Scope:** diff `main..story/AI-003`
**Prior audit:** a5a0521 (BLOCK — `datetime()` SQLite-only function)
**Fix commits:** 93ffe33 (replace `datetime()` with raw `heartbeat_at` comparison), 28b5237 (remove unused variable)
**Checklists run:** Architecture rules, Coverage, Planning docs conformance, Skills violations (ai-pipeline-event-bus, mikroorm-dual-dialect, zod-schema-first), Forbidden-pattern scan (all 10 from CLAUDE.md)

## Findings

### Previously BLOCKING — now RESOLVED

| # | File:Line | Rule (cite source) | Verdict |
|---|---|---|---|
| 1 | `src/services/ai/pipeline/sweeper.ts:132` | `skills/mikroorm-dual-dialect.md` — `datetime()` SQLite-only function replaced with `heartbeat_at < ?` using a JS-computed ISO-like threshold string (portable across SQLite and PostgreSQL). | **RESOLVED** — commit 93ffe33 |
| 2 | `src/services/ai/pipeline/recovery.ts:70` | `skills/mikroorm-dual-dialect.md` — Same `datetime()` pattern removed from `recovery.ts:84` (AI-002 artifact). Replaced with `heartbeat_at < ?` using the same JS-computed threshold pattern. Comment updated to reflect the fix. | **RESOLVED** — commit 93ffe33 (fixed alongside sweeper) |

### New findings

**None.** Zero new findings after full re-scan of the diff against main.

## Verification evidence

| Test | Result |
|---|---|
| `grep -rn 'datetime(' src/services/ai/pipeline/ --include='*.ts'` | 1 hit — comment in `recovery.ts:62` explaining the fix. Zero functional `datetime()` calls. |
| `tsc --noEmit` | 0 errors |
| `vitest run` (AI-003 tests: `ai-correlation-summary` + `ai-categorization`) | 34 passed, 0 failed |
| `git diff main...HEAD` pipeline files | No `datetime()` calls, no dialect-specific SQL, no forbidden patterns |
| `git diff 93ffe33..28b5237` (post-fix commits) | Only removal of unused `running` variable in sweeper — zero behavioral changes |

## Coverage gaps

No coverage gaps detected. Integration test file `src/__tests__/integration/ai-correlation-summary.test.ts` (755 lines, 15 tests) covers all story acceptance criteria and declared test tiers:

| Criterion | Covered by |
|---|---|
| A2 subscribes to `run.ai_categorized` | Suite 6 (Event chain) — publishes `RUN_AI_CATEGORIZED`, asserts A2 called |
| A3 subscribes to `run.ai_correlated` | Suite 6 — asserts A3 called after A2 publishes |
| `ai_root_causes` / `ai_summary` columns populated | Suites 1, 2 — asserts column values after handler execution |
| Pipeline chain order verified | Suite 6 — asserts `corrIdx < sumIdx` |
| `partial: true` downstream propagation | Suite 3 — 3 tests covering upstream `unknown` fallback, A2 terminal fail, A3 cluster skip |
| Stuck-stage sweeper (60s, attempt >= 3) | Suite 5 — 3 tests: terminal-fail running, release stale, terminal-fail pending |
| `MockAiProvider` used exclusively | Suite 7 — static import check; all other suites use `buildApp({ aiProvider: new MockAiProvider() })` |

Tiers match `tasks.md` declaration: integration only (no UI routes → no T2/T3 needed).

## Planning-doc conformance (AI-003 scope)

- [x] A2 subscribes to `run.ai_categorized` — `src/app.ts:466` (`correlateRootCauses`)
- [x] A3 subscribes to `run.ai_correlated` — `src/app.ts:480` (`generateSummary`)
- [x] `ai_root_causes` (JSON) and `ai_summary` (TEXT) on `test_runs` — `src/entities/TestRun.ts:37,39` uses `p.json()` and `p.text()`
- [x] Pipeline chain order: `categorize → correlate → summarize` — verified by integration test Suite 6
- [x] Downstream stages run with `partial: true` on upstream terminal failure — `src/app.ts:477-478`, Suite 3
- [x] Stuck-stage sweeper: 60s interval, terminal-fail at `attempt >= 3` — `src/services/ai/pipeline/sweeper.ts:33,79,145`
- [x] Reserve-execute-commit pattern — `correlator.ts:129-228`, `summarizer.ts:185-285`
- [x] Idempotency guard (check output column, not re-call LLM) — `correlator.ts:112-127`, `summarizer.ts:98-127`
- [x] Heartbeat every 15s — `correlator.ts:38,174`, `summarizer.ts:35,226`
- [x] Consent gate (env `AI_CLOUD_PIPELINE` + per-org `ai_cloud_ack_at`) — `correlator.ts:100-101`, `summarizer.ts:94-95`
- [x] Schema-generator creates columns for both dialects (no migration files) — both use `updateSchema()` at boot
- [x] `AiStageEventPayload` type in `event-bus.ts` with `partial?: boolean` — `src/services/event-bus.ts:65-72`
- [x] Zod schemas for A2/A3 output validation — `src/services/ai/pipeline/schemas.ts:67-107`
- [x] `MockAiProvider` exclusively in tests — no real AI SDK imports (verified by Suite 7 + grep scan)
- [x] No `fastify.orm.em` in request handlers — pipeline stages receive `orm` via parameter injection
- [x] All integration test suites close the app — verified across all 7 suites
- [x] Dialect-neutral SQL throughout — `heartbeat_at < ?` with JS-computed threshold (both sweeper and recovery), `CURRENT_TIMESTAMP`, `ON CONFLICT DO NOTHING`, `COALESCE`, `NULLIF` — all standard SQL

## Forbidden-pattern scan (from CLAUDE.md)

- [x] No `hx-target`/`hx-swap` inherited from a parent in changed templates
- [x] No raw HTMX event name strings outside `src/client/htmx-events.ts` — uses `RunEvents.*` constants
- [x] No `hx-disable` anywhere in templates
- [x] No Alpine `x-data` inside an HTMX swap target (in AI-003 changed files)
- [x] No Postgres-only SQL/dialect-specific features in entity files — `p.json()` not `p.jsonb()`
- [x] No DB mocked in integration tests — uses `buildApp({ db: ':memory:' })` with real SQLite
- [x] No T3 visual assertions without corresponding T2 ARIA assertions (no T3 assertions in this story)
- [x] No layout-token/backdrop change (no UI changes)
- [x] No raw CSRF-token or session-cookie handling outside Better Auth
- [x] No Zod schema defined ad-hoc in a handler — schemas in `src/services/ai/pipeline/schemas.ts`
- [x] No `datetime()` SQLite-only function calls anywhere in pipeline SQL

## Verdict

**PASS** — zero findings. The single BLOCKING finding from the prior audit (a5a0521) is resolved:

- **Finding #1**: `datetime()` in `sweeper.ts:133` → replaced with dialect-neutral `heartbeat_at < ?` at commit 93ffe33.
- **Finding #2** (INFO, pre-existing): `datetime()` in `recovery.ts:84` → also replaced with dialect-neutral `heartbeat_at < ?` at commit 93ffe33.

The fix is confirmed working: all 34 AI pipeline tests pass, `tsc` produces zero errors, and a full forbidden-pattern re-scan across the entire diff detects zero new issues.

Story `AI-003` is green for merge.