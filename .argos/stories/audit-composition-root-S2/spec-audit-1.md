# Spec-enforcer Audit — audit-composition-root-S2 — iteration 1

**Executed:** 2026-05-20 12:14 UTC
**Reviewer:** spec-enforcer (Claude Opus 4.7) — read-only
**Scope:** diff `origin/main..story/audit-composition-root-S2`
**Checklists run:** Architecture rules, Coverage, Planning-doc conformance (Health endpoint, Graceful shutdown, Layering, Code Conventions), Skills violations (ai-pipeline-event-bus, vitest-three-layer-testing), Forbidden-pattern sweep, `docs/planning/*` discipline (single-authorized-edit verification)

## Prior-iteration check (iteration > 1 only)

N/A — this is iteration 1 of the spec audit.

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|

**No drift detected against `skills/` or `docs/planning/*`.**

## Coverage gaps

| # | What's missing | Required by | Severity |
|---|---|---|---|

**Coverage matches the story's declared Test tiers required and Page verification tiers.** The brief declared Unit YES / Integration NO / E2E NO / Page-verification none. The diff matches: 1 new unit test at `src/__tests__/unit/wire-ai-pipeline.test.ts`, no new integration / E2E / page tests. The original-decomposition integration test for `/health` 503-during-sync is correctly **absent** (not deferred, not silently retained) per D-2 and the brief's override. The existing AI-pipeline integration suite (`ai-categorization.test.ts` Suite 9, `ai-correlation-summary.test.ts` event-chain) serves as the behaviour-preservation regression guard — confirmed green in T's tier-1 report (500/500).

## Planning-doc conformance (only lines relevant to this story's scope)

- [x] `docs/planning/architecture.md §Health endpoint` rewrite — the boot-state status table marks `booting` / `migrating` 503 rows as "Forward-compat only — unreachable in MVP" with accurate reasoning (process not listening during schema sync; probes get connection-refused); the "Schema sync window" paragraph is rewritten to remove the "503-during-sync is the real guarantee" framing and identify `start_period: 30s` + connection-refused-while-not-listening as the actual MVP guarantee; INFRA-005 framing preserved. The leading paragraph and table edits are internally consistent with code that retains `'migrating'` in `BootState` (`src/modules/health/schemas.ts:26`, used at `src/app.ts:338`).
- [x] `docs/planning/architecture.md §Layering and Dependency Direction` — `buildApp()` remains the composition root; internal wiring (boot recovery + 3 subscribers + sweeper) now lives in `src/services/ai/pipeline/wire.ts` behind a single `wireAiPipeline()` entry point. Composition root no longer knows the names of A1/A2/A3 stages or the existence of a sweeper; it sees one function call and one `stopSweeper` handle.
- [x] `docs/planning/architecture.md §Production Deployment → Graceful shutdown` — consolidated `onClose` at `src/app.ts:418–450` executes in dependency-correct forward order (sweeper → AiProvider → ArtifactStorage → EventBus → ORM); the header comment at `src/app.ts:399–417` cites the spec section by name and enumerates the order. Per-step try/catch preserves "process is exiting either way — log the failure but finish the close sequence" intent.
- [x] `docs/planning/architecture.md §Code Conventions → Abstraction level` — `wireAiPipeline(app, deps)` matches the altitude of its neighbours (`registerAuthRoutes(fastify, auth)`, `ingestPlugin(app)`). The runtime EventBus guard (papered-over type contract) is gone; interface enforcement is back where it belongs — in the type system.
- [x] `docs/planning/architecture.md §Code Conventions → File organization` — new module `src/services/ai/pipeline/wire.ts` sits alongside sibling pipeline files (`recovery.ts`, `sweeper.ts`, `categorizer.ts`, `correlator.ts`, `summarizer.ts`, `consent.ts`); barrel re-export added at `src/services/ai/pipeline/index.ts:16–17`.
- [x] `docs/planning/architecture.md §Code Conventions → Logging` — JSDoc updates at `src/app.ts:14–17` (top-of-file) and `src/app.ts:585–602` (`/health` route) accurately describe MVP behaviour ("200 when ready; process is not listening before schema sync completes, so early-boot probes see connection-refused rather than 503"; "the `booting` / `migrating` 503 branches below are retained for forward compatibility").
- [x] `skills/ai-pipeline-event-bus.md §Boot-time recovery` — `recoverStalePipelineRows(orm, eventBus)` is awaited *before* `eventBus.subscribe(...)` for A1/A2/A3 in `wire.ts:103–112`, so any re-published events land on the freshly-registered subscribers. The cited skill rule ("Before subscribing to EventBus events, the worker must … reclaim … re-enqueue") is honoured.
- [x] `skills/ai-pipeline-event-bus.md §Event chain` — subscribers in `wire.ts:117–158` are wired in the canonical order `run.ingested → A1 categorize`, `run.ai_categorized → A2 correlate`, `run.ai_correlated → A3 summarize` against the `RunEvents` constants from `src/services/event-bus.ts`. No raw event-name strings — the brief's hyphenated drafts (per D-3) were correctly resolved by reading the canonical constants.
- [x] `skills/vitest-three-layer-testing.md §Layer 1 (pure-ish wiring)` — the new test at `src/__tests__/unit/wire-ai-pipeline.test.ts` is a Layer 1 test: no DB, no Fastify boot, no real timers (`setInterval` is spied to capture the handle without ticking). Doubles are honest about their interfaces (recording `EventBus` implementing the full `publish`/`subscribe`/`close` contract; stub `MikroORM` returning `[]` from `execute()`; stub `FastifyInstance` exposing only `app.log`).
- [x] **`docs/planning/*` discipline** — the `docs/planning/` diff touches *only* `docs/planning/architecture.md` (verified via `git diff --stat origin/main..story/audit-composition-root-S2 -- docs/planning/` showing 1 file changed, 10 insertions, 6 deletions). All three hunks (`architecture.md:528–531`, `:543–546`, `:555–557`) are inside the `### Health endpoint` section (lines 525–559). No other `docs/planning/*` file is modified. F's flag of `docs/planning/deployment-architecture.md` lines 54 + 139–141 as carrying the stale 503-during-sync framing is correctly "flagged-not-edited" per F's handoff Known issues §1 — the file is byte-identical to `origin/main` (verified — empty diff). André's authorization (one section in one file) is respected exactly.

## Forbidden-pattern scan (from CLAUDE.md)

- [x] No `hx-target`/`hx-swap` inherited from a parent (diff has no HTMX attributes — composition-root + spec text + unit test)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` (no client-side code in diff)
- [x] No `hx-disable` anywhere in templates (no template changes in diff)
- [x] No Alpine `x-data` inside an HTMX swap target (no template changes)
- [x] No Postgres-only SQL / dialect-specific features without a SQLite equivalent (no SQL in diff; `wire.ts` re-exports the existing `recoverStalePipelineRows` and `startSweeper` queries unchanged)
- [x] No DB mocked in integration tests (the one integration-test edit at `health.test.ts:328–333` tightens an inline `EventBus` test double from `{ close }` to `{ publish, subscribe, close }` — does not introduce DB mocking; tests run against `:memory:` SQLite as before)
- [x] No T3 visual assertions without corresponding T2 ARIA assertions (no page-verification changes — `/health` is a JSON endpoint, brief §"Page verification: none")
- [x] No layout-token change without a T2 backdrop-contrast re-check (no layout-token / `[data-theme]` / `@layer components` changes in diff)
- [x] No raw CSRF-token or session-cookie handling outside Better Auth (auth preHandler region untouched; the diff's `src/app.ts` edits cluster around lines 14, 52–58, 359–397, 399–450, 585–602 — none touch auth)
- [x] No Zod schema defined ad-hoc in a handler (no Zod changes in diff)

## Verdict

**PASS** — Argos may proceed to Phase 7 (open the PR).

The four findings this story claims to close (#2, #4, #7, #11) are each addressed at the right altitude and with the right discipline:

- **#2 (extract AI-pipeline wiring)** — `src/services/ai/pipeline/wire.ts` exports `wireAiPipeline(app, { eventBus, aiProvider, orm })`; the five AI-pipeline imports at the old `src/app.ts:57–63` collapse to a single import via the pipeline barrel; `buildApp()` calls it once when `aiProvider` is configured and receives a `{ stopSweeper }` handle. The function does NOT register an `onClose` hook itself (per its JSDoc at `wire.ts:26–28`) — shutdown sequencing remains owned by the composition root.
- **#4 (consolidate `onClose`)** — five LIFO-ordered hooks become one explicit forward-order hook at `src/app.ts:418–450`; the cited header comment names the spec section by exact title and enumerates the order; per-step try/catch preserves the architecture-conformant "process is exiting either way" intent.
- **#7 (remove runtime EventBus guard)** — the old `if (typeof eventBus.subscribe === 'function' && typeof eventBus.publish === 'function')` runtime check is deleted; `wireAiPipeline()` is called unconditionally when `aiProvider` is set; the one lying test double at `health.test.ts:328–333` is genuinely tightened to implement the full `EventBus` interface (no-ops for `publish`/`subscribe`, the existing `close` for shutdown tracking). The other EventBus call sites in the test tree already used `new MemoryEventBus()` from `src/services/event-bus.ts` and were always honest — no further test-helper edits required.
- **#11 (admit MVP `/health` early-boot in the spec)** — `docs/planning/architecture.md §Health endpoint` rewrite is accurate (`app.listen()` is in `src/index.ts` *after* `buildApp()` resolves, confirmed by inspection; schema sync runs at `src/app.ts:343` *before* `/health` route registration at `src/app.ts:605`), confined to the authorized section (single file, three hunks all inside `§Health endpoint`), and internally consistent with the code (`'migrating'` retained in `BootState`, table row marks it forward-compat-unreachable with explicit reason). Boot sequence NOT restructured — André's directive honoured per D-2's narrow interpretation. JSDocs at `src/app.ts:14–17` (top-of-file) and `src/app.ts:585–602` (`/health` route) match the rewritten spec text. `docs/planning/deployment-architecture.md` correctly flagged-not-edited per F's Known issues — the file is byte-identical to `origin/main`.

The full vitest suite is 500/500 (per T's tier-1 report); `tsc --noEmit` is clean; the existing AI-pipeline integration suite (the behaviour-preservation regression guard for the #2 extraction) is green.

### Out-of-scope but noticed (informational, non-blocking)

- **`wire*` vs `register*` verb divergence** (`src/services/ai/pipeline/wire.ts:88`). A's iter-1 review filed this as a `warn` and explicitly judged it defensible (`register*` is reserved in this codebase for *route* registration; `wireAiPipeline()` registers event-bus subscribers and a sweeper, not routes); F pre-documented the choice in `feature-handoff.md §Decisions not covered by planning docs`. Mentioned here per the audit brief's explicit "Out of scope" guidance — not a finding.
- **`'migrating'` retained in `BootState` union** (`src/modules/health/schemas.ts:26`; used at `src/app.ts:338`). F's documented call per brief; the rewritten `architecture.md §Health endpoint` calls the row "Forward-compat only — unreachable in MVP" with explicit reasoning, so spec and code agree internally. Mentioned per the audit brief's explicit "Out of scope" guidance — not a finding.
- **`docs/planning/deployment-architecture.md` carries stale 503-during-sync framing** at lines 54 + 139–141. F correctly flagged-not-edited per `docs/planning/*` discipline — the doc-edit authorization covered only `architecture.md §Health endpoint`. Recorded here for the audit trail; needs a separate authorization for a doc-only cleanup pass. Mentioned per the audit brief's explicit "Out of scope" guidance — not a finding.
- **PR #85 file-overlap on `src/app.ts`** — non-overlapping line ranges (S1 touches ~226–229 rate-limit and ~569–582 auth API-key branch; S2 touches lines ~14, ~52–58, ~359–397, ~399–450, ~585–602). Rebase risk only if #85 merges first, and the rebase should be content-conflict-free. Not a finding.

PASS — Argos may proceed to Phase 7.
