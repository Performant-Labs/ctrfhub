# Decisions — audit-composition-root-S2

Non-obvious autonomous calls Argos made instead of pausing on an interactive prompt.
Per `.claude/agents/orchestrator.md §Decision log`.

## D-1 — Branched from `origin/main`, not local `main` (Phase 1, 2026-05-20)

**Context.** At Phase 1, local `main` had diverged from `origin/main`:
- Local-only commit `7319025 docs(agents): rename Daedalus + Talos → Prometheus; refresh session handoff` (renames/removes `HANDOFF.md`, `ORCHESTRATOR_HANDOFF.md`, `docs/planning/comparator-review-handoff.md`; adds `SESSION_HANDOFF.md`) — unpushed.
- Remote-only commit `70b845d audit(audit-composition-root): … (#84)` — merged on origin, not yet pulled.

**Call.** Branched `story/audit-composition-root-S2` from `origin/main @ 70b845d` directly, leaving local `main` untouched.

**Rationale.** PR #84 is the audit findings + decomposition this story consumes; basing on it ensures F can read `.argos/audits/audit-composition-root/findings.md` / `decomposition.md` from the working tree. The local docs commit is unrelated to S2 and not Argos's to push or revert. Reconciliation of local `main` is André's call when convenient.

**Surfaced to André.** Noted in this `decisions.md`; flagged here so the divergence isn't silently lost.

## D-2 — Interpretation of André's "Do not restructure the boot sequence" override on finding #11 (Phase 1, 2026-05-20)

**Context.** André's kickoff overrode the decomposition's default for finding #11 (which was "restructure boot so `app.listen()` runs before schema sync, making the documented 503-during-sync reachable") with the doc-fix path: "*update `architecture.md` to reflect that there is no migration boot state in MVP … connection-refused during early boot is the actual MVP behaviour. Do not restructure the boot sequence.*"

The phrase **"Do not restructure the boot sequence"** could be read narrowly ("don't change the ORDER of operations") or broadly ("don't touch any code in the boot region of `app.ts`"). The decomposition's S2 scope also includes findings #2 / #4 / #7, all of which edit code in the boot region of `app.ts` (AI wiring extraction, `onClose` consolidation, EventBus runtime-guard removal).

**Call.** Interpreted the override **narrowly**: it scopes finding #11 specifically. The order of operations in `buildApp()` and `index.ts` remains unchanged (schema sync still runs *before* `app.listen()`; the boot states still transition the same way). Findings #2 / #4 / #7 retain their original scope from the decomposition — they reorganize code without changing the runtime sequence of boot-phase side effects. The brief makes this interpretation explicit so F doesn't read the override as "leave the file alone".

**Rationale.** The override's stated rationale is about the `/health` 503-during-boot **contract** specifically (the doc claims a guarantee the code can't deliver). Findings #2 / #4 / #7 address different concerns (altitude / leverage / type-system enforcement) and don't change boot ordering. The broad reading would gut the story.

**Test-tier consequence.** The integration test the decomposition declared for finding #11 (`/health` returns 503 during schema sync) is dropped from this story's test-tier requirements — the contract it would verify no longer exists in the spec. The wireAiPipeline unit test (for #2) is retained. Documented in the brief's "Test tiers required" section.

**Optional `BootState` enum cleanup.** Whether to remove `'migrating'` from the `BootState` union in `src/types.ts` is left as F's call (documented in brief's Implementer notes). Either choice is consistent with the override's intent.

**Surfaced to André.** Inline in the brief; he sees this when reviewing the PR.
