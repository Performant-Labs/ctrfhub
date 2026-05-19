# Feature handoff — `architecture-augment`

## Iteration 1

**Date:** 2026-05-19
**Branch:** `story/architecture-augment`
**Commits added this iteration:**
- (see git log) `feat(architecture-augment): augment architecture.md with code architecture + operational invariants`

### What was built / fixed

This is a docs/governance story — no application code. `docs/planning/architecture.md` was
augmented (not replaced) with the six augmentations from the brief's Scope section:

1. **§Layering and Dependency Direction** — new section. Defines the strict one-directional
   layer chain (presentation → route/handler → service → repository/ORM → entity/DB) with an
   ASCII diagram, six normative layer rules, module-boundary + shared-seam rules, and a
   "Known drift" note (no dedicated repository classes — services use the `EntityManager`
   directly). The section's title leads with the literal word "Layering" so the
   `architecture.md §Layering` citation in `auditarchitecture.md` now resolves.
2. **§Code Conventions** — new section. Naming table (files/classes/functions/constants/
   schemas), `src/` file-organization map, Zod-schema location rule (resolves gap N1),
   error-handling pattern (surfaced/logged/swallowed), route-registration pattern, MikroORM
   usage, transaction boundaries, logging, abstraction-level guidance. Each convention cites a
   canonical example file. Marked `[descriptive-from-code]`.
3. **§Operational Invariants** — new section. Five normative invariant blocks, each citing its
   originating PR: asset-pipeline bridging (#71), build-layer caching (#72), orchestrator
   constraint-override clause (#73), test-writer sizing (#74), issue-management workflows (#75).
4. **§Document Authority and Exception Process** — new section. States `architecture.md` is THE
   canonical code/technical-architecture yardstick for A; resolves the `project-architecture.md`
   discrepancy; codifies the four-step exception process for modifying `docs/planning/*`.
5. **Stale-section refresh** — Image-build section now shows the asset-bridge `cp` step and the
   BuildKit cache mounts with PR #71/#72 notes; CI/CD section gained an "Issue-management
   workflows (PR #75)" subsection; the asset pipeline is reframed as an invariant.
6. **Canonical-doc discrepancy resolution** — documented in §Document Authority (see below).

Additional small augmentation: a §Security subsection "Global auth preHandler and the
`/assets/*` bypass" (resolves gap N2), capturing the ordered preHandler branches from
`src/app.ts §9`.

A status note was added at the top of the document explaining the augmentation, the authorized
exception, and the `[descriptive-from-code]` / `[derived-from-docs]` marking convention.

### Commands run locally (results)

- `npx tsc --noEmit` — 0 errors (docs-only change; expected clean).
- `npm test` — 498/498 tests pass, 23 test files (unchanged; docs-only change).
- `npm run migrate:pg` / `npm run migrate:sqlite` — N/A; no entity changes, no migrations.
- `npm run dev` — N/A; no application-code change, server boot unaffected.

### Files created or modified

- `docs/planning/architecture.md` — augmented with 4 new top-level sections (§Layering and
  Dependency Direction, §Code Conventions, §Operational Invariants, §Document Authority and
  Exception Process), a §Security preHandler subsection, a top-of-doc status note, and
  refreshes to the Image-build and CI/CD sections. Authorized by the brief's explicit exception.
- `.argos/stories/architecture-augment/feature-handoff.md` — this file (created).

**Not modified (deliberately):**
- `docs/planning/project-architecture.md` — see canonical-doc resolution below; no edit needed.
- `.claude/agents/architecture-reviewer.md` — its `project-architecture.md` reference is
  correct (process baseline); no edit needed.
- `docs/orchestrator-workflows/auditarchitecture.md` — out of scope; not edited (see follow-up).

### Canonical-doc resolution (brief item 6)

**Choice: keep both documents; do not rename or merge. Split by subject.**

- `docs/planning/architecture.md` → canonical **code & technical** architecture (stack,
  layering, conventions, security, deployment, operational invariants). THE yardstick for A.
- `docs/planning/project-architecture.md` → canonical **process & workflow** architecture
  (agent roles, session flow, artifact layout, branch/commit conventions, escalation).

**Rationale.** The two docs do not overlap — one describes how the *software* is built, the
other how the *team* builds it. Merging would create one oversized mixed-concern document;
renaming either would break the larger set of correct inbound citations. The actual defect was
a **citation defect**, not a document defect: `auditarchitecture.md` cited `architecture.md
§Layering` (no such section) and `project-architecture.md §Module boundaries` (no such section).
The fix is to add the §Layering and Dependency Direction section to `architecture.md` — the
correct home for layering/module-boundary rules, since those are code architecture. This is the
minimal, lowest-blast-radius resolution. It is documented in full in the new §Document Authority
section. Because no doc is renamed, the A role file's `project-architecture.md` reference stays
correct and was not touched.

### Decisions not covered by planning docs

- **Canonical-doc resolution = "keep both, split by subject."** Not pinned by any planning doc;
  the brief delegated the call to F (rename / stub / merge). Rationale above. Adjoins the new
  §Document Authority section.
- **`project-architecture.md` left unedited.** The brief allowed *optionally* editing it to
  resolve the discrepancy. Since the chosen resolution is "both docs survive, split by subject,"
  no edit to `project-architecture.md` was needed — the resolution is documented entirely inside
  `architecture.md §Document Authority`. Adjoins brief Constraints ("touch ONLY these files").
- **`.claude/agents/architecture-reviewer.md` left unedited.** The brief said to edit it *only
  if* the canonical doc was renamed. No rename occurred, so no edit. Its instruction to read
  `project-architecture.md` for the *process* baseline is correct as-is.
- **"Known drift" notes inline rather than silently documenting the drift as the rule.** Per the
  brief Constraints, where `src/` drifts from an intended rule the intended rule is stated as the
  standard and the drift is flagged parenthetically for André. Two such notes were added:
  (a) no dedicated repository classes — services use the EM directly; (b) two coexisting
  route-registration shapes (named fn vs. default plugin). Both are flagged "André adjudicates."

### Findings addressed (gap analysis G1–G5, N1–N3, U1–U4)

| Source gap | Section added/updated | What changed | Status |
|---|---|---|---|
| G1 (no §Layering; dangling citation) | §Layering and Dependency Direction | New section; literal "Layering" anchor; `auditarchitecture.md §Layering` citation now resolves | resolved |
| G2 (dependency direction / module boundaries) | §Layering and Dependency Direction | ASCII dependency diagram, module-boundary + shared-seam rules | resolved |
| G3 (naming + `src/` file org) | §Code Conventions | Naming table + file-organization map | resolved |
| G4 (error handling, route reg, MikroORM, txn, logging) | §Code Conventions | Five subsections, each with canonical example file | resolved |
| G5 (abstraction-level expectations) | §Code Conventions → Abstraction level | New subsection | resolved |
| N1 (Zod-schema location) | §Code Conventions → Zod-schema location | Module-scoped `schemas.ts` rule stated | resolved |
| N2 (`/assets/*` auth bypass) | §Security → Global auth preHandler | New subsection capturing the ordered preHandler branches | resolved |
| N3 (preHandler / middleware ordering) | §Security → Global auth preHandler | The four ordered branches are documented | resolved |
| U1 (CI stale vs PR #75) | §CI/CD → Issue-management workflows + §Operational Invariants | New CI subsection + invariant block | resolved |
| U2 (Docker build cache vs PR #72) | Image build section + §Operational Invariants | Build-cache note + invariant block | resolved |
| U3 (asset pipeline as invariant, PR #71) | Image build section + §Operational Invariants | Asset-bridge note + invariant block | resolved |
| U4 (never-modify rule + exception process) | §Document Authority and Exception Process | Four-step exception process codified | resolved |

### Known issues / follow-ups

- **`auditarchitecture.md §Module boundaries` citation still dangles.** That workflow cites
  `project-architecture.md §Module boundaries`, but module-boundary rules now (correctly) live
  in `architecture.md §Layering and Dependency Direction`. This story is forbidden from editing
  `auditarchitecture.md`. **Follow-up for André:** when `auditarchitecture.md` is next touched,
  repoint that citation to `docs/planning/architecture.md §Layering and Dependency Direction`.
  This is flagged explicitly inside the new §Document Authority section.
- **Anchor-link format.** Markdown auto-anchors are used for in-doc cross-references (e.g.
  `#layering-and-dependency-direction`). The `§Layering` *citation* in `auditarchitecture.md`
  is a prose reference, not a hyperlink, and resolves because a section whose title begins with
  "Layering" now exists — no anchor-syntax dependency.
- **Spec ambiguities NOT resolved unilaterally:** the two "Known drift" notes (no repository
  classes; two route-registration shapes) are flagged for André's adjudication rather than
  silently codified as the rule, per the brief Constraints.
