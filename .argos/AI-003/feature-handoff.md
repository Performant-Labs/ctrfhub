# Feature Handoff — AI-003: AI pipeline A2 + A3

**Branch:** `story/AI-003`
**Commits on this branch since `main`:**
- 6a2b644 feat(AI-003): add A2 root-cause correlation and A3 run narrative pipeline stages
- dbb6d0f chore(AI-003): assign

## What was built

- A2 root cause correlation stage (`correlator.ts`) — subscribes to `run.ai_categorized`, calls `AiProvider.correlateRootCauses()`, writes clusters to `test_runs.ai_root_causes`, publishes `run.ai_correlated`
- A3 run narrative summary stage (`summarizer.ts`) — subscribes to `run.ai_correlated`, calls `AiProvider.generateRunSummary()`, writes summary to `test_runs.ai_summary`, publishes `run.ai_summarized`
- Stuck-stage sweeper (`sweeper.ts`) — 60s periodic timer that terminal-fails stuck `running` rows (attempt >= 3) and releases stale-heartbeat rows (attempt < 3) back to `pending`
- Zod schemas for A2 (`CorrelateOutputSchema`) and A3 (`SummaryOutputSchema`) output validation
- `AiStageEventPayload` type in `event-bus.ts` for typed downstream AI event payloads (includes `partial?: boolean`)
- Wiring in `app.ts`: A2 subscribes to `RUN_AI_CATEGORIZED`, A3 subscribes to `RUN_AI_CORRELATED`, sweeper starts and stops on app lifecycle
- `partial: true` propagation: downstream stages handle degraded input when upstream terminally fails

## Commands run locally (results)

- `tsc --noEmit` — 0 errors
- `npm run test` (21 test files) — 452 passed, 0 failed
- Schema-generator: columns `ai_root_causes` (JSON) and `ai_summary` (TEXT) already present on `test_runs` entity (created in AI-002)

## Files created or modified

- `src/services/ai/pipeline/correlator.ts` — A2 root cause correlation stage handler (reserve-execute-commit + heartbeat)
- `src/services/ai/pipeline/summarizer.ts` — A3 run narrative summary stage handler (reserve-execute-commit + heartbeat)
- `src/services/ai/pipeline/sweeper.ts` — 60s periodic stuck-stage sweeper (3-phase tick)
- `src/services/ai/pipeline/schemas.ts` — Added `CorrelateOutputSchema` and `SummaryOutputSchema` Zod schemas
- `src/services/ai/pipeline/index.ts` — Added exports for `correlateRootCauses`, `generateSummary`, `startSweeper`, and new schemas
- `src/services/event-bus.ts` — Added `AiStageEventPayload` interface (`{ runId, orgId, partial? }`)
- `src/app.ts` — wired A2/A3 EventBus subscriptions + sweeper lifecycle

## Decisions not covered by planning docs

- `AiStageEventPayload` type added to `event-bus.ts` as the shared payload shape for `RUN_AI_CATEGORIZED`, `RUN_AI_CORRELATED`, and `RUN_AI_SUMMARIZED`. This avoids ad-hoc payloads per stage. The `partial` flag is optional — downstream handlers default to `false` when absent.
- A3 summarizer loads the previous run's pass rate via a raw SQL query (rather than through a service) because the computation is internal to the A3 stage and not reusable elsewhere.
- A2 correlator treats results without A1 categories (due to `partial: true` upstream) as `'unknown'` category — per `AiCategory` type, this is the appropriate fallback.
- **None of these contradict the spec or skills — every choice is an implementation detail within the prescribed pattern.**

## Known issues / follow-ups

- `src/modules/setup/` directory exists as untracked files on this branch with TypeScript errors unrelated to AI-003 — the Test-writer should exclude this directory from their test run
- `packages/` and `examples/` directories are also untracked and unrelated
- A4 `detectAnomalies` subscribes to `run.ai_summarized` — event is published but handler is Phase 2

## Next action (Test-writer)

1. Open a new session. Paste `.antigravity/agents/test-writer.md` as the first message, then this handoff as the second.
2. Check out `story/AI-003` (already on it if continuing locally).
3. Start with T1 Headless. Routes to focus on: N/A (pipeline only — test the pipeline stages via `buildApp({ aiProvider: new MockAiProvider(), eventBus: new MemoryEventBus() })`). Tier-report templates are in `.antigravity/agents/test-writer.md`.
4. Integration tests required: A2 correlation (both partial and full), A3 summary generation (both partial and full), stuck-stage sweeper tick behavior, event chain ordering (categorize → correlate → summarize), terminal-fail downstream propagation. Use `MockAiProvider` exclusively — no real LLM calls.
