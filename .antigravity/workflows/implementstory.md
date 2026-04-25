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
2. **No P0 gap blocks this story.** Review `docs/planning/gaps.md` for P0 items that would affect this story. If any P0 gap is directly relevant, halt and escalate to human reviewer.
3. **Planning docs consulted.** The Orchestrator has identified the relevant acceptance criteria from `docs/planning/product.md` or `docs/planning/architecture.md`.

---

## Phase 1 — Task Assignment

### 1.1 Argos cuts the story branch

Before writing the Brief, Argos:

1. Confirms preconditions (above).
2. Cuts `story/<taskId>` from current `main`.
3. Flips the task row in `docs/planning/tasks.md` from `[ ]` to `[/]`; commits on the story branch with message `chore(<taskId>): assign`.

### 1.2 Argos writes the Task Brief

Write to `.argos/<taskId>/brief.md` (gitignored — never commit it). Use this template verbatim, filling the angle-bracket placeholders from `docs/planning/tasks.md` and `docs/planning/gaps.md`:

```markdown
# Task Brief — <taskId>: <title>

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: <list of task IDs with [x], or "none">
- [x] No P0 gap blocks this story: <G-P0-XXX status each, or "none affecting this task">
- [x] Branch cut: `story/<taskId>` from `main` @ <short-sha>
- [x] `tasks.md` flipped `[ ]` → `[/]` on the story branch (commit `chore(<taskId>): assign`)

## Story

**Description.** <verbatim "###" line from `docs/planning/tasks.md`>

**Acceptance criteria.** <verbatim "Acceptance:" from `tasks.md`, broken into bullets for scannability>

**Test tiers required.** <verbatim `Test tiers required:` from `tasks.md`>

**Page verification tiers.** <verbatim `Page verification tiers:` from `tasks.md`, or "none (no rendered routes)">

**Critical test paths.** <verbatim `Critical test paths:` from `tasks.md`>

## Required reading

**Skills (full paths).**
- `skills/<name>.md` — <one-line why this skill applies here>
- …

**Planning doc sections.**
- `docs/planning/<file>.md §<section>` — <one-line why this section applies>
- …

**Org-wide context (optional deep-dive).** Each cited skill above has a `source:` frontmatter line pointing at Performant Labs's org-wide standards under `docs/ai_guidance/`. The symlink resolves on every workspace that has `~/Sites/ai_guidance` cloned (see `DEVELOPER_SETUP.md` "AntiGravity workspace readiness check" for setup). Skills inline the relevant rules — following the source is optional, useful when you want broader context or to verify a rule against the original. A broken `docs/ai_guidance/` symlink doesn't block feature work; PR-Agent in CI runs without it too.

## Next action (Feature-implementer)

1. Open a new session. Paste `.antigravity/agents/feature-implementer.md` as the first message, then this Brief as the second.
2. Check out `story/<taskId>` (already cut).
3. Read the Skills + Planning sections above.
4. Implement. Commits on `story/<taskId>` with messages `feat(<taskId>): …` / `refactor(<taskId>): …` / `fix(<taskId>): …`.
5. Write the feature-handoff to `.argos/<taskId>/feature-handoff.md` (template in `.antigravity/agents/feature-implementer.md`).
6. Return control to André so he can open the Test-writer session.
```

### 1.3 Feature-implementer (summary — full process in the agent file)

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

## Phase 3 — Structural Verification (Tier 2 or Tier 2.5)

**Executed by: Test-writer**

Choose the tier by the route's auth posture:

- **Tier 2** for unauthenticated routes (`/setup`, `/login`, `/forgot-password`, `/health`). Tools: `read_browser_page` or Playwright `accessibility.snapshot()` against a clean-room browser.
- **Tier 2.5** for any auth-gated route (everything past AUTH-001 — dashboard, run list, run detail, settings, AI panels, admin). Pre-condition: developer logs into a running CTRFHub instance (local `npm run dev` or per-PR Tugboat preview) in their daily-driver Chrome and leaves the tab active. Tool: `~/.local/bin/browser-harness` invoked via `Bash` heredoc, with `ensure_real_tab()` first to avoid reading a stray tab. Full method in `skills/page-verification-hierarchy.md §T2.5` and the report template in `.antigravity/agents/test-writer.md`.

Either tier reads the same kind of evidence:

1. Required heading structure present (`h1`, `h2` hierarchy correct).
2. Required interactive elements present (buttons, forms, links with correct labels).
3. ARIA roles correct (`role="table"`, `aria-label` on icon-only buttons, etc.).
4. No duplicate landmark roles.
5. **If the diff touches a layout token, backdrop, `[data-theme]` zone, or `@layer components` surface:** run the numeric WCAG contrast re-check from `skills/page-verification-hierarchy.md §Backdrop-contrast`.

After the structural assertions pass, run `npx playwright test` for any spec file covering this story (CI E2E lane uses `buildApp({ testing: true })` for fixture-user injection — that's parallel to T2.5, not a substitute).

**Gate:** the chosen tier MUST pass before proceeding to Tier 3. If it fails, return to Feature-implementer with the ARIA snapshot and specific remediation steps.

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

## Phase 7 — Story Close-out

**Executed by: Orchestrator**

This runs **between Spec-enforcer PASS and the PR opening**, so the status flip ships with the PR:

1. Check out `story/<taskId>` locally.
2. Read `.argos/<taskId>/spec-audit.md` — verify **PASS**. If BLOCK, return the story to the Feature-implementer per the escalation table below; do NOT proceed.
3. Flip the task row in `docs/planning/tasks.md` from `[/]` to `[x]`. Commit on the story branch with message `chore(<taskId>): complete`. This is the last commit on the branch before the PR opens.
4. Generate the PR body at `.argos/<taskId>/pr-body.md` (template below).
5. Return a summary to André:
   - Phases completed (T1 ✓, T2 ✓, T3 ✓ / N/A, Spec-enforcer PASS).
   - Test counts (unit / integration / E2E added).
   - Decisions deviating from spec (surfaced for André's final review).
   - Next assignable stories (tasks whose dependencies are now satisfied).

André then opens the PR with `gh pr create --base main --head story/<taskId> --title "[<taskId>] <summary>" --body-file .argos/<taskId>/pr-body.md`. PR-Agent picks up the review automatically.

---

## Phase 8 — PR body template

**Written by: Orchestrator at Phase 7.4. Consumed by: André at PR open. Also consumed by: PR-Agent for review context.**

Write to `.argos/<taskId>/pr-body.md`. Fill from the handoff notes produced in Phases 2-6.

```markdown
# [<taskId>] <title>

## Summary

<1–3 sentences describing what this PR ships and why>

## Acceptance criteria

Verbatim from `docs/planning/tasks.md` → `<taskId>` → `Acceptance:`. Check every box. If any box is unchecked, this PR is not ready.

- [x] <criterion 1>
- [x] <criterion 2>
- [x] …

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | <yes/no> | ✓ | <count> tests in `src/__tests__/unit/*` |
| Integration | <yes/no> | ✓ | <count> tests in `src/__tests__/integration/*` |
| E2E | <yes/no> | ✓ / N/A | <count> specs in `e2e/tests/*` |

## Page verification tiers

T2 *or* T2.5 — fill the row that applied; mark the other "N/A — see <other tier>".

| Tier | Declared | Result | Report location (story branch) |
|---|---|---|---|
| T1 Headless | <from tasks.md> | ✓ | `.argos/<taskId>/tier-1-report.md` |
| T2 ARIA (clean room) | <yes / no — unauthenticated route> | ✓ / N/A | `.argos/<taskId>/tier-2-report.md` |
| T2.5 Authenticated State | <yes / no — auth-gated route> | ✓ / N/A | `.argos/<taskId>/tier-2-5-report.md` |
| T3 Visual | <from tasks.md, or N/A> | ✓ / N/A | `.argos/<taskId>/tier-3-report.md` |

## Decisions that deviate from spec

List every choice not directly pinned down by `docs/planning/*` or `skills/*`. Spec-enforcer has already evaluated these; they are surfaced here so André can independently decide.

- <bullet describing the decision, the file it lives in, and why>
- **If none: "None — every decision is pinned to the spec."**

## Gaps filed during this story

- <G-ID — one-line summary — severity>
- **If none: "none"**

## Spec-enforcer verdict

**PASS** — see `.argos/<taskId>/spec-audit.md`
**Date:** <YYYY-MM-DD>

## Next assignable stories (after this merges)

- `<taskId>` — <title>
- …

---
_Generated from `.argos/<taskId>/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._
```

---

## Escalation conditions

| Condition | Action |
|---|---|
| P0 gap in `gaps.md` blocks this story | Halt. Document in handoff note. Human review required. |
| Feature-implementer makes a decision not covered by planning docs | Flag in handoff note. Spec-enforcer must confirm it doesn't violate any rule. |
| Any tier fails twice | Halt story. Escalate to Orchestrator with full failure output. |
| Spec-enforcer issues `BLOCK` | Return to Feature-implementer with remediation steps. Re-run from Phase 1. |
| TypeScript errors remain at Phase 1 handoff | Feature-implementer must resolve before any testing begins. |
