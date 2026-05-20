# Tier 1 Headless Report — audit-composition-root-S2

**Executed:** 2026-05-20 11:52 UTC
**Method:** `npx vitest run` (unit + existing integration suite). No browser; no HTTP probes — this story is a composition-root refactor and the brief explicitly drops page-verification (T2/T2.5/T3) and removes the original `/health` 503-during-boot integration test per André's override on finding #11.

## Story posture (why a page-verification tier is N/A)

- The diff touches `src/app.ts` (composition root), a new `src/services/ai/pipeline/wire.ts` extraction, the AI-pipeline barrel, one test-helper tightening in `health.test.ts`, and the spec text at `docs/planning/architecture.md §Health endpoint`.
- `/health` is a JSON readiness endpoint, not a rendered page — T2/T2.5/T3 page tiers do not apply (brief §"Page verification: none").
- The behaviour-preservation regression guard for the AI-pipeline extraction is the existing AI-pipeline integration suite (`ai-categorization.test.ts` Suite 9 "EventBus subscription wiring — A1 subscribes at boot" + `ai-correlation-summary.test.ts` event-chain tests). Per the brief, T does **not** add new integration coverage — the existing suite is the guard.

## Checks

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | New unit test on `wireAiPipeline()` — three subscribers (A1/A2/A3) registered on the canonical `RunEvents.RUN_INGESTED`, `RUN_AI_CATEGORIZED`, `RUN_AI_CORRELATED` topics in the `'ai'` group; sweeper started; `stopSweeper` handle round-trips through `clearInterval` | `npx vitest run src/__tests__/unit/wire-ai-pipeline.test.ts` | 1/1 passed | 1/1 passed | ✓ |
| 2 | Full vitest suite still green (the behaviour-preservation regression guard for finding #2's extraction) | `npx vitest run` | All tests pass | **500/500 passed** across 24 files | ✓ |
| 3 | Existing AI-pipeline subscription regression test (`ai-categorization.test.ts` Suite 9 "A1 subscribes to run.ingested when aiProvider is injected") still green after the extraction | included in (2) | passes | passes | ✓ |
| 4 | Existing event-chain integration tests (`ai-correlation-summary.test.ts`) still green | included in (2) | passes | passes | ✓ |
| 5 | The tightened `EventBus` test double at `src/__tests__/integration/health.test.ts:328–333` (the test-helper edit F flagged in finding #7) still satisfies its test — `eventBusClosed === true` after `app.close()` | included in (2) — health.test.ts "DI seam close() methods are called during shutdown" | passes | passes | ✓ |
| 6 | `tsc --noEmit` clean | `npx tsc --noEmit` | exit 0, no diagnostics | exit 0, no diagnostics | ✓ |

## Test-helper tightening — spot-check

F's handoff §"Test-helper tightening" called out **one** EventBus test double that previously lied to the type system (only implementing `close()`): the inline literal at `src/__tests__/integration/health.test.ts:330` inside the "DI seam close() methods are called during shutdown" test. The double now implements `publish: () => {}` and `subscribe: () => {}` alongside `close: async () => { eventBusClosed = true; }`.

Confirmed by inspection at lines 314–348 of `health.test.ts`: the double's three methods all have signatures compatible with the `EventBus` interface at `src/services/event-bus.ts:90–113`. The test still asserts `eventBusClosed === true` after `app.close()` and passes in the full-suite run (check 2 / 5 above). No other call site silently lost capability — the four other integration tests that touch the EventBus (`ingest.test.ts`, `ai-categorization.test.ts`, `ai-correlation-summary.test.ts`, `ingest-artifacts.test.ts`) all use `new MemoryEventBus()` from `src/services/event-bus.ts` and were already honest about the interface (so they did not need to be tightened) — and all of them pass in run (2).

## Excerpt of raw output

```
 ✓ src/__tests__/integration/static-asset-auth-bypass.test.ts (31 tests) 627ms
 ✓ src/__tests__/integration/ingest.test.ts (12 tests) 1477ms
 ✓ src/__tests__/unit/scaffold.test.ts (7 tests) 249ms
 ✓ src/__tests__/unit/schema-generator-guards.test.ts (10 tests) 226ms
 ✓ src/__tests__/integration/health.test.ts (29 tests) 378ms
 ✓ src/__tests__/integration/layout.test.ts (39 tests) 473ms
 ✓ src/__tests__/integration/schema-sqlite.test.ts (18 tests) 83ms
 ✓ src/__tests__/unit/mock-ai-provider.test.ts (25 tests) 19ms
 ✓ src/__tests__/unit/ctrf-validator.test.ts (76 tests) 57ms
 ✓ src/__tests__/unit/health-schemas.test.ts (16 tests) 13ms
 ✓ src/__tests__/unit/event-bus.contract.test.ts (11 tests) 8ms
 ✓ src/__tests__/unit/ai-pipeline-schemas.test.ts (23 tests) 14ms
 ✓ src/__tests__/unit/ai-prompts.test.ts (29 tests) 7ms
 ✓ src/__tests__/unit/ai-helpers.test.ts (27 tests) 8ms
 ✓ src/__tests__/unit/ai-providers.test.ts (16 tests) 9ms
 ✓ src/__tests__/unit/artifact-storage.contract.test.ts (14 tests) 7ms
 ✓ src/__tests__/unit/wire-ai-pipeline.test.ts (1 test) 6ms
 ✓ src/__tests__/unit/entity-domain-methods.test.ts (24 tests) 6ms
 ✓ src/__tests__/unit/ai-consent-gate.test.ts (12 tests) 10ms
 ✓ src/__tests__/unit/size-limit.test.ts (13 tests) 4ms

 Test Files  24 passed (24)
      Tests  500 passed (500)
   Duration  7.58s
```

## Verdict

**PASS** — new unit test green, full suite 500/500, type-check clean, behaviour-preservation regression guards intact, test-helper tightening confirmed honest. T2/T2.5/T3 page tiers explicitly N/A per the brief.
