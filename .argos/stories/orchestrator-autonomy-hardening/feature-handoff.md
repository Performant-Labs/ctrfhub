# Feature handoff — orchestrator-autonomy-hardening

## Iteration 1

**Date:** 2026-05-17
**Branch:** `story/orchestrator-autonomy-hardening`
**Commits added this iteration:**
- (see `git log` — `docs(orchestrator-autonomy-hardening): ...`)

### What was built / fixed

Governance-documentation story. No `src/` code; the deliverable is markdown edits to the agent-loop's own definition files. Three scope items:

- **Scope 1 — autonomous-decision rule.** Added a `## Autonomous decision-making (no routine AskUserQuestion stalls)` section to `.claude/agents/orchestrator.md`. It states Argos must not use `AskUserQuestion` for phase-gate routing, and defines a 5-step procedure for resolving PASS-with-`warn`/`nit` gates: re-read the brief's acceptance criteria/constraints → re-read `docs/planning/*` and architecture docs → make the call (PASS clears the gate; loop back only if a criterion is genuinely unmet) → document the rationale inline in the next handoff artifact → proceed without pausing. A matching, shorter `## Autonomous phase-gate routing` section was added to `implementstory.md`.
- **Scope 2 — escalation contract.** Added a `## Escalation contract (exhaustive and exact)` section to `orchestrator.md` separating two mechanisms: `escalation.md` (pauses the loop) vs. the autonomous-decision rule (loop continues). The `escalation.md` table lists exactly 8 conditions; reconciled against `implementstory.md`'s pre-existing "Escalation conditions" table.
- **Scope 3 — decision log.** Added a `## Decision log` section to `orchestrator.md` defining `decisions.md`: purpose (per-story audit trail of non-obvious autonomous calls), when to write (PASS-with-`warn`/`nit` routing, picking between plausible interpretations, deferring a finding as a follow-up), and an explicit markdown format template. Added `decisions.md` to the `.argos/stories/<storyId>/` handoff schema in both `implementstory.md` and `AGENT_LOOP_ON_URANUS.md §7` (tree diagram + schema table + reconciling prose).

### Commands run locally (results)

- `npx tsc --noEmit` — 0 errors (exit 0). Edits are markdown-only; TS confirmed untouched.
- No migrations (no entity changes). No dev-server boot needed (no `src/` changes).

### Files created or modified

- `.claude/agents/orchestrator.md` — added three sections: Autonomous decision-making, Escalation contract (exhaustive/exact), Decision log; added a `decisions.md` line to "Outputs you produce".
- `docs/orchestrator-workflows/implementstory.md` — added `## Autonomous phase-gate routing`; rewrote `## Escalation conditions` into a reconciled, classed (operational vs. judgment) table plus a non-condition contrast table; added `decisions.md` to the handoff-schema tree with explanatory prose.
- `AGENT_LOOP_ON_URANUS.md` — added `decisions.md` to the §7 namespace tree and the implement-loop schema table; expanded the `escalation.md` schema row to list all reserved conditions; added a paragraph distinguishing `decisions.md` (non-pausing audit trail) from `escalation.md` (pause signal).
- `.argos/stories/orchestrator-autonomy-hardening/feature-handoff.md` — this file (created).

### Decisions not covered by planning docs

- **How the escalation lists were reconciled.** The brief (binding note #3) required the `orchestrator.md` escalation section to enumerate scope item 2's three conditions (F↔A cap breach, S↔F cap breach, spec-unresolvable business-logic ambiguity) *plus* the pre-existing operational triggers in `implementstory.md`'s table, without silently deleting a legitimate trigger. Reconciliation done as follows:
  - The `escalation.md` contract in `orchestrator.md` lists **8** conditions: F↔A cap breach, S↔F cap breach, T-BLOCK-twice, A-recheck BLOCK, spec-unresolvable business-logic ambiguity, P0 gap, `gh pr create` failure, and TS-errors-at-F-exit. Seven are operational; one (ambiguity) is the judgment-call escalation.
  - The original `implementstory.md` "Escalation conditions" table had 8 rows. **7** are genuine `escalation.md`-pause conditions and are preserved verbatim in meaning. The 8th row — "F regresses A or T during spec-remediation" — had the action "PR-Agent in CI catches it … Promote light → full re-run", i.e. it never wrote `escalation.md` and never paused the loop. It was mis-placed in an escalation table. I **moved it** (not deleted it) into a new "Non-condition (does NOT escalate)" contrast table directly below, with its trigger and handling preserved word-for-word. No legitimate escalation trigger was removed; one non-escalation was relocated to where it belongs. Argos's role file already documents this same regression-handling under §Phase 6b's light-remediation rule, so it remains covered.
  - The `escalation.md` schema row in `AGENT_LOOP_ON_URANUS.md §7` previously listed only 4 conditions; expanded to point at `implementstory.md`'s authoritative table so the three docs agree.
- **`decisions.md` format.** Not pinned by any planning doc (this story defines it). Chosen format: a `# Decision log — <storyId>` title, then one `## <ISO date> — <phase> — <summary>` heading per decision with four labelled fields — **Decision**, **Trigger**, **Rationale**, **Effect**. Append-only, one paragraph per entry, matching the brief's "one-paragraph entry" requirement and the append-not-overwrite convention used by `feature-handoff.md`. The file is optional: a story with no non-obvious calls may omit it entirely.
- **Where the rationale gets documented.** The brief says "document the rationale inline in the next handoff artifact." I made this concrete: the rationale goes in the next artifact Argos writes (`fix-pass-notes.md` / `pr-body.md`), and *additionally* a structured entry is appended to `decisions.md`. If no handoff artifact is next, `decisions.md` is the sole record. This satisfies both scope item 1 ("inline in the next handoff artifact") and scope item 3 (the dedicated decision log) without contradiction.

### Findings addressed (iter N>1 / fix-pass / spec-remediation only)

N/A — iteration 1.

### Known issues / follow-ups

- The brief's acceptance criterion 1 and the `decisions.md` "test run" clause describe a *future* implementstory run, not something producible inside this story (per the brief's meta-story note #2). This iteration delivers the documented mechanism only; verification (T phase) confirms the docs are unambiguous, not that a live run occurred.
- The F/A/T/S agent files were intentionally not touched (brief constraint). The autonomy rule and `decisions.md` are Argos-only concerns, so no F/A/T/S file needed an edit.
- `docs/orchestrator-workflows/auditarchitecture.md` is still flagged as to-be-authored in `AGENT_LOOP_ON_URANUS.md §6`; out of scope for this story (governs the audit loop, not implement-loop autonomy).
