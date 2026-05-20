# Task Brief — audit-composition-root-S2: Tighten composition-root altitude — extract AI wiring, consolidate `onClose`, admit MVP `/health` early-boot behaviour in the spec

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: none required (per `.argos/audits/audit-composition-root/decomposition.md §Dependencies`, S2 is independent of S1; S3 is the one that's best-sequenced *after* S2). PR #85 (`story/audit-composition-root-S1`) is open and also edits `src/app.ts` — see "File-overlap risk" under Implementer notes.
- [x] No P0 gap blocks this story: `gaps.md` P0 items G-P0-001..003 are Tailwind/Eta/settings-schema (none touch the composition root); G-P0-004 (AI pipeline restart-recovery) is **closed** (the `ai_pipeline_log` reserve-execute-commit design is canonical and `recoverStalePipelineRows` is the implementation this story relocates behind `wireAiPipeline(…)`).
- [x] Branch cut: `story/audit-composition-root-S2` from `origin/main` @ `70b845d` (PR #84 merge — the audit findings + decomposition this story consumes).
- [x] `tasks.md` flip: N/A — this story is decomposed from an architecture audit, not a `tasks.md` row (same shape as `audit-auth-S1` / `architecture-augment`).
- [x] No other story mid-flight: no open `.argos/stories/<otherId>/` *pipeline*. PR #85 (`audit-composition-root-S1`) is open but its pipeline is closed (commit `e402777 chore(audit-composition-root-S1): record S PASS`); only merge is pending. File-overlap is in the same file (`src/app.ts`) but at non-overlapping line ranges — see Implementer notes.

## Source

**Audit:** `audit-composition-root` (territory T6 of the codebase audit campaign).
**Findings:** `.argos/audits/audit-composition-root/findings.md` — Findings #2, #4, #7, #11 (all `warn`, Theme T6-β).
**Decomposition entry:** `.argos/audits/audit-composition-root/decomposition.md §Story audit-composition-root-S2`.

Both files are on `origin/main` (merged via PR #84) — F can read them directly.

## André's override on finding #11 (kickoff directive — authoritative)

The decomposition's default for finding #11 was **restructure the boot sequence** so `app.listen()` runs before schema sync and a probe arriving during sync receives the documented 503. André's kickoff line overrides this:

> *"Decision on finding #11: take the doc-fix path — update `architecture.md` to reflect that there is no migration boot state in MVP. The DB is recreated during development; connection-refused during early boot is the actual MVP behaviour. Do not restructure the boot sequence. The `docs/planning/*` exception is authorized for this specific change."*

This is the **only** authorized `docs/planning/*` edit for this story. Every other change in this story is `src/`-only. F must not edit `docs/planning/*` for any other reason.

## Story

**Description.** Findings #2, #4, #7, #11 from the composition-root audit are a single "altitude" theme: the AI-pipeline wiring is inlined in `buildApp()` when it belongs behind a `wireAiPipeline(…)` function in `src/services/ai/pipeline/`; the five `onClose` hooks rely on Fastify's undocumented LIFO contract; a runtime EventBus guard papers over test-double laxity; and the boot-state 503 contract is structurally undeliverable in MVP (the server isn't listening when the boot states transition). This story extracts the AI wiring, consolidates shutdown into one explicit forward-order function, removes the runtime EventBus guard, and updates `docs/planning/architecture.md §Health endpoint` + the JSDoc at `src/app.ts:14` to admit MVP behaviour (per André's override).

**Acceptance criteria.**

*Finding #2 — extract AI-pipeline wiring (Theme T6-β):*
- A new module `src/services/ai/pipeline/wire.ts` exports `wireAiPipeline(app, { eventBus, aiProvider, orm })`. It encapsulates: boot-time `recoverStalePipelineRows`, the three event subscriptions (A1 `categorizeRun`, A2 `correlateRootCauses`, A3 `generateSummary`), and `startSweeper`. The sweeper handle (or a `stopSweeper()` closure) is returned so the composition root can hook it into shutdown.
- `buildApp()` calls `wireAiPipeline(...)` once (when `aiProvider` is configured) and the five AI-pipeline imports at `src/app.ts:57–63` (`categorizeRun`, `correlateRootCauses`, `generateSummary`, `recoverStalePipelineRows`, `startSweeper`) collapse to a single import of `wireAiPipeline` from `src/services/ai/pipeline/wire.ts` (re-exported from the barrel if helpful).

*Finding #4 — consolidate `onClose` (Theme T6-β):*
- The five `onClose` hooks currently registered at `src/app.ts:368, 380, 387, 402, 477` are consolidated into one explicit shutdown function whose teardown order is dependency-correct **as written** (sweeper → AiProvider → ArtifactStorage → EventBus → ORM). The code reads top-to-bottom in the order it executes — no reliance on Fastify's LIFO `onClose` contract.
- A short code comment on the consolidated `onClose` hook cites `architecture.md §Production Deployment → Graceful shutdown` and names the dependency-correct teardown order.

*Finding #7 — remove the runtime EventBus guard (Theme T6-β):*
- The runtime check at `src/app.ts:410` (`if (typeof eventBus.subscribe === 'function' && typeof eventBus.publish === 'function')`) is **removed**. After the extraction in #2, any unconditional call to `wireAiPipeline(...)` would call `eventBus.subscribe/publish` on a value typed as `EventBus`. The interface contract is enforced by the type system.
- Any test double currently typed as `EventBus` but implementing only `close()` is tightened in its test-helper file to implement `publish`/`subscribe`/`close` as no-ops. If a partial-double is genuinely needed, expose it as a separate sub-interface (`type ClosableOnly = Pick<EventBus, 'close'>`) and type the test seam against that — not against `EventBus`. **This is a test-helper edit (not a test-authoring edit) and is in F's scope; flag it in `feature-handoff.md` so T can confirm during the test pass that the doubles are still honest.**

*Finding #11 — admit MVP `/health` early-boot behaviour in the spec (doc-fix path, per André's override):*
- `docs/planning/architecture.md §Health endpoint` is updated:
  - The "boot state machine" / `bootState` transition table is rewritten so it does not promise a `migrating`-state 503. Two acceptable shapes — F picks: (a) drop the `migrating` row entirely from the boot-state table and document the MVP behaviour as `booting (connection-refused, server not listening) → ready (200) → ready-but-DB-down (503)`; or (b) keep the table for forward-compat but add a leading paragraph stating that in MVP the server is **not listening** during schema sync, so the documented `booting`/`migrating` 503s are unreachable in production and exist for forward compatibility.
  - The paragraph beginning *"Schema sync window (why this contract matters)"* (line 553 area) is rewritten to remove the claim *"The 503-during-sync contract is the real guarantee."* — in MVP, the real guarantee is `start_period: 30s` on the Docker compose healthcheck + connection-refused while the process isn't listening. The note that schema-sync drift would produce 500s remains; the framing that 503-during-sync is what prevents it does not.
  - The reference to `INFRA-005 pivot` (line 529 area) is preserved — the schema-generator-not-migrator decision is still accurate.
- The JSDoc at `src/app.ts:14` is updated to remove the misleading `GET /health (readiness probe — 503 during boot, 200 when ready)` line. The accurate MVP behaviour is `GET /health (readiness probe — 200 when ready; the process is not listening before schema sync completes)`. The `/health` route's own JSDoc (~line 614 area) is updated to match.
- The boot sequence is **not restructured**. `app.listen()` continues to be called from `src/index.ts` *after* `buildApp()` resolves (i.e. after schema sync). The `BootState` type and the `getBootState`/`setBootState` decorators stay — they remain useful for `ready` vs `ready-but-DB-down` and as forward-compat hooks. F may leave the `currentBootState = 'migrating'` assignment in place (harmless) or remove it (drops a now-doc-orphaned value); F's call, documented in `feature-handoff.md`. If F removes `'migrating'` from the `BootState` union in `src/types.ts`, the existing assignment must be removed in the same diff.

*Cross-cutting:*
- `tsc --noEmit` clean.
- The existing test suite passes (unit + integration; the existing AI-pipeline integration tests still see subscribers fire, sweeper runs, recovery runs at boot — i.e. the extraction is behaviour-preserving).

**Test tiers required.**
- Unit: **yes** — one small unit test on `wireAiPipeline(...)` asserting (i) the three subscribers (`run.completed` → A1 categorizer, `run.ai-categorized` → A2 correlator, `run.ai-correlated` → A3 summarizer — confirm event names from the existing code) are registered and (ii) the sweeper is started. A minimal in-memory `EventBus` double + a stubbed `AiProvider` are sufficient inputs.
- Integration: **no** — the original brief's `/health` 503-during-sync integration test is **dropped** by André's override (the contract being tested no longer exists in the spec). The existing AI-pipeline integration tests are the behaviour-preservation regression guard for the extraction.
- E2E: no.
- Page verification: none — `/health` is a JSON endpoint, not a rendered page.

**Critical test paths.** Existing AI-pipeline integration tests (whichever assert that subscribers fire and the sweeper runs) continue to pass unchanged. The new wireAiPipeline unit test goes under `src/__tests__/unit/` (T to place).

## Required reading

**Skills (full paths).**
- `skills/better-auth-session-and-api-tokens.md` — confirms the auth preHandler is unaffected by this story (no edits in that area).
- `skills/ai-pipeline-event-bus.md` (if present) — the event-bus subscription pattern the new `wireAiPipeline` encapsulates. If not present, the existing `src/app.ts:425–470` is the source of truth.

**Planning doc sections.**
- `docs/planning/architecture.md §Layering and Dependency Direction` — "`buildApp()` is the composition root"; internal wiring lives in its module.
- `docs/planning/architecture.md §Code Conventions → Abstraction level` — "match the altitude of your neighbours"; "ambient module-level singletons are the anti-pattern" (the EventBus runtime guard is the *opposite* problem: a runtime check papering over a type-system contract).
- `docs/planning/architecture.md §Code Conventions → File organization` — module shape for the new `src/services/ai/pipeline/wire.ts`.
- `docs/planning/architecture.md §Production Deployment → Graceful shutdown` — the canonical teardown order the consolidated `onClose` must cite.
- `docs/planning/architecture.md §Health endpoint` — the section this story rewrites. **F edits this section; this is the authorized `docs/planning/*` exception per André's kickoff directive (above).**
- `docs/planning/ai-features.md §Durability and restart recovery` — `recoverStalePipelineRows` is part of the AI-pipeline domain; this story moves it behind that domain's wiring function.

## Implementer notes (from the decomposition + André's override)

- **File-overlap risk with PR #85.** PR #85 (`audit-composition-root-S1`) is open and edits `src/app.ts` at lines ~226–229 (rate-limit) and ~569–582 (auth API-key branch). S2's edits cluster around lines 14 (JSDoc), 57–63 (imports), 343/365 (the boot-state assignments — possibly removed), 368/380/387/402/477 (the `onClose` hooks consolidated), and 410–481 (AI pipeline block extracted to `wire.ts`). Line ranges do not overlap, but the *file* does. If PR #85 merges to `main` before this story does, F (or whichever phase is active) will need to rebase `story/audit-composition-root-S2` on the new `main`. The rebase should be trivial because the touched line ranges don't intersect.
- **Sequence within S2.** Keep the diff explicit and commit-isolated: (a) extract `wireAiPipeline` first; (b) consolidate `onClose` second; (c) remove the EventBus runtime guard third; (d) update `architecture.md` + JSDocs fourth. One commit per step makes review trivial; one big commit also acceptable if cleaner.
- **`wireAiPipeline` signature.** Take `app` (or just `{ log }` if `app.log` is the only Fastify dependency) + `{ eventBus, aiProvider, orm }`. Return the sweeper handle (or a `stop()` closure) so the composition root's consolidated `onClose` can invoke it. Do not let it register an `onClose` hook itself — `app.ts` owns shutdown ordering.
- **Event names.** Confirm the exact event names at `src/app.ts:427/445/460` (e.g. `run.completed`, `run.ai-categorized`, `run.ai-correlated`) when constructing the unit test — do not invent them.
- **EventBus test-double tightening.** Grep `src/__tests__/` for files that construct an `EventBus`-typed object with only `close()`. Tighten them to also implement `publish`/`subscribe` as no-ops (or retype them against `Pick<EventBus, 'close'>` and update their call sites accordingly). This edit is in F's scope; it is a *test-helper* edit, not a *test-authoring* edit. Flag what you changed in `feature-handoff.md` so T can confirm the helpers still serve their tests.
- **`docs/planning/*` discipline.** The architecture.md edit in this story is the only one authorized. If during implementation F discovers another `docs/planning/*` mismatch related to finding #11 (e.g. `deployment-architecture.md` repeating the 503-during-sync framing), **flag it in `feature-handoff.md`** for André to authorize separately — do not edit it.
- **`bootState` enum cleanup is F's call.** Removing `'migrating'` from the `BootState` union in `src/types.ts` is optional. If F removes it, the `currentBootState = 'migrating'` assignment must go too (otherwise tsc errors), and the choice is documented in `feature-handoff.md`. If F keeps it, the architecture.md update notes the value is retained for forward compatibility.

## Iteration tracking (for F's awareness)

This brief is F's input on **iteration 1**. On subsequent iterations F is spawned with:
- `architecture-review-<N-1>.md` (F↔A loop, iter N>1, cap 3)
- `fix-pass-notes.md` (Phase 5 fix-pass after T BLOCK)
- `spec-audit-<M-1>.md` (Phase 6b spec-remediation, cap 2; light remediation rule)

Each F invocation appends a `## Iteration <N>` (or `## Fix-pass`, `## Spec-remediation iter <M-1>`) section to `feature-handoff.md`.
