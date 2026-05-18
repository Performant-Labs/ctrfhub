# [orchestrator-autonomy-hardening] Harden orchestrator autonomy — eliminate routine AskUserQuestion stalls

## Summary

The orchestrator (Argos) previously surfaced interactive `AskUserQuestion`
popups for routine phase-gate routing decisions — choices a remote user
cannot see and that fall within Argos's delegated authority. This PR is a
governance-documentation change: it adds an autonomous-decision rule to
`.claude/agents/orchestrator.md`, pins the `escalation.md` contract to an
exact, exhaustive set of conditions, and introduces a `decisions.md`
audit-log pattern so non-obvious autonomous calls are recorded for the human
to review after the fact rather than blocking the loop on a popup. No
application code changes.

## Acceptance criteria

Verbatim from `.argos/stories/orchestrator-autonomy-hardening/brief.md`.

- [x] A test run of the implementstory workflow against a brief with an ambiguous warn-finding does not surface any AskUserQuestion popup — **mechanism delivered** (the autonomous-decision rule replaces AskUserQuestion for PASS-with-warn/nit gates). Per the brief's binding note #2, the literal "test run" is observable only on the *next* story Argos runs; verified by T as documented mechanism, not a live run.
- [x] `decisions.md` is created with at least one entry on that test run — **pattern delivered** (purpose, format, write-triggers fully defined; added to the handoff schema). Population of an actual `decisions.md` likewise occurs on a future story run, not inside this governance story.
- [x] Escalations (`escalation.md`) only appear under the defined conditions — the escalation contract in `orchestrator.md` is now exact and exhaustive: 3 conditions from the brief's scope item 2 + 5 pre-existing operational triggers, reconciled with `implementstory.md`'s table with no legitimate trigger deleted.

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | n/a — governance-docs story | N/A | No application code; diff is markdown-only |
| Integration | n/a | N/A | No executable surface for vitest |
| E2E | n/a | N/A | No route or UI |

No new test files authored — a markdown governance change has no executable
surface (matches the `ctrfhub-docker-build-cache` verification-only precedent).
T verified the documented mechanism by independent document review, and
confirmed the existing suite is unchanged: `npm test` → 498 tests pass,
`tsc --noEmit` clean.

## Page verification tiers

| Tier | Declared | Result | Report location (story branch) |
|---|---|---|---|
| T1 Headless | yes (judgment — document review) | ✓ | `.argos/stories/orchestrator-autonomy-hardening/tier-1-report.md` |
| T2 ARIA (clean room) | no — no rendered route | N/A | `.argos/stories/orchestrator-autonomy-hardening/tier-2-report.md` |
| T2.5 Authenticated State | no — see tier-2-report.md | N/A | see `tier-2-report.md` |
| T3 Visual | no — no UI | N/A | see `tier-2-report.md` |

## Architecture reviews

| # | Verdict | File |
|---|---|---|
| 1 | PASS | `.argos/stories/orchestrator-autonomy-hardening/architecture-review-1.md` |

## Decisions that deviate from spec

- **Acceptance criteria 1 & 2 are future-observable, not producible inside this story.** Both reference "a test run of the implementstory workflow" — that run can only happen on the *next* story Argos orchestrates. Argos annotated the brief (Phase 1, binding note #2) ruling that the deliverable here is the documented mechanism; T verified accordingly. The criteria are satisfied at the mechanism level; live observation is deferred to the next story run by construction.
- **The non-pausing "F regresses A or T during spec-remediation" row was relocated, not deleted.** It never wrote `escalation.md` or paused the loop, so it was never a true escalation; F moved it verbatim into a new "Non-condition (does NOT escalate)" contrast table. A and T both independently confirmed no legitimate operational trigger was lost.
- **`brief.md` / `feature-handoff.md` committed despite the stale "gitignored — never commit" note** in `implementstory.md`'s Phase 1 template. The repo does not gitignore `.argos/`, and `AGENT_LOOP_ON_URANUS.md §7` states `.argos/` is tracked and travels with the story branch; every prior story committed these files. F followed established repo practice. Correcting the stale template note is out of this story's scope (see Gaps).

## Gaps filed during this story

- none filed in `docs/planning/gaps.md` (that file is for planning-spec ambiguities). One process-doc inconsistency was noted in passing: `implementstory.md`'s Phase 1 template calls `brief.md` "gitignored — never commit" while the repo tracks `.argos/`. Out of scope here; flagged for a future cleanup.

## Spec-enforcer verdict

**PASS** — see `.argos/stories/orchestrator-autonomy-hardening/spec-audit-1.md` (M=1)
**Date:** 2026-05-17

## Next assignable stories (after this merges)

- Queued in `.argos/stories/`: `test-writer-discipline` (state not assessed by this story).

---
_Generated from `.argos/stories/orchestrator-autonomy-hardening/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._
