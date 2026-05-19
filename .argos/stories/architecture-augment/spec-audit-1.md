# Spec-enforcer Audit — architecture-augment — iteration 1

**Executed:** 2026-05-19 19:05
**Reviewer:** spec-enforcer (Claude Opus 4.7) — read-only
**Scope:** diff `main..story/architecture-augment`
**Checklists run:** Constraint compliance, Acceptance criteria, Spec faithfulness, Planning-doc conformance. The standard application-code Audit Checklist (Architecture rules / Coverage / Skills-violations spot-check) is **N/A** — this is a docs-only governance story; the diff contains no `src/`, no tests, no templates, no entities, no routes.

## Nature of this story

Docs/governance story with an **explicit, brief-authorized exception** to the standing "Never modify `docs/planning/*`" rule (`brief.md` §"Authorized exception", lines 8–9). Editing `docs/planning/architecture.md` is authorized and is NOT a spec violation. The diff is docs-only: `docs/planning/architecture.md` (augment) plus `.argos/stories/architecture-augment/` orchestration artifacts. Verified: no `src/`, no test files, no `.github/` workflows, no other `docs/planning/*` file.

## Prior-iteration check

N/A — iteration 1; no `spec-audit-0.md` exists.

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| 1 | `docs/planning/architecture.md` — in-doc cross-refs `[§… → subsection](#section-anchor)` | — (precision nit; also raised as A iter-1 finding #1) | The `→ subsection` link-text suffix is prose, not a resolvable Markdown fragment; the anchor resolves to the section, not the named subsection. Optional: drop the `→ subsection` suffix from link text. Navigation works as-is. | nit |
| 2 | `docs/planning/architecture.md` §Code Conventions → File organization within `src/` | — (precision nit; also A iter-1 finding #2, carried as `warn` by A) | The `src/` file-org map states `modules/<name>/` contains `routes.ts, schemas.ts, service.ts`; the `health` module has only `schemas.ts` (its route is registered inline in `buildApp()`). The §Module-boundaries prose already softens this ("when it has non-trivial logic — `service.ts`"). Add one clause noting a trivial route may be registered directly in `buildApp()`. Does not impair A's audit yardstick. | nit |

No `block`-severity drift detected against `skills/` or `docs/planning/*`.

## Coverage gaps

Coverage matches the story's declared Test tiers required: **none**. This is a docs/governance story with no `tasks.md` row, no application code, and no rendered route. T phase (`test-handoff.md`) correctly performed a regression-only check: `tsc --noEmit` clean, 498/498 existing tests green. No test tiers apply per the brief's acceptance criteria (lines 47–48). No coverage gap.

## Acceptance-criteria conformance

Brief acceptance criteria, lines 42–48 — each verified against the diff:

- [x] **All 6 augmentations present** — verified in `docs/planning/architecture.md`:
  1. §Layering and Dependency Direction — ASCII dependency diagram, 6 normative layer rules, module-boundary + shared-seam rules, "Known drift" note.
  2. §Code Conventions — naming table, `src/` file-org map, Zod-schema location (N1), error handling, route registration, MikroORM usage, transaction boundaries, logging, abstraction level; each cites a canonical example file.
  3. §Operational Invariants — five normative blocks, one per PR #71–#75.
  4. §Document Authority and Exception Process — canonical-doc statement, discrepancy-resolution table, 4-step exception process.
  5. Stale-section refresh — image-build section shows the `cp -r src/assets/. dist/assets/` bridge + BuildKit cache mounts; CI/CD section gained the Issue-management subsection; asset pipeline reframed as invariant U3.
  6. `project-architecture.md` discrepancy resolved (see Canonical-doc deviation ruling below).
- [x] **The dangling `§Layering` citation now resolves.** `docs/orchestrator-workflows/auditarchitecture.md:70` cites `docs/planning/architecture.md §Layering`. The new section title is "Layering and Dependency Direction" — leads with the literal word "Layering"; the GitHub auto-anchor `#layering-and-dependency-direction` resolves. Confirmed.
- [x] **The `project-architecture.md` discrepancy is resolved** — resolved via documented "keep both, split by subject" in §Document Authority. See ruling below.
- [x] **§Document Authority makes the future-exception process clear** — 4-step process: (1) dedicated story, (2) brief explicitly authorizes named file(s), (3) Argos issues / André approves, (4) PR reviewed against the brief's narrow scope; an unauthorized planning-doc edit is a `block` finding.
- [x] **Every added/updated section carries inline citations** — each new section carries a `[descriptive-from-code]` / `[derived-from-docs]` provenance tag; operational invariants cite PR merge SHAs; conventions cite canonical example files.
- [x] **No application code changes** — diff confirmed docs-only; `src/` untouched.
- [x] **All existing tests still pass** — `test-handoff.md`: 498/498, `tsc` clean.

## Planning-doc conformance (lines relevant to this story's scope)

- [x] Diff touches only `docs/planning/architecture.md` and `.argos/stories/architecture-augment/` artifacts — `brief.md §Constraints` lines 50–53.
- [x] No other `docs/planning/*` file modified — `git diff --name-only -- docs/planning/` returns only `architecture.md`.
- [x] No application code, test, workflow, or `auditarchitecture.md` edit — confirmed.
- [x] `docs/ai_guidance` symlink change is NOT in the diff — `git diff main..story/architecture-augment -- docs/ai_guidance` is empty; the symlink change remains an uncommitted working-tree change on `main`, correctly excluded from the story branch.
- [x] PR merge SHAs for #71–#75 cited in §Operational Invariants verified against `git log main`: #71=142fb97, #72=c9f4beb, #73=4240e74, #74=5aa281d, #75=76715f2 — all correct.
- [x] Canonical example files cited in §Code Conventions exist: `src/modules/ingest/{routes,service,schemas}.ts`, `src/modules/auth/routes.ts`, `src/modules/health/schemas.ts`, `src/entities/TestRun.ts`, `src/lib/artifact-validation.ts`, `src/services/event-bus.ts`, `scripts/copy-vendor-assets.mjs`, `scripts/docker-build-cached.sh`, `src/mikro-orm.config.{pg,sqlite}.ts`, `src/app.ts` — all confirmed present.
- [x] New normative rules are consistent with `CLAUDE.md` forbidden-patterns and `skills/*` — no contradiction: ZodTypeProvider exception for `/api/auth/*`, no ad-hoc `z.object` in handlers, dual-dialect SQL, `request.em` not `fastify.orm.em`, 500-row chunked insert, `skipAuth` per-route opt-out, `htmx-events.ts` constants — all match existing spec rather than rewriting it.
- [x] Two "Known drift" items (no repository classes; two route-registration shapes) are stated as drift — intended rule as standard, drift parenthesized, "André adjudicates" — not silently codified as new spec. Conforms to the brief's drift-handling instruction (lines 13, 39).

## Forbidden-pattern scan (from CLAUDE.md)

Docs-only diff — no application-code surface to scan. Each forbidden pattern is N/A by construction (no templates, no client code, no entities/migrations, no integration tests, no handlers in the diff). Explicitly: none found, because the diff contains no code.

- [x] No `hx-target`/`hx-swap` inherited from a parent — N/A (no templates)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — N/A (no client code)
- [x] No `hx-disable` anywhere — N/A (no templates)
- [x] No Alpine `x-data` inside an HTMX swap target — N/A (no templates)
- [x] No Postgres-only SQL without a SQLite equivalent — N/A (no entities/migrations)
- [x] No DB mocked in integration tests — N/A (no tests)
- [x] No T3 visual assertions without T2 ARIA — N/A (no tests)
- [x] No layout-token change without a T2 backdrop-contrast re-check — N/A (no UI change)
- [x] No raw CSRF-token / session-cookie handling outside Better Auth — N/A (no code)
- [x] No Zod schema defined ad-hoc in a handler — N/A (no handlers). The doc *codifies* the ban, consistent with `skills/zod-schema-first.md`.

## Ruling — the canonical-doc deviation (`decisions.md` D3)

The brief's acceptance criterion (line 44) presumes the shape "one is canonical; the other is a stub or removed." F instead chose **keep both, split by subject** — `architecture.md` = code/technical architecture, `project-architecture.md` = process/workflow architecture — documented in §Document Authority with an explicit rationale table and a flagged follow-up.

**Ruling: ACCEPTABLE — not a `block`-severity spec violation.**

Reasoning:
1. **The brief explicitly delegated the decision to F.** Item 6 (line 31): "F's call: rename, redirect via stub, or merge." Under the PR #73 constraint-override clause now codified in this very doc, a brief's delegation governs over a literal reading of the matching acceptance-criterion parenthetical. The criterion's "stub or removed" is a *presumed shape*, not a hard constraint, and the brief's delegation text is the authoritative seam.
2. **The chosen resolution actually resolves the underlying defect.** The gap analysis (`evidence-arch-md-review.md §2`) identifies the real defect as a *citation defect* — `auditarchitecture.md` cites a non-existent `architecture.md §Layering` section — not a duplicate-document defect. The two docs genuinely do not overlap in subject (code architecture vs. team/process architecture). Adding §Layering to `architecture.md` fixes the dangling citation, which is the criterion's actual intent.
3. **F surfaced the deviation transparently** — recorded in `decisions.md` D3, documented inside §Document Authority, and flagged prominently in `pr-body.md §"Decisions that deviate from spec"` for André's confirmation at merge. This is exactly the disclosure path the spec wants for a judgment-call deviation.
4. **One residual is correctly flagged, not hidden.** `auditarchitecture.md:71` still cites a non-existent `project-architecture.md §Module boundaries`. F is *forbidden* by the brief from editing `auditarchitecture.md`, so F flagged it as an open follow-up for André inside §Document Authority rather than silently editing a forbidden file. This is the spec-correct handling — the residual dangling citation is a pre-existing defect outside this story's authorized scope, not a regression introduced by it.

This deviation is surfaced for André's adjudication at PR open (it is a documented judgment call), but it does not force a BLOCK.

## Verdict

**PASS** — Argos may proceed to Phase 7 (open the PR).

Finding counts: **0 block, 0 warn, 2 nit.** Both nits are doc-precision improvements (anchor-link suffix; trivial-route file-org clause) already surfaced by A's iteration-1 review and carried into the PR body for André; neither impairs `architecture.md` as A's audit yardstick. The canonical-doc deviation is an acceptable, brief-delegated, transparently-disclosed judgment call — not a spec violation.
