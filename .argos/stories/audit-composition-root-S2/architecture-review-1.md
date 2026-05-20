# Architecture review — audit-composition-root-S2 — iteration 1

**Reviewer:** architecture-reviewer (Claude Opus 4.7) — review mode
**Date:** 2026-05-20
**Verdict:** PASS
**Diff base:** main @ 70b845d
**Diff head:** story/audit-composition-root-S2 @ ecf30f7

## Summary

PASS. F's refactor cleanly closes findings #2, #4, #7, and #11 from the composition-root audit at the right altitudes: the AI pipeline is extracted into `src/services/ai/pipeline/wire.ts` behind a single `wireAiPipeline(app, deps)` call (collapsing five imports to one in `app.ts`); the five `onClose` hooks are consolidated into one explicit forward-order shutdown that reads top-to-bottom in execution order (sweeper → AiProvider → ArtifactStorage → EventBus → ORM) with a comment citing `architecture.md §Graceful shutdown`; the runtime `EventBus` guard is gone and the one lying test double is genuinely tightened against the interface; and the §Health endpoint rewrite stays within André's authorized scope (no other `docs/planning/*` edits) while accurately reframing the MVP connection-refused-during-boot reality. No `block` findings; one minor `warn` on naming-verb divergence (`wire*` vs the codebase's `register*` convention) that is justified by the function's distinct responsibility and explicitly defended in F's handoff — explicitly not blocking.

## Findings

| # | Severity | File:line | Drift dimension | Finding | Suggested fix |
|---|---|---|---|---|---|
| 1 | warn | `src/services/ai/pipeline/wire.ts:88` | naming convention | The new helper uses the verb `wire*` while neighbouring composition helpers use `register*` (`registerAuthRoutes`, `ingestPlugin`). This is the only `wire*` function in the codebase. The divergence is defensible — `register*` is reserved in this codebase for route registration, and `wireAiPipeline()` registers event subscribers and a sweeper, not routes — and F documents the call deliberately. Not blocking. If a future audit consolidates to one verb, `wire*` is the honest choice for this surface area; otherwise leaving it as-is is fine. | No action required; flagged for the record. |

## Prior-iteration check (iteration > 1 only)

N/A — this is iteration 1.

## Notes for the implementer (BLOCK only)

N/A — verdict is PASS.

## Patterns referenced

The new code was compared against these existing files / spec sections:

- `src/modules/auth/routes.ts` — `registerAuthRoutes(fastify, auth)` signature shape (instance-first, deps-after). `wireAiPipeline(app, deps)` mirrors this. ✓
- `src/modules/ingest/routes.ts` — Fastify plugin style for a self-contained module. Confirms the convention that composition-root altitude only sees one entry point per module. ✓
- `src/services/event-bus.ts` — `EventBus` interface (`publish(topic, payload): void`, `subscribe(group, topic, handler): void`, `close(): Promise<void>`). The tightened test double in `health.test.ts:330` implements all three honestly. ✓
- `src/services/ai/pipeline/sweeper.ts:63` — `startSweeper(...): () => void` signature confirms the sync `stopSweeper()` call in the consolidated `onClose` is correct (no missing `await`). F's known-issue note about a future async-sweeper guarding the call site is good forward-compat documentation. ✓
- `docs/planning/architecture.md §Graceful shutdown` (lines 366–413) — canonical teardown order. The consolidated `onClose` cites it; the order written in the hook (sweeper → AiProvider → ArtifactStorage → EventBus → ORM) is a dependency-correct refinement of the spec's logical sequence (stop new work → drain dependents → close DB last). ✓
- `docs/planning/architecture.md §Layering and Dependency Direction` — "`buildApp()` is the composition root; internal wiring lives in its module." The extraction respects this: composition root no longer knows the A1/A2/A3 stage names or the existence of a sweeper; it sees one function and one handle. ✓

## Detailed observations (for the record)

These are the audit-dimension checks the brief asked for, all green:

1. **Layering / dependency direction.** `wireAiPipeline` lives in `src/services/ai/pipeline/`, not at composition-root altitude. Composition root imports the single entry point from the pipeline barrel. The function explicitly does NOT register an `onClose` itself (per the JSDoc at `wire.ts:22–27`) — shutdown sequencing remains in `app.ts`. Invariant respected: `buildApp()` owns the seams and the close sequence; pipeline modules own their wiring. ✓

2. **Abstraction altitude — interface shape.** `WireAiPipelineDeps = { eventBus, aiProvider, orm }` is the smallest input set: the three runtime dependencies the pipeline actually needs. Return type `WiredAiPipeline = { stopSweeper: () => void }` exposes only what the composition root needs for shutdown. No leakage of internal pipeline concepts (`categorizeRun`, `recoverStalePipelineRows`, etc.) back to the caller. ✓

3. **Pattern consistency with neighbours.** `wireAiPipeline(app, deps)` — instance-first, deps-after — matches `registerAuthRoutes(fastify, auth)`. Module path `src/services/ai/pipeline/wire.ts` matches the established sibling file layout (`recovery.ts`, `sweeper.ts`, `categorizer.ts`). Barrel re-export added to `src/services/ai/pipeline/index.ts:16–17`. ✓ (Naming-verb divergence noted as `warn` row 1 above — non-blocking.)

4. **Teardown order in consolidated `onClose`.** Read top-to-bottom at `src/app.ts:418–450`:
   - L419–425: `stopSweeper()` if present
   - L426–432: `await aiProvider.close()` if present
   - L433–439: `await artifactStorage.close()` if present
   - L440–444: `await eventBus.close()`
   - L445–449: `await orm.close()`
   
   This is exactly the order the comment claims (sweeper → AiProvider → ArtifactStorage → EventBus → ORM). Per-step try/catch ensures one failure doesn't skip the rest, which matches the "process is exiting either way" reality. F's handoff flags this as potentially over-engineered; in my reading it's correct — a thrown `eventBus.close()` shouldn't prevent the DB pool from closing, and the alternative (one big try/catch wrapping everything) would silently swallow the location of the failure. The current shape gives a log per failure with the right context. Keep. ✓

5. **EventBus test-double tightening.** `src/__tests__/integration/health.test.ts:328–333` — the double now implements `publish: () => {}` and `subscribe: () => {}` alongside `close: async () => {…}`. Cross-checked against the `EventBus` interface at `src/services/event-bus.ts:90–113`: `publish(topic, payload): void` and `subscribe(group, topic, handler): void` are both `void`-returning; the no-op arrow functions satisfy both signatures. F is genuinely making the double conformant, not shaving the interface. The added comment at L315–321 documents the change and points to this story. ✓

6. **`architecture.md §Health endpoint` rewrite — accuracy.** The new text accurately describes MVP behaviour: `app.listen()` is called from `index.ts` only *after* `buildApp()` resolves (confirmed via inspection — schema sync at `app.ts:343` precedes the `/health` route registration at `app.ts:605`, both inside `buildApp()`). A probe arriving during schema sync therefore gets connection-refused, not a 503. The status-codes table marks `booting`/`migrating` rows as "Forward-compat only — unreachable in MVP" with the correct explanation. The "Schema sync window" paragraph correctly identifies `start_period: 30s` + connection-refused as the actual MVP guarantee. INFRA-005 framing is preserved. ✓

7. **`architecture.md` edit confined to the authorized scope.** `git diff --name-only` on the docs tree shows only `docs/planning/architecture.md` changed. The three hunks are all within the Health endpoint section (lines ~526–558). No other `docs/planning/*` files touched. André's authorization (one section in one file) is respected. F correctly flagged `docs/planning/deployment-architecture.md` (which still carries the stale 503-during-sync framing) as needing a *separate* authorization rather than silently expanding scope — that is the right call per `docs/planning/*` discipline. ✓

8. **`'migrating'` stays in the `BootState` union.** Confirmed via `src/modules/health/schemas.ts:26`: `z.enum(['booting', 'migrating', 'ready'])`. Used at `src/app.ts:338` (`currentBootState = 'migrating'` before schema sync) and L617 (`/health` returns 503 for any non-ready state). F's decision to keep the value is consistent with the architecture.md rewrite, which explicitly notes the row is "Forward-compat only — unreachable in MVP". The two artefacts agree internally: the union has the value, the spec table acknowledges the value is unreachable today and retained for a future restructure. No drift. ✓

9. **Forbidden-pattern sweep.** Walked the diff for the CTRFHub `CLAUDE.md` fast-fail patterns — none present. Diff is composition-root + spec text only; no HTMX, no Alpine, no SQL, no Zod-in-handler, no Better Auth bypass, no test mocking the DB, no Tier-3-before-Tier-2 (the diff adds no Playwright assertions). ✓

10. **Out-of-scope items honoured.** Did not file findings on (a) the `'migrating'` enum retention — F's documented call per brief; (b) the boot sequence remaining unrestructured — André's directive; (c) `deployment-architecture.md` still carrying stale framing — F correctly flagged-not-edited per the `docs/planning/*` discipline. ✓
