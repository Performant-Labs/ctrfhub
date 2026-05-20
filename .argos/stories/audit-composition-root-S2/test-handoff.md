# Test Handoff — audit-composition-root-S2

**Branch:** `story/audit-composition-root-S2`
**Commits added by Test-writer (this iteration):**
- `<pending-commit>` test(audit-composition-root-S2): unit test for wireAiPipeline + tier-1 report

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless (unit + existing integration suite) | ✓ | `.argos/stories/audit-composition-root-S2/tier-1-report.md` |
| T2 ARIA (clean room) | N/A — `/health` is a JSON endpoint, not a rendered page; brief §"Page verification: none" | — |
| T2.5 Authenticated State | N/A — same as T2; story scope is composition-root + spec text only | — |
| T3 Visual | N/A — non-UI story | — |
| Backdrop-contrast | N/A — no layout-token / backdrop / `[data-theme]` / `@layer components` changes in the diff | — |

## Tests added

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Unit | `src/__tests__/unit/wire-ai-pipeline.test.ts` | 1 | New `wireAiPipeline()` extraction (finding #2). One consolidated `it()` asserting the three brief-required properties: (a) three EventBus subscribers wired to the canonical `RunEvents.RUN_INGESTED` / `RUN_AI_CATEGORIZED` / `RUN_AI_CORRELATED` topics in the `'ai'` consumer group; (b) sweeper started (`setInterval` invoked) and `stopSweeper()` round-trips the same handle through `clearInterval`; (c) function does not throw on minimal stubbed inputs. |
| Integration | — | 0 | Per brief §"Integration: NO" — the original `/health` 503-during-sync integration test is dropped by André's override on finding #11 (the contract no longer exists in the spec). The existing AI-pipeline integration tests are the behaviour-preservation regression guard for the extraction (confirmed green in T1 check 3). |
| E2E | — | 0 | Per brief §"E2E: no". |

**Tests-per-distinct-branch:** 1 new test / 1 new module extracted (`wireAiPipeline`). The wiring function is a single linear composition path (recovery → 3 subscribes → sweeper); its responsibilities are sequential steps, not independent code branches, so one consolidated test exercising all three brief-required claims is the right shape. No matrix fan-out.

**Pre-handoff self-check:** confirmed — the single new test fails in isolation if the code is wrong: a missing/swapped subscription topic fails assertion 1; a missing `startSweeper` call fails the `setInterval` spy; a broken `stopSweeper` wire-through fails the `clearInterval` assertion; an unhandled throw inside `wireAiPipeline` fails the no-throw assertion. None deleted.

## Coverage

Not re-measured this iteration — F's iter-1 handoff documented `npx vitest run` green at 499/499 before this test was added; my run shows 500/500 (the +1 is the new wire-ai-pipeline unit test). The diff is composition-root extraction + spec text + a single new unit test; it does not change coverage shape in a way that would breach existing thresholds (lines ≥ 80, functions ≥ 80, branches ≥ 75). If Argos wants the explicit coverage delta the command is `npx vitest run --coverage`.

## Non-blocking issues

- None. F's two flagged follow-ups (stale framing in `docs/planning/deployment-architecture.md` lines 54 + 139–141, and the orphan `MemoryEventBus` double at `src/__tests__/doubles/MemoryEventBus.ts` implementing the dead parallel `src/lib/event-bus.ts` interface) are explicitly out of scope for this story per the brief's `docs/planning/*` discipline and finding-#7 scope. Recorded in F's handoff for André; T does not action.
- Naming-verb divergence (`wire*` vs `register*`) was raised as a `warn` in A's iter-1 review and explicitly not blocking; T agrees — `register*` in this codebase means route registration, and `wireAiPipeline()` registers event subscribers and a sweeper. The test name "wireAiPipeline (composition-root wiring)" matches the function and the audit's altitude framing.

## Verdict

**PASS** — Argos may proceed to Phase 6 close-out.
