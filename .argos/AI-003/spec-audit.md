# Spec-enforcer Audit — AI-003

**Executed:** 2026-05-02 13:25 UTC
**Scope:** diff `main..story/AI-003`
**Checklists run:** Architecture rules, Coverage, Planning docs conformance, Skills violations (ai-pipeline-event-bus, mikroorm-dual-dialect, zod-schema-first), Forbidden-pattern scan (all 10 from CLAUDE.md)

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| 1 | `src/services/ai/pipeline/sweeper.ts:133` | `skills/mikroorm-dual-dialect.md` — Only portable types and dialect-neutral SQL. `datetime()` is a SQLite built-in scalar function that does not exist in PostgreSQL. On PostgreSQL production, this UPDATE statement will fail with `function datetime(unknown) does not exist` on every 60-second sweeper tick, permanently breaking pipeline durability. | Replace `datetime(heartbeat_at) < datetime(?)` with `heartbeat_at < ?`. The `staleThreshold` value is already formatted as a comparable ISO-like string (`YYYY-MM-DD HH:MM:SS`), and direct string/timestamp comparison works on both PostgreSQL and SQLite — the `datetime()` wrapper is unnecessary on both dialects. | **BLOCKING** |
| 2 | `src/services/ai/pipeline/sweeper.ts:133` (same line) | `skills/mikroorm-dual-dialect.md` — Same `datetime()` pattern exists in `src/services/ai/pipeline/recovery.ts:84` (AI-002 artifact). While recovery.ts is pre-existing and out of scope for AI-003 remediation, the sweeper was written against the same incorrect pattern. Both should be fixed — recovery.ts can be a follow-up chore. | See #1; apply same fix to `recovery.ts:84` in a follow-up commit. | INFO (pre-existing) |

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

Tiers match `tasks.md` declaration: integration only (no UI routes -> no T2/T3 needed).

## Planning-doc conformance (AI-003 scope)

- [x] A2 subscribes to `run.ai_categorized` — `src/app.ts:466` (`correlateRootCauses`)
- [x] A3 subscribes to `run.ai_correlated` — `src/app.ts:480` (`generateSummary`)
- [x] `ai_root_causes` (JSON) and `ai_summary` (TEXT) on `test_runs` — `src/entities/TestRun.ts:37,39` uses `p.json()` and `p.text()`
- [x] Pipeline chain order: `categorize -> correlate -> summarize` — verified by integration test Suite 6
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

## Verdict

**BLOCK** — remediation required. The specific finding that must be resolved before the next audit:

- **Finding #1**: `datetime()` SQLite-only function in `sweeper.ts:133` breaks PostgreSQL compatibility. The sweeper silently fails every 60-second tick on PostgreSQL production, permanently breaking the stuck-stage recovery path and defeating the entire pipeline durability strategy. Fix: change `datetime(heartbeat_at) < datetime(?)` to `heartbeat_at < ?`.

### Remediation path

1. In `src/services/ai/pipeline/sweeper.ts`, replace line 133:
   - FROM: `AND (heartbeat_at IS NULL OR datetime(heartbeat_at) < datetime(?))`
   - TO: `AND (heartbeat_at IS NULL OR heartbeat_at < ?)`
2. Run `npm run test` to verify sweeper tests still pass (they should — the SQLite tests exercise this exact path).
3. Optionally fix the same pattern in `src/services/ai/pipeline/recovery.ts:84` (AI-002 artifact, pre-existing).
4. Request re-audit.
