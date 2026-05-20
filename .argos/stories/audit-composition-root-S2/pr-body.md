# [audit-composition-root-S2] Tighten composition-root altitude — extract AI wiring, consolidate `onClose`, admit MVP `/health` early-boot behaviour in the spec

## Summary

Closes findings #2, #4, #7, and #11 from `.argos/audits/audit-composition-root/findings.md` (Theme T6-β). Extracts the inlined AI-pipeline wiring out of `buildApp()` and into a new `wireAiPipeline()` module; consolidates five LIFO `onClose` hooks into one explicit forward-order shutdown function; removes the runtime EventBus guard (now enforced by the type system, with one inline test double tightened to match); and updates `docs/planning/architecture.md §Health endpoint` to admit MVP behaviour (connection-refused during early boot, no migration-state 503 contract) per André's authorized doc-fix override on finding #11. **Boot sequence is not restructured** — that was the explicit override on this story's kickoff line.

## Acceptance criteria

*Finding #2 — extract AI-pipeline wiring*
- [x] New module `src/services/ai/pipeline/wire.ts` exports `wireAiPipeline(app, { eventBus, aiProvider, orm })` encapsulating boot-time recovery, the three event subscriptions, and the sweeper. Returns `{ stopSweeper }`.
- [x] `buildApp()` calls it once (when `aiProvider` is configured); the five AI-pipeline imports at `src/app.ts:57–63` collapsed to a single `wireAiPipeline` import (re-exported from the pipeline barrel).

*Finding #4 — consolidate `onClose`*
- [x] The five `onClose` hooks previously registered at `src/app.ts:368/380/387/402/477` are consolidated into one explicit forward-order shutdown function at `src/app.ts:418–450`. Teardown reads top-to-bottom in execution order: sweeper → AiProvider → ArtifactStorage → EventBus → ORM.
- [x] A comment on the consolidated hook cites `architecture.md §Production Deployment → Graceful shutdown` and names the dependency-correct order.

*Finding #7 — remove the runtime EventBus guard*
- [x] The runtime check at the old `src/app.ts:410` is removed. `wireAiPipeline()` is called unconditionally when `aiProvider` is configured; the `EventBus` interface is enforced by the type system.
- [x] One inline EventBus test double in `src/__tests__/integration/health.test.ts:328–333` (which previously implemented only `close()`) is tightened to implement `publish` / `subscribe` / `close` honestly per the `EventBus` interface at `src/services/event-bus.ts:90–113`. All other EventBus test usages already used `new MemoryEventBus()` (genuinely conformant).

*Finding #11 — admit MVP `/health` early-boot behaviour in the spec (doc-fix path, per André's authorized kickoff override)*
- [x] `docs/planning/architecture.md §Health endpoint` rewritten: the boot-state table marks `booting` / `migrating` 503 rows as "Forward-compat only — unreachable in MVP" with the explanation that the server is not listening during schema sync (so probes get connection-refused, not 503). The "Schema sync window" paragraph is rewritten to remove the "503-during-sync is the real guarantee" framing; in MVP the real guarantee is `start_period: 30s` + connection-refused-while-not-listening. INFRA-005 framing preserved.
- [x] JSDoc at `src/app.ts:14–17` (top-of-file) and at the `/health` route handler (~`src/app.ts:586`) updated to match.
- [x] Boot sequence **not** restructured: `app.listen()` is still called from `src/index.ts` after `buildApp()` resolves; schema sync still runs inside `buildApp()` before the route is registered. `BootState` union retains `'migrating'` as a forward-compat hook (F's documented call; consistent with the rewritten spec).

*Cross-cutting*
- [x] `npx tsc --noEmit` — exit 0, no diagnostics.
- [x] `npx vitest run` — **500 / 500 tests pass** across 24 files (was 499 on `main`; +1 is the new wireAiPipeline unit test).
- [x] `npx eslint <changed files>` — 0 errors; 15 pre-existing `no-explicit-any` warnings unchanged from `main`.

## Test tiers

| Layer | Declared in brief | Present in diff | Notes |
|---|---|---|---|
| Unit | yes | ✓ | 1 new test in `src/__tests__/unit/wire-ai-pipeline.test.ts` — asserts the three brief-required claims (canonical `RunEvents.RUN_INGESTED`/`RUN_AI_CATEGORIZED`/`RUN_AI_CORRELATED` subscribers in the `'ai'` group; sweeper started + `stopSweeper` round-trips through `clearInterval`; no-throw on minimal stubs) |
| Integration | no | N/A | The original `/health` 503-during-sync integration test is dropped by André's override on finding #11 (the contract no longer exists in the spec). The existing AI-pipeline integration tests (`ai-categorization.test.ts` Suite 9 "EventBus subscription wiring — A1 subscribes at boot" + `ai-correlation-summary.test.ts` event-chain) are the behaviour-preservation regression guard — confirmed green in T's tier-1 check |
| E2E | no | N/A | Composition-root refactor + spec text only; no rendered routes touched |

## Page verification tiers

None — `/health` is a JSON readiness endpoint, not a rendered page. T1/T2/T2.5/T3 page tiers all N/A (brief §"Page verification: none"). T's `tier-1-report.md` documents the unit + existing-suite coverage as the headless baseline.

| Tier | Declared | Result | Report |
|---|---|---|---|
| T1 Headless | yes (unit + existing integration suite) | ✓ 500/500 | `.argos/stories/audit-composition-root-S2/tier-1-report.md` |
| T2 ARIA | N/A — JSON endpoint, not a page | — | — |
| T2.5 Authenticated State | N/A — same as T2 | — | — |
| T3 Visual | N/A — non-UI story | — | — |

## Architecture reviews

| # | Verdict | File |
|---|---|---|
| 1 | PASS (0 block, 1 warn) | `.argos/stories/audit-composition-root-S2/architecture-review-1.md` |

Iter-1 PASSed first time. The single `warn` is a naming-verb observation (`wireAiPipeline` uses `wire*` while the codebase's other composition helpers use `register*`); A explicitly judged it defensible (`register*` is reserved in this codebase for *route* registration; `wireAiPipeline()` registers event subscribers and a sweeper, not routes) and F had pre-documented the choice in the iter-1 handoff. Non-blocking.

## Decisions that deviate from spec

- **`wire*` verb on the new helper.** F chose `wireAiPipeline()` rather than `registerAiPipeline()` because `register*` in this codebase consistently means *route* registration (`registerAuthRoutes`, `ingestPlugin`-style plugin registration); `wireAiPipeline()` instead registers event-bus subscribers and starts a sweeper. A and T both signed off. Documented in `feature-handoff.md §Decisions not covered by planning docs` and in `architecture-review-1.md §Findings row 1`.
- **`'migrating'` retained in the `BootState` union.** F's documented call (brief made this F's choice). Reason: the existing test at `health.test.ts:231–244` exercises `setBootState('migrating')` and the body shape, so dropping the value would mean a test-tree edit beyond what finding #7 authorizes. The rewritten architecture.md §Health endpoint table calls the row out as "Forward-compat only — unreachable in MVP" with an explicit reason, keeping spec and code internally consistent.
- **Per-step try/catch in the consolidated `onClose`.** Not explicitly required by `architecture.md §Graceful shutdown`. F chose it so a thrown `eventBus.close()` doesn't skip the ORM close. A judged it correct on review (preserves "process is exiting either way — log the failure but finish the close sequence"). Documented in `feature-handoff.md`.
- **`wireAiPipeline()` takes the full `FastifyInstance` rather than `{ log }`-only.** F's call — matches the call shape of the existing `registerAuthRoutes(app, auth)` and leaves a one-line addition point for future pipeline introspection routes or metrics decorations. Only `app.log` is exercised today, so no extra coupling.

## Argos's non-obvious autonomous calls (full log)

See `.argos/stories/audit-composition-root-S2/decisions.md`:

- **D-1** — Branched `story/audit-composition-root-S2` from `origin/main @ 70b845d` rather than local `main`, because local `main` had a divergent unpushed `docs(agents)` commit (`7319025`) unrelated to this story. Reconciliation of local `main` is André's call when convenient.
- **D-2** — Interpreted André's "Do not restructure the boot sequence" override narrowly: it scopes finding #11 only. Findings #2 / #4 / #7 retain their original decomposition scope (they reorganize code without changing the runtime order of boot side effects). The integration test the decomposition declared for finding #11 (`/health` 503 during schema sync) was dropped from T's required tiers — the contract it would have verified no longer exists in the spec.
- **D-3** — T discovered the brief listed stale event-name strings (`run.completed` / `run.ai-categorized` / `run.ai-correlated`) — the canonical `RunEvents` constants in `src/services/event-bus.ts` are `run.ingested` / `run.ai_categorized` / `run.ai_correlated`. T followed the brief's own directive to use the constants and not invent topic names; the test is correct. No re-spawn — paperwork drift in the brief, not an implementation problem.

## Gaps filed during this story

None.

## Follow-ups (not in scope for this story)

- **`docs/planning/deployment-architecture.md` carries the stale 503-during-sync framing** at lines 54 and 139–141. The `docs/planning/*` exception authorized for this story covered only `architecture.md §Health endpoint`. F correctly flagged this rather than silently expanding scope. Needs a separate authorization for a doc-only edit pass to bring `deployment-architecture.md` into line with the new framing.
- **Orphan `MemoryEventBus` double at `src/__tests__/doubles/MemoryEventBus.ts` + its consumer `src/__tests__/unit/event-bus.contract.test.ts`** implement a different (dead, parallel) `EventBus` interface from the one at `src/lib/event-bus.ts`. Unrelated to composition-root scope; flagged for a future audit that consolidates the two interfaces.
- **Naming-verb consolidation** (`wire*` vs `register*`) — if a future audit decides one canonical verb is wanted across the codebase, this is the touch-point. Not blocking today.
- **`audit-composition-root-S1`** (PR #85) is open and edits the same file (`src/app.ts`) at non-overlapping line ranges. If #85 merges first, this branch may need a trivial rebase.
- **`audit-composition-root-S3`** is best sequenced after this story per the audit decomposition — five small consistency cleanups (typed `FastifyInstance` augmentations, `onRequest`→`preHandler` rename, redundant `/assets/` dedup, COUNT caching, inline-`/`-decision).

## Spec-enforcer verdict

_To be filled in by Argos after Phase 6.2 / Phase 6b completes._

---
_Generated from `.argos/stories/audit-composition-root-S2/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._
