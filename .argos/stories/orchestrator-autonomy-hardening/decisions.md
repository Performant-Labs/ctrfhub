# Decision log — orchestrator-autonomy-hardening

## 2026-05-18 — Post-PR clarification fix-pass — Constraints override literal acceptance reading

**Decision.** Argos ran a focused F fix-pass on the open PR #73 branch to add a "constraints are authoritative over a literal acceptance-criterion reading" clause to `§Autonomous decision-making` in `.claude/agents/orchestrator.md` (mirrored into `implementstory.md`), with a worked example, and re-checked it with A only — not T or S.

**Trigger.** After PR #73 was opened, André identified that the new autonomy rule, applied retroactively to the `ctrfhub-docker-build-fix` `compose.sqlite.yml` warn-finding, would have produced the literal acceptance-criterion reading (add a `build:` stanza) — the opposite of André's actual "Dockerfile only" ruling — because the literal reading, though answerable from the brief, violated the brief's Constraints section (no pipeline/config refactoring).

**Rationale.** The gap is genuine: a criterion's literal reading and the brief's constraints can conflict, and the rule as first written had no tie-breaker. André's reasoning — the Constraints section is authoritative over a literal-reading-only interpretation when the two conflict, and such a conflict is a human-escalation case, not an autonomous one — is sound and narrows (never widens) Argos's autonomous authority. T and S re-runs were deliberately skipped: the change is a markdown rule clarification on a diff that already passed a full A/T/S cycle and has no executable surface; A's single consistency re-check (`architecture-review-fix.md`, PASS) is the proportionate gate.

**Effect.** PR #73 now carries the clause + worked example; `architecture-review-fix.md` records the A PASS; `pr-body.md` gained a "Post-A clarification" section and the PR description was updated via `gh pr edit`. Once #73 merges, a future Argos facing a criterion-vs-constraint conflict escalates to the human rather than deciding — which would have produced André's "Dockerfile only" outcome on the original case. This `decisions.md` entry itself dog-foods the decision-log pattern the story introduces.
