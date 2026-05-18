# [duplicate-issue-detection] Add duplicate-issue detection and stale-issue workflows (LLM-free)

## Summary

Adds two issue-management automations modeled on anthropics/claude-code's
workflow structure but with **every Claude/LLM call replaced by simpler
primitives** — zero recurring cost. A `dedupe-issues.yml` workflow surfaces
possibly-similar prior issues on each new issue using GitHub's own search
ranking; a `stale.yml` workflow uses the canonical `actions/stale@v9` to label
and (after a window) close inactive issues and PRs. A `sync-labels.yml` workflow
idempotently creates the required `stale` label. No application code changes.

## Acceptance criteria

Verbatim from `.argos/stories/duplicate-issue-detection/brief.md`.

- [x] New issue opened → dedupe workflow runs, comment appears with 0–5 candidates linked — **mechanism delivered**; observable on a live GitHub run. Static + executable spot-check confirmed keyword extraction and the top-5 comment path (see `tier-1-report.md`).
- [x] 0-candidate path silent (no comment) — verified by executing the `jq` self-filter snippet: an only-self candidate set yields `[]` / `MATCH_COUNT 0` → no comment.
- [x] `actions/stale` runs on `workflow_dispatch`; fixture-aged issue gets the `stale` label + comment — **mechanism delivered** (`stale.yml` declares `workflow_dispatch`, `actions/stale@v9`, 60/14-day issue config); observable on a live run.
- [x] All existing CI green — `npm test` → 498 pass, `tsc --noEmit` clean; existing workflows (`ci.yml`, `pr-review.yml`, `release.yml`) untouched.
- [x] No LLM API calls — verified statically: the only `uses:` directives are `actions/checkout@v4` and `actions/stale@v9`; no Claude/Anthropic action, no `ANTHROPIC_API_KEY`.

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | n/a — CI-infra story | N/A | No application code; GitHub Actions YAML has no vitest surface |
| Integration | n/a | N/A | Live-run criteria observable only on a real GitHub Actions run |
| E2E | n/a | N/A | No route or UI |

No committed test files were authored — a GitHub Actions workflow has no
vitest/Playwright surface. T verified statically + via an executable spot-check
of the embedded shell/`jq` logic, and confirmed the existing suite is unchanged
(498 pass). Verification-only precedent: `ctrfhub-docker-build-cache`,
`test-writer-discipline`.

## Page verification tiers

| Tier | Declared | Result | Report location (story branch) |
|---|---|---|---|
| T1 Headless | yes (judgment — static + executable spot-check) | ✓ | `.argos/stories/duplicate-issue-detection/tier-1-report.md` |
| T2 ARIA (clean room) | no — no rendered route | N/A | `.argos/stories/duplicate-issue-detection/tier-2-report.md` |
| T2.5 Authenticated State | no — see tier-2-report.md | N/A | see `tier-2-report.md` |
| T3 Visual | no — no UI | N/A | see `tier-2-report.md` |

## Architecture reviews

| # | Verdict | File |
|---|---|---|
| 1 | PASS | `.argos/stories/duplicate-issue-detection/architecture-review-1.md` |

## Security note

`dedupe-issues.yml` consumes an attacker-controlled issue title (anyone can open
an issue). A reviewed this as the highest-priority check and confirmed **no
script-injection vector**: the title is bound via `env:` and consumed only as a
quoted shell variable `"$ISSUE_TITLE"` — never interpolated into a `run:` body
as `${{ github.event.issue.title }}`. Both new workflows declare least-privilege
`permissions:` blocks (A and T independently confirmed no excess scope).

## Decisions that deviate from spec

- **Label creation via a dedicated `sync-labels.yml` workflow** (the brief offered "a workflow OR docs"). `actions/stale` does not auto-create its label, so F chose a reliable idempotent `workflow_dispatch` creator; `.github/labels.md` documents the manual `gh` fallback too.
- **PR staleness on a more lenient 90/14-day schedule** (vs. 60/14 for issues) — the brief left PR specifics to F's judgment; open PRs are in-flight work and closing is reversible.
- **Acceptance criteria 1 & 3 are live-run-observable.** Their literal verification ("new issue opened in a fork", "`workflow_dispatch` run") requires a live GitHub Actions run, not performable in the local environment. T verified the documented mechanism + static/executable correctness; this did not cause a BLOCK, per the brief's framing.
- **Three A `nit`/`warn` notes left unaddressed (non-blocking):** actions are version-tagged not SHA-pinned (matches existing repo convention), minor workflow-name verbosity, and fail-loud `gh` behavior (which is correct). A flagged none as `block`.

## Gaps filed during this story

- none

## Spec-enforcer verdict

**PASS** — see `.argos/stories/duplicate-issue-detection/spec-audit-1.md` (M=1)
**Date:** 2026-05-18

## Next assignable stories (after this merges)

- Queued in `.argos/stories/`: `architecture-baseline` (state not assessed by this story).

---
_Generated from `.argos/stories/duplicate-issue-detection/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._
