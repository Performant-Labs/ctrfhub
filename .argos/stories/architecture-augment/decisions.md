# Decision log — architecture-augment

## D1 — tasks.md row (Phase 1)

This story is a process/governance story authorized by an explicit brief; it is not a
row in `docs/planning/tasks.md`. There was therefore no `[ ]` → `[/]` flip to make.
The assign commit (`dadbe90`) carries the `brief.md` + `evidence-arch-md-review.md`
artifacts instead. Autonomous call: proceeded without a tasks.md edit rather than
inventing a backlog row.

## D2 — A iter 1 PASS-with-warn routing (Phase 3 → 4)

`architecture-review-1.md` returned PASS with one `warn` (finding #2): the §Code
Conventions `src/` file-organization map does not note that a trivial route (e.g.
`/health`, registered inline in `buildApp()`) may skip its own `routes.ts`. Per the
autonomous phase-gate routing rule, PASS clears the gate and a `warn` does not block.
The finding is a minor doc-precision improvement, not a missing augmentation or an
unmet acceptance criterion (all 6 augmentations are present and cited). The implement
loop has no mechanism to send F back on a PASS verdict, so this warn is carried into
the PR body's "Decisions that deviate from spec" section for André — the brief
explicitly states André reviews this PR carefully before merge. Routed to Phase 4.

## D3 — canonical-doc resolution deviates from the criterion's presumed shape

Brief item 6 delegated the `project-architecture.md` vs `architecture.md` discrepancy
explicitly to F ("F's call: rename, redirect via stub, or merge"). The matching
acceptance criterion presumes the outcome shape "one is canonical; the other is a
stub or removed". F instead chose a fourth path: **keep both, split by subject** —
`architecture.md` = canonical code/technical architecture, `project-architecture.md`
= canonical process/workflow architecture — on the finding that the two docs do not
overlap in content and the real defect was a dangling `§Layering` citation, not a
duplicate document. Argos's call: this is NOT an escalation. The brief delegated the
decision to F ("F's call"); F resolved the underlying discrepancy with a documented
rationale; the criterion's parenthetical was a presumed shape, not a hard constraint.
It IS a deviation from the literal criterion, so it is surfaced prominently in the
PR body's "Decisions that deviate from spec" section and left to S to audit and to
André to adjudicate at PR open. Proceeded to Phase 6.
