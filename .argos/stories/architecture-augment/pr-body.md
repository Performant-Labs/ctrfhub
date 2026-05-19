# [architecture-augment] Augment architecture.md with Code Architecture + Operational Invariants

## Summary

Augments `docs/planning/architecture.md` so it works as the audit yardstick for the
Architecture Reviewer (A) in audit mode. A prior gap analysis found the doc covered
only ~30–40% of A's code-layer dimensions and that `auditarchitecture.md`'s
most-cited dimension (`§Layering`) was a dangling reference. This PR adds the missing
code-architecture sections, bakes in the operational invariants from PRs #71–#75, and
codifies a `docs/planning/*` exception process. It is a **docs/governance change** —
no application code is touched.

## Authorized exception

This story is the **explicit, brief-authorized exception** to the standing "Never
modify `docs/planning/*`" rule. The brief authorizes editing `docs/planning/architecture.md`
only. No other file under `docs/planning/` was modified. The new
§Document Authority and Exception Process section codifies how future exceptions are
requested.

## Acceptance criteria

- [x] `docs/planning/architecture.md` PR opened, containing all 6 augmentations (§Layering and dependency direction; §Code Conventions; §Operational Invariants for PRs #71–#75; §Document Authority and Exception Process; the 3 stale-section refreshes; the canonical-doc discrepancy resolution)
- [x] The dangling `§Layering` citation in `docs/orchestrator-workflows/auditarchitecture.md` now resolves (the new section heading leads with the literal word "Layering")
- [x] The `project-architecture.md` vs `architecture.md` discrepancy is resolved — see "Decisions that deviate from spec" below for the resolution chosen
- [x] The new §Document Authority + Exception Process section makes clear how future exceptions to "Never modify `docs/planning/*`" are requested
- [x] Every added/updated section carries inline citations
- [x] No application code changes (`src/` is read-only for this story — diff confirmed docs-only)
- [x] All existing tests still pass (498/498; `tsc --noEmit` clean)

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | N/A — not a tasks.md story | N/A | Docs-only story; no application code changed |
| Integration | N/A | N/A | Docs-only story; no application code changed |
| E2E | N/A | N/A | Docs-only story; no rendered routes changed |

This is a process/governance story, not a `tasks.md` row, and it touches no
application code or rendered routes. Per the brief's acceptance criteria, no new test
tiers apply. The T phase performed a regression check only — see
`.argos/stories/architecture-augment/test-handoff.md`.

## Page verification tiers

None — no rendered routes. T1/T2/T2.5/T3 N/A (docs-only story).

## Architecture reviews

| # | Verdict | File |
|---|---|---|
| 1 | PASS (0 block, 1 warn, 2 nit) | `.argos/stories/architecture-augment/architecture-review-1.md` |

## Decisions that deviate from spec

- **Canonical-doc resolution (brief item 6).** The brief delegated the
  `project-architecture.md` vs `architecture.md` discrepancy explicitly to F's
  judgment ("F's call: rename, redirect via stub, or merge"); the matching acceptance
  criterion presumed the shape "one is canonical; the other is a stub or removed."
  F instead chose **keep both, split by subject** — `architecture.md` = canonical
  code/technical architecture (THE yardstick for A), `project-architecture.md` =
  canonical process/workflow architecture — on the finding that the two docs do not
  overlap in content and the real defect was a dangling `§Layering` citation, not a
  duplicate document. The dangling citation is fixed by adding `§Layering` to
  `architecture.md`. Because nothing was renamed, `.claude/agents/architecture-reviewer.md`
  needed no change. Recorded in `.argos/stories/architecture-augment/decisions.md` D3
  and documented inside the new §Document Authority section. **André: please confirm
  this resolution at merge — it deviates from the criterion's presumed stub/merge shape.**
- **A iter-1 `warn` finding #2 carried, not fixed.** A's review flagged that the
  §Code Conventions `src/` file-organization map does not note that a trivial route
  (e.g. `/health`, registered inline in `buildApp()`) may skip its own `routes.ts`.
  This is a minor doc-precision improvement, non-blocking; the implement loop has no
  mechanism to send F back on a PASS verdict. Surfaced here for André. See
  `decisions.md` D2.
- **Two "Known drift" items flagged in the doc, not silently codified** (per the
  brief's drift-handling constraint): (a) no dedicated repository classes — services
  use `EntityManager` directly; (b) two coexisting route-registration shapes. Both
  are written with the *intended* rule as the standard and the drift parenthesized
  for André's adjudication.

## Follow-ups filed (not in scope for this story)

- `docs/orchestrator-workflows/auditarchitecture.md` still cites a `project-architecture.md
  §Module boundaries` section that does not exist; module-boundary rules now correctly
  live in `architecture.md §Layering and Dependency Direction`. This story is forbidden
  from editing `auditarchitecture.md`; the mismatch is flagged inside the new
  §Document Authority section for repointing when that workflow is next touched.

## Gaps filed during this story

none

## Spec-enforcer verdict

_Pending — S audit runs at Phase 6.2 before this PR is opened._

---
_Generated from `.argos/stories/architecture-augment/pr-body.md`._
