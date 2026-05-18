# Spec-enforcer Audit — duplicate-issue-detection — iteration 1

**Executed:** 2026-05-18 06:02
**Reviewer:** spec-enforcer (Claude Opus 4.7) — read-only
**Scope:** diff `main..story/duplicate-issue-detection` (head `5fc133c`)
**Checklists run:** Scope/constraint compliance, Security posture (CI-priority — least-privilege `permissions:`, script-injection), LLM-free requirement, License-caution comparison vs evidence doc §2, Brief scope-item delivery, Forbidden-pattern scan. Architecture-rules / Coverage / Planning-doc-conformance / Skills sections of the standard checklist are **not applicable** — this story adds no `src/` application code, no Fastify route, no entity, no template, no HTMX/Alpine surface (T correctly authored no committed test; verification-only by design).

## Prior-iteration check (iteration > 1 only)

N/A — iteration 1.

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| — | — | — | — | — |

No drift detected against `skills/` or `docs/planning/*`. The two `nit` items in `architecture-review-1.md` (tag-pinning vs SHA-pinning of `actions/stale@v9`; workflow `name:` verbosity) are A's, explicitly optional, and not re-litigated here — they violate no skill or planning section. A's item #3 (`warn`) is informational fail-loud behavior, not a finding.

## Coverage gaps

Coverage matches the story's declared Test tiers. This is a CI / issue-management infrastructure story: three new GitHub Actions workflows + two docs files, **no `src/` application code, no Fastify route, no pure `src/lib/` function**. A GitHub Actions workflow has no vitest-importable module surface and no Playwright-drivable route, so there is correctly nothing to cover. T's verification-only T1 (static YAML parse + executable shell/`jq` spot-checks) with T2/T2.5/T3 marked N/A is the right posture; precedent: `ctrfhub-docker-build-cache`, `test-writer-discipline`. Vitest coverage thresholds (lines 80 / functions 80 / branches 75) are unaffected — `main`'s 498 tests pass unchanged.

## Planning-doc conformance (only lines relevant to this story's scope)

This story touches no spec-governed application surface; no `docs/planning/*` line item applies. The story-specific brief criteria are confirmed instead:

- [x] Diff does **not** modify `docs/planning/*` — `git diff --name-only ... -- docs/planning/` empty.
- [x] Diff does **not** modify `src/`, `agents.md`, `CLAUDE.md`, `tasks.md`, or `package.json` — all empty.
- [x] Diff does **not** modify existing workflows `ci.yml` / `pr-review.yml` / `release.yml` — empty.
- [x] Diff is confined to the brief's permitted set: `.github/workflows/{dedupe-issues,stale,sync-labels}.yml`, `.github/labels.md`, `docs/issue-management.md` (+ this story's own `.argos/` artifacts). F declined the optional `package.json` script — within brief latitude.
- [x] LLM-free (brief core requirement + acceptance criterion 5) — only `uses:` directives across all three workflows are `actions/checkout@v4` and `actions/stale@v9`; the 8 `claude|anthropic|llm` string matches all sit in descriptive comments asserting *absence*; no `ANTHROPIC_API_KEY` or any LLM secret referenced.
- [x] Least-privilege `permissions:` on every new workflow — `dedupe-issues.yml`: `issues: write` + `contents: read`; `stale.yml`: `issues: write` + `pull-requests: write` + `contents: read` (PR-write genuinely exercised — workflow sweeps PRs by F's documented decision); `sync-labels.yml`: `issues: write` only. No scope exceeds step usage.
- [x] No script-injection vector (CLAUDE.md flags CI/workflow changes as a review priority) — re-confirmed independently: the attacker-controlled `github.event.issue.title` is bound at `dedupe-issues.yml:60` via the step `env:` block and consumed only as the quoted shell variable `"$ISSUE_TITLE"` (line 78). No `${{ ... }}` appears inside any `run:` body in either `dedupe-issues.yml` or `sync-labels.yml` (the only `${{ }}` occurrences are in `env:`/`concurrency:` keys). `ISSUE_NUMBER` is env-bound and additionally numerically coerced via `jq --argjson` (line 125). `set -euo pipefail` on every `run:` block.
- [x] License caution (brief Constraint) — dedupe comment text is independently worded, **not** a verbatim lift of `evidence-claudecode-workflows.md` §2. Anthropic's comment: terse `Found N possible duplicate issues:` + bare URLs + "automatically closed as a duplicate in 3 days" + 👍/👎 bullets + "🤖 Generated with [Claude Code]" tagline. F's comment: "Thanks for opening this issue. I found N issues that might be related:" + titled markdown links with state + a "please close this issue as a duplicate" closer + a freshly worded automated-suggestion disclaimer. F borrows the upstream *structure/tone* (count header, numbered list, close-as-duplicate closer, disclaimer) only — no verbatim phrasing, and notably drops the auto-close threat and the Claude tagline. Compliant.
- [x] Four brief scope items each delivered — (1) `dedupe-issues.yml` with `issues: opened` trigger, 5-keyword shell extraction, `gh issue list --search --state all --limit 10 --json`, `jq` self-filter, top-5 comment, dual silent paths; (2) `stale.yml` via `actions/stale@v9`, `cron '0 8 * * *'` + `workflow_dispatch`, 60/14 issue window, exempt labels, `operations-per-run: 30`; (3) `stale`/`pinned` labels ensured via the dedicated `sync-labels.yml` + documented in `.github/labels.md` — the brief explicitly permitted "a separate workflow"; (4) `docs/issue-management.md` describes bot behavior, stale lifecycle, exemption, and first-time setup. F's documented judgment calls (dedicated label workflow; lenient 90/14 PR schedule) are within the latitude the brief granted.

## Forbidden-pattern scan (from CLAUDE.md)

No application code in the diff; the HTMX/Alpine/ORM/Zod/test-tier forbidden patterns have no surface here. Scanned and explicitly clear:

- [x] No `hx-target`/`hx-swap` inherited from a parent — no templates in diff.
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — no client code in diff.
- [x] No `hx-disable` anywhere — no templates in diff.
- [x] No Alpine `x-data` inside an HTMX swap target (or vice versa) — no templates in diff.
- [x] No Postgres-only SQL / dialect-specific features — no entities or migrations in diff.
- [x] No DB mocked in integration tests — no tests in diff (none required).
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — no Playwright surface; T2/T3 correctly N/A.
- [x] No layout-token change without a T2 backdrop-contrast re-check — no CSS / layout-token / template change.
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — no auth code in diff.
- [x] No Zod schema defined ad-hoc in a handler — no handler code in diff.
- [x] (Story-specific) No Claude/Anthropic/LLM action or secret in any workflow — confirmed clean.
- [x] (Story-specific, CI review priority) No `${{ }}` interpolation of untrusted input into a `run:` body — confirmed clean.

## Verdict

**PASS** — Argos may proceed to Phase 7 (open the PR).

All four brief scope items are delivered within the permitted file set; the diff modifies no `docs/planning/*`, no `src/`, no agent file, and none of the existing `ci.yml`/`pr-review.yml`/`release.yml`. The brief's core LLM-free requirement holds, least-privilege permissions are correct on all three workflows, the untrusted-issue-title script-injection vector is closed (env-bound, never `${{ }}`-interpolated), and the dedupe comment is independently worded against the upstream reference. Acceptance criteria 1 & 3 are live-GitHub-run-observable and were verified statically + by executable spot-check rather than a live run — per the brief and Argos's Phase-1 notes this is accepted and is not grounds to BLOCK. No `block`-severity findings; no coverage gaps.
