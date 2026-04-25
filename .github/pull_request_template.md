<!--
  CTRFHub pull request template.

  When Argos opens a PR via the /implementstory workflow, this template is
  overridden by `.argos/<taskId>/pr-body.md` (see
  `.antigravity/workflows/implementstory.md` §Phase 8). If you are Argos,
  ignore what's below and use the Phase 8 template.

  This template is what GitHub's web UI prefills when a human opens a PR
  manually. Keep it structurally aligned with the Phase 8 template so both
  origins produce the same PR shape — the reviewer (André) and PR-Agent
  both assume the shape is stable.
-->

## Summary

<!-- 1–3 sentences describing what this PR ships and why -->

## Linked story

Story: `<taskId>` (from `docs/planning/tasks.md`)

<!-- If this PR is not tied to a backlog story, delete the line above and explain the context and why no story was created. -->

## Acceptance criteria

<!-- Copy the `Acceptance:` bullets verbatim from docs/planning/tasks.md → <taskId>. Check every box before opening; unchecked boxes mean the PR isn't ready. -->

- [ ] <criterion 1>
- [ ] <criterion 2>

## Test tiers

| Layer | Declared in `tasks.md` | Present in diff | Notes |
|---|---|---|---|
| Unit | <yes/no> | <yes/no> | <count tests / path> |
| Integration | <yes/no> | <yes/no> | <named error paths covered> |
| E2E | <yes/no/N/A> | <yes/no> | <spec file> |

## Page verification tiers

T2 *and* T2.5 are mutually exclusive — fill the row that matched the route's auth posture; mark the other N/A.

| Tier | Declared | Result | Notes |
|---|---|---|---|
| T1 Headless | <yes/no> | <pass/fail/N/A> | |
| T2 ARIA (clean room — unauthenticated routes) | <yes/no> | <pass/fail/N/A> | |
| T2.5 Authenticated State (browser-harness) | <yes/no> | <pass/fail/N/A> | |
| T3 Visual | <yes/no/N/A> | <pass/fail/N/A> | |

<!-- For T2 / T2.5: if this PR changes a layout token, backdrop, [data-theme] zone, or background, include the numeric WCAG contrast ratio per skills/page-verification-hierarchy.md §Backdrop-contrast WCAG re-check. -->

## Decisions that deviate from spec

<!-- List any decision not pinned down in docs/planning/* or skills/*. Each bullet: what, why, which doc/skill it adjoins. If none: write "None — every decision is pinned to the spec." -->

- <bullet>

## Gaps filed during this story

<!-- Every new G-ID added to docs/planning/gaps.md as part of this work. If none: "none". -->

- <G-ID — one-line summary — severity>

## Spec-enforcer verdict

<!--
  For Argos-driven stories: PASS (link to .argos/<taskId>/spec-audit.md lives on the story branch only).
  For manual PRs: write "N/A (manual PR)" with a reason why no audit was run (e.g. "trivial docs-only change").
-->

**Verdict:** <PASS / N/A>
**Date:** <YYYY-MM-DD>

## Apply `high-stakes` label if this PR touches any of

Auth, session handling, API tokens, `/setup`, password reset, email verification, migrations, dialect-sensitive SQL, artifact storage, retention / pruning jobs, security headers / CSP, rate limiter, or the public API contract. The label routes PR-Agent to Opus 4.6 for the review.
