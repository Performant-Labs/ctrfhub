# Story: Harden orchestrator autonomy — eliminate routine AskUserQuestion stalls

## Argos preconditions & notes (added at Phase 1)

- [x] Dependencies satisfied: `ctrfhub-docker-build-fix` (#71) and `ctrfhub-docker-build-cache` (#72) both merged.
- [x] No P0 gap blocks this story: G-P0-001..004 concern Tailwind/Eta/settings/AI — none affect orchestrator governance docs.
- [x] Branch cut: `story/orchestrator-autonomy-hardening` from `main` @ `c9f4beb`.
- No `tasks.md` row (process/governance story) — nothing to flip.

### Meta-story handling notes (READ BEFORE IMPLEMENTING)

This is a **governance-documentation story**, not an application-code story. It
deliberately edits the agent-loop's own definition files. Specifics for the
implementer (F):

1. **In-scope files are markdown governance docs, not `src/` code.** Expected
   edits: `.claude/agents/orchestrator.md`, `docs/orchestrator-workflows/implementstory.md`
   (if needed), and `AGENT_LOOP_ON_URANUS.md` (the `decisions.md` schema addition,
   per scope item 3 / the constraints section). This is the intended deliverable —
   treat these files as the loop's "configuration." Do NOT touch `src/`, tests, or
   the F/A/T/S agent files (the brief's constraints forbid the latter).

2. **Acceptance criterion 1 and the `decisions.md` "test run" clause describe a
   FUTURE story run, not something producible inside this story.** You cannot
   execute "a test run of the implementstory workflow" as part of implementing
   this story. The deliverable here is the *documented mechanism*: the
   AskUserQuestion guidance replaced with an autonomous-decision rule, the
   decision-log (`decisions.md`) pattern defined, and the escalation contract
   pinned to exactly the conditions in scope item 2. Verification (T phase) will
   confirm the mechanism is fully and unambiguously documented — not that a live
   test run occurred.

3. **Escalation contract must be exhaustive and exact.** When you edit
   `orchestrator.md`, the escalation section must list precisely the conditions in
   scope item 2 (F↔A cap breach, S↔F cap breach, genuinely ambiguous
   business-logic decisions unresolvable from brief/`docs/planning/`/architecture
   docs) — plus the pre-existing operational escalations already in
   `implementstory.md`'s "Escalation conditions" table (T-BLOCK-twice, A-recheck
   BLOCK, `gh pr create` failure, etc.); reconcile the two lists so they do not
   contradict. The new autonomy rule narrows *AskUserQuestion* usage; it must not
   silently delete a legitimate existing escalation trigger.

## Motivation
On the first run of the agent loop (story ctrfhub-docker-build-fix), Argos stalled twice on interactive `AskUserQuestion` popups asking the human to choose between two routine interpretations — first about which Phase-3-pass option to take after an A-warn finding, then a similar judgment-call moment. These are within the orchestrator's delegated authority and should be made autonomously, with the reasoning captured in an artifact (e.g. handoff or escalation) rather than blocking on a UI prompt that the remote user can't see.

## Scope
Update `.claude/agents/orchestrator.md` (and possibly `docs/orchestrator-workflows/implementstory.md` if needed) to:

1. **Replace AskUserQuestion-style prompts with autonomous decisions** for all phase-gate routing where:
   - A or T returned PASS but flagged a warn/nit-level finding, AND
   - The finding can be answered by re-reading the brief's acceptance criteria and constraints.
   Argos should make the call itself, document the rationale inline in the next handoff artifact, and proceed. The human gets to see the decision after the fact via the artifact, not before via a popup.

2. **Define the escalation contract precisely.** Escalation (writing `escalation.md`) is reserved for:
   - F↔A iteration cap breach (3)
   - S↔F iteration cap breach (2)
   - Genuinely ambiguous business-logic decisions that cannot be resolved by reading the brief, the spec docs in `docs/planning/`, or the architectural docs.
   Everything else is a judgment call Argos owns.

3. **Add a "decision log" pattern** — when Argos makes a non-obvious autonomous call, it appends a one-paragraph entry to a `decisions.md` file in the story namespace explaining what was decided and why. This gives the human full audit visibility without blocking the loop.

## Acceptance criteria
- A test run of the implementstory workflow against a brief that includes an ambiguous warn-finding does not surface any AskUserQuestion popup.
- `decisions.md` is created with at least one entry on that test run.
- Escalations (escalation.md) only appear under the four conditions listed above.

## Constraints
- Do not change the existing F / A / T / S agent files.
- Do not change the `.argos/stories/<id>/` directory layout (only add `decisions.md` to the schema; document it in `AGENT_LOOP_ON_URANUS.md`).
- Merges on top of whichever main is current when this story starts.

## Note to Argos
Queue. Start after `ctrfhub-docker-build-fix` AND `ctrfhub-docker-build-cache` have both merged.
