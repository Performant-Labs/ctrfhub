# Feature handoff — audit-composition-root-S2

## Iteration 1

**Date:** 2026-05-20
**Branch:** `story/audit-composition-root-S2`
**Commits added this iteration:**
- `5627f7c` refactor(audit-composition-root-S2): tighten composition root altitude

### What was built / fixed

- **Finding #2** — Extracted AI-pipeline wiring into `src/services/ai/pipeline/wire.ts` (new file). The new `wireAiPipeline(app, { eventBus, aiProvider, orm })` encapsulates boot-time `recoverStalePipelineRows`, the three A1/A2/A3 `eventBus.subscribe` calls, and `startSweeper`. Returns a `{ stopSweeper }` handle so `src/app.ts` can sequence shutdown. The five AI-pipeline imports at `src/app.ts:57–63` collapsed to a single `import { wireAiPipeline } from './services/ai/pipeline/index.js'` (with a barrel re-export added).
- **Finding #4** — Consolidated the five `onClose` hooks (previously at `src/app.ts:368/380/387/402/477`) into one explicit forward-order shutdown hook. Teardown reads top-to-bottom in the order it actually executes: `sweeper → AiProvider → ArtifactStorage → EventBus → ORM`. No more reliance on Fastify's undocumented LIFO contract. Each step is wrapped in its own try/catch so one failure doesn't skip the rest. A header comment cites `architecture.md §Production Deployment → Graceful shutdown` and enumerates the order.
- **Finding #7** — Removed the runtime EventBus guard (`if (typeof eventBus.subscribe === 'function' && typeof eventBus.publish === 'function')` at the old `src/app.ts:410`). The `EventBus` interface is now enforced by the type system; `wireAiPipeline()` is called unconditionally when `aiProvider` is configured. Tightened the one lying test double (`src/__tests__/integration/health.test.ts:323`) to implement `publish` / `subscribe` / `close` (subscribe/publish as no-ops). See "Test-helper tightening" below.
- **Finding #11** — Rewrote `docs/planning/architecture.md §Health endpoint` per André's kickoff override (doc-fix path, not boot-restructure). The status-codes table now marks `booting` / `migrating` 503 rows as "forward-compat only — unreachable in MVP" with a clear explanation that the process isn't listening during schema sync so probes get connection-refused (not 503). The "Schema sync window" paragraph was rewritten to remove the "503-during-sync is the real guarantee" framing — in MVP the real guarantee is `start_period: 30s` + connection-refused-while-not-listening. INFRA-005 framing preserved. Matching JSDoc updates landed at `src/app.ts:14–17` (top-of-file) and at the `/health` route handler (~`src/app.ts:586`). Boot sequence NOT restructured — `app.listen()` still runs after schema sync, exactly as before.

### Commands run locally (results)

- `npx tsc --noEmit` — exit 0, no diagnostics
- `npx vitest run` — **499 / 499 tests pass** across 23 test files (full suite). The behaviour-preservation regression guard for the AI-pipeline extraction is the existing `ai-categorization.test.ts` Suite 9 "EventBus subscription wiring — A1 subscribes at boot" + the `ai-correlation-summary.test.ts` event-chain tests — all green.
- `npx eslint src/app.ts src/services/ai/pipeline/wire.ts src/services/ai/pipeline/index.ts src/__tests__/integration/health.test.ts` — 0 errors, 15 warnings (all pre-existing `no-explicit-any` warnings in code I did not author this iteration; `wire.ts` itself produced zero warnings).
- `timeout 8 npx tsx src/index.ts` — schema sync runs, MikroORM discovery completes (8 entities), tables created, no errors. (Killed by timeout before `app.listen` finishes its first idle window; intended.)

### Files created or modified

**Created:**
- `src/services/ai/pipeline/wire.ts` — new module exporting `wireAiPipeline()` (boot-recovery + 3 subscribers + sweeper); returns `{ stopSweeper }` for shutdown sequencing.

**Modified:**
- `src/app.ts` —
  - Collapsed the 5-import AI pipeline block to a single `wireAiPipeline` import.
  - Removed `MemoryEventBus` co-import (still imported via the value side).
  - Removed unused type imports (`RunIngestedPayload`, `AiStageEventPayload`, `RunEvents`) that no longer live here.
  - Updated top-of-file JSDoc (line ~14) to drop "503 during boot" claim.
  - Replaced inline AI-pipeline wiring (~70 LOC) with a single `wireAiPipeline()` call when `aiProvider` is set.
  - Replaced 5 separate `onClose` hooks with 1 consolidated forward-order shutdown function (citing `architecture.md §Graceful shutdown`).
  - Removed the runtime EventBus guard.
  - Updated `/health` route JSDoc to describe the MVP connection-refused-during-boot reality and explicitly note the 503 branches are retained for forward compatibility.
- `src/services/ai/pipeline/index.ts` — added `export { wireAiPipeline }` and `export type { WireAiPipelineDeps, WiredAiPipeline }`.
- `docs/planning/architecture.md` — `§Health endpoint` rewritten per finding #11 acceptance criteria (the single authorized `docs/planning/*` edit for this story, per André's kickoff override).
- `src/__tests__/integration/health.test.ts` — tightened one inline EventBus test double in the "DI seam close() methods are called during shutdown" test (line ~330) to implement the full `EventBus` interface. See "Test-helper tightening" below — this is the only test-tree edit this story authorizes.

### Decisions not covered by planning docs

- **Kept `'migrating'` in the `BootState` union (`src/modules/health/schemas.ts`).** The brief made this F's call. Rationale: (1) the existing test suite at `health.test.ts:231–244` exercises `setBootState('migrating')` and the body shape, so dropping the value would mean a test-tree edit beyond what finding #7 authorizes; (2) the rewritten architecture.md table calls the value out as a forward-compat hook and explains why it stays; (3) the `currentBootState = 'migrating'` assignment in `buildApp()` is harmless and reads as documentation of the state-machine intent. Removing it would be net-negative diff churn for zero behaviour change. Recorded here so A can confirm during architecture review.
- **Consolidated `onClose` uses per-step try/catch.** Not explicitly required by `architecture.md §Graceful shutdown` (which only enumerates the order), but the brief asked for the shutdown to be "dependency-correct as written" and a single uncaught throw mid-sequence would skip the remaining teardown steps. Wrapping each step matches the spirit of "the process is exiting either way — log the failure but finish the close sequence." A may flag this as over-engineering; if so, easy to simplify in iter 2.
- **`wireAiPipeline()` takes `app: FastifyInstance` directly** rather than the brief's alternative `{ log }`-only shape. Rationale: passing `app` matches the call shape of existing helpers like `registerAuthRoutes(app, auth)`; future expansion (e.g. registering an introspection route or decorating the app with pipeline metrics) is then a one-line addition without changing the signature. `wireAiPipeline()` only reads `app.log` today, so this is forward-compat-only — no extra coupling exercised.

### Findings addressed

| Source row | File:line | What you changed | Status |
|---|---|---|---|
| #2 (extract AI-pipeline wiring) | `src/services/ai/pipeline/wire.ts` (new); `src/app.ts:55–58, 385–397`; `src/services/ai/pipeline/index.ts:14–15` | Created `wireAiPipeline()`, re-exported from barrel, replaced the inlined block in `buildApp()` with a single call. The five AI-pipeline imports collapsed to one. | resolved |
| #4 (consolidate `onClose`) | `src/app.ts:399–450` (new consolidated hook); previously at `:368, :380, :387, :402, :477` | One explicit forward-order shutdown hook. Reads top-to-bottom in execution order; cites `architecture.md §Graceful shutdown`. | resolved |
| #7 (remove EventBus guard) | `src/app.ts` (the old `if (typeof eventBus.subscribe …)` at `:410` is gone — `wireAiPipeline()` is called unconditionally when `aiProvider` is set); `src/__tests__/integration/health.test.ts:323–333` | Guard deleted. The only EventBus-typed test double that previously implemented only `close()` is now honest about `publish` + `subscribe` (no-ops). | resolved |
| #11 (admit MVP `/health` early-boot in the spec) | `docs/planning/architecture.md §Health endpoint` (lines ~525–557); `src/app.ts:14–17, ~584–602` | Spec rewritten per André's override (doc-fix, not boot-restructure). JSDocs follow suit. `'migrating'` stays in the union — see Decisions. | resolved |

### Test-helper tightening (for T's awareness)

Finding #7 required tightening any EventBus-typed double that only implemented `close()`. **One was found:**

- **`src/__tests__/integration/health.test.ts`**, in the "DI seam close() methods are called during shutdown" test (around line 320). The inline `eventBus: { close: async () => { ... } }` literal lied to the type system — it satisfied the slot only because of the now-deleted runtime guard. **Tightened** to `eventBus: { publish: () => {}, subscribe: () => {}, close: async () => { ... } }`. No assertions changed; the test still verifies `eventBusClosed === true` after `app.close()`.

Other EventBus usages in the test tree (`src/__tests__/integration/ingest.test.ts`, `ai-categorization.test.ts`, `ai-correlation-summary.test.ts`, `ingest-artifacts.test.ts`) all use `new MemoryEventBus()` from `src/services/event-bus.ts` and were already honest about the interface — no edits there.

The orphan double at `src/__tests__/doubles/MemoryEventBus.ts` and its consumer `src/__tests__/unit/event-bus.contract.test.ts` implement a **different** `EventBus` interface (the dead parallel one at `src/lib/event-bus.ts`); they are unrelated to the composition root's EventBus and out of finding-#7 scope. Flagged here in case a future audit decides to consolidate the two interfaces.

### Known issues / follow-ups

- **`docs/planning/deployment-architecture.md` repeats the stale 503-during-sync framing** at lines 54 and 139–141 ("/health is readiness-shaped: returns 503 during boot/migration…" and "the real migration guarantee is the 503 contract"). The brief explicitly told me to **flag rather than edit** when other planning docs carry the same now-stale framing (the `docs/planning/*` exception covered only `architecture.md §Health endpoint`). André should authorize a separate edit pass for `deployment-architecture.md` if he wants the framing aligned across docs.
- **Pre-existing tsc/eslint warnings remain.** 15 `@typescript-eslint/no-explicit-any` warnings in `src/app.ts` and `src/__tests__/integration/health.test.ts` are unchanged from `main`. None were introduced by this story.
- **PR #85 (`audit-composition-root-S1`) is still open** and touches the same file (`src/app.ts`) but at non-overlapping line ranges (~226–229 rate-limit and ~569–582 auth API-key branch — both in S1; this story did not touch those lines). If #85 merges to `main` before this story does, this branch may need a trivial rebase but should not produce content conflicts.
- **Sweeper-stop is synchronous in the consolidated onClose.** `startSweeper()` returns `() => void`, so `stopSweeper()` is called without `await`. If a future refactor makes it return a `Promise`, the consolidated hook needs the `await`. Currently correct.
