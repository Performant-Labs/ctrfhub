# Workflow: /implementstory <taskId>

## Purpose

End-to-end implementation workflow for a single task from `tasks.md`. Enforces skill compliance, three-tier testing, and spec-conformance before the story is marked complete.

## Invocation

```
/implementstory <taskId>
```

Example: `/implementstory INFRA-002` or `/implementstory CTRF-001`

---

## Preconditions

Before starting, the Orchestrator MUST verify:

1. **Dependencies satisfied.** Every task listed in the `depends_on` field of `<taskId>` in `tasks.md` is marked `[x]`. Do not start if any dependency is `[ ]` or `[/]`.
2. **No P0 gap blocks this story.** Review `docs/ai_guidance/gaps.md` for P0 items that would affect this story. If any P0 gap is directly relevant, halt and escalate to human reviewer.
3. **Planning docs consulted.** The Orchestrator has identified the relevant acceptance criteria from `docs/planning/product.md` or `docs/planning/architecture.md`.

---

## Phase 1 — Task Assignment

### Orchestrator produces a Task Brief for the Feature-implementer:

```
Task ID: <taskId>
Description: <from tasks.md>
Acceptance criteria: <exact lines from product.md or architecture.md>
Required skills:
  - skills/<required-skill-1>.md
  - skills/<required-skill-2>.md
  (list all skills whose trigger conditions apply)
Dependencies already built: <list completed dependency task IDs>
Known gaps that affect this task: <from gaps.md, or "none">
```

### Feature-implementer:

1. Reads all required skills listed in the brief.
2. Reads the relevant planning doc sections.
3. Implements the story.
4. Runs `tsc --noEmit` — must produce zero errors.
5. Creates migrations for both dialects if entities changed.
6. Runs `npm run dev` — server must start without errors.
7. Produces a handoff note: what was built, commands run, any decisions not specified in docs.

---

## Phase 2 — Tier 1 Verification (Headless)

**Executed by: Test-writer (or the Feature-implementer as a self-check)**

1. For every new API route: run `npm run test:int` or `curl` against the running dev server.
2. Assert: correct HTTP status codes (201, 422, 401, 404, 429 as applicable).
3. Assert: correct response JSON shape.
4. Assert: HTMX partial routes return HTML without `<html` when `HX-Request: true` is sent.
5. Assert: HTMX partial routes return full layout (contains `<html`) for direct navigation.

**Gate:** Tier 1 MUST pass before proceeding to Tier 2.

---

## Phase 3 — Tier 2 Verification (ARIA Structural Skeleton)

**Executed by: Test-writer**

1. Start the dev server with the implemented story loaded.
2. Navigate to the relevant screen using `browser_subagent` or `read_browser_page`.
3. Read the ARIA tree and verify:
   - Required heading structure present (`h1`, `h2` hierarchy correct).
   - Required interactive elements present (buttons, forms, links with correct labels).
   - ARIA roles correct (`role="table"`, `aria-label` on icon-only buttons, etc.).
   - No duplicate landmark roles.
4. Run `npx playwright test` for the spec file covering this story (if it exists).

**Gate:** Tier 2 MUST pass before proceeding to Tier 3. If Tier 2 fails, return to Feature-implementer with the ARIA snapshot and specific remediation steps.

---

## Phase 4 — Test Authoring

**Executed by: Test-writer**

Write or update test files:

1. **Unit tests** — for every new pure function added by the Feature-implementer. Place in `src/__tests__/unit/`.
2. **Integration tests** — for every new route, covering all acceptance criteria, auth errors, and validation errors. Place in `src/__tests__/integration/`.
3. **E2E test** — for the happy-path user workflow (if this story has a screen). Place in `e2e/tests/`.
4. Run `npm run test` — all existing and new tests must pass.
5. Run `npm run test:coverage` — verify coverage thresholds are met.

---

## Phase 5 — Tier 3 Verification (Visual Sign-off)

**Executed by: Test-writer**

**Only performed for stories that involve UI changes.**

1. Start dev server with the story implemented.
2. Use `browser_subagent` to capture screenshots of:
   - The happy-path screen at 1280×800.
   - The narrow-smoke check at 375×800.
3. Assert visual correctness:
   - Dark surface background (`--color-surface`).
   - Status badges use `.badge-pass`, `.badge-fail`, `.badge-skip`, `.badge-flaky` classes.
   - No layout overflow at 375×800 (outside `overflow-x-auto` containers).
4. Embed screenshots in the verification report (one subagent call per design slice — no full-page composites).

**Gate:** Tier 3 MUST pass for UI stories. Non-UI stories (API-only) skip this phase.

---

## Phase 6 — Spec-enforcer Audit

**Executed by: Spec-enforcer**

The Orchestrator commissions a spot-audit of the story's diff:

1. Spec-enforcer reads the changed files.
2. Runs the relevant sections of its audit checklist (`spec-enforcer.md §Audit Checklist`).
3. Produces: **PASS** or **BLOCK** verdict with findings.

**Gate:** Spec-enforcer verdict must be **PASS** before the story is marked complete.

---

## Phase 7 — Story Completion

**Executed by: Orchestrator**

1. Update `tasks.md`: mark `<taskId>` as `[x]`.
2. Record in the handoff note:
   - Task ID and description.
   - Phases completed (T1 ✓, T2 ✓, T3 ✓ or N/A, Spec-enforcer ✓).
   - Test counts (unit, integration, E2E added).
   - Any decisions that deviate from the spec (forward to human reviewer).
3. Identify the next task(s) whose dependencies are now satisfied.

---

## Escalation conditions

| Condition | Action |
|---|---|
| P0 gap in `gaps.md` blocks this story | Halt. Document in handoff note. Human review required. |
| Feature-implementer makes a decision not covered by planning docs | Flag in handoff note. Spec-enforcer must confirm it doesn't violate any rule. |
| Any tier fails twice | Halt story. Escalate to Orchestrator with full failure output. |
| Spec-enforcer issues `BLOCK` | Return to Feature-implementer with remediation steps. Re-run from Phase 1. |
| TypeScript errors remain at Phase 1 handoff | Feature-implementer must resolve before any testing begins. |
