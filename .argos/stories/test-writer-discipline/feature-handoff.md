# Feature handoff — test-writer-discipline

## Iteration 1

**Date:** 2026-05-18
**Branch:** `story/test-writer-discipline`
**Commits added this iteration:**
- (see git log) `docs(test-writer-discipline): tune test-writer agent for minimum-meaningful coverage`

### What was built / fixed

This is a governance-documentation + tooling story. It tunes the test-writer (T)
agent so it lands minimum-meaningful coverage instead of matrix fan-out — the
root cause diagnosed in `evidence-audit.md` (31 tests for a one-`if` change).

- **Edit 1 — test-sizing rule** added to `test-writer.md` as a new `## Test-sizing rule` section.
- **Edit 2 — 4xx matrix reframed** as a per-route *ceiling* (not floor/multiplier), in both Responsibility 4 and the new section, with a worked counter-example.
- **Edit 3 — pre-handoff self-check** added to `test-writer.md` AND `verifystory.md`.
- **Edit 4 — fan-out penalty** added to `audit-tests.md` Phase 4 — metric is now tests-per-distinct-branch, bidirectional coverage pressure.
- **Edit 5 — audit script** `scripts/check-test-discipline-rules.sh` verifies all the above rule text is present; wired into `package.json` as `check:test-discipline`.

### Commands run locally (results)

- `npx tsc --noEmit` — 0 errors.
- `npm run check:test-discipline` — PASS (all 11 rule checks ✓, exit 0).
- Negative test: removed one rule line, script reported `✗` for that rule and exited 1 with a clear remediation message; restored, exit 0 again.
- No migrations (no entity changes). No dev-server boot (no application code touched).

### Files created or modified

- `.claude/agents/test-writer.md` — Responsibility 4 reframed; new `## Test-sizing rule` section (one-test-per-branch rule, per-route ceiling, loop=one-test rule, no-duplication boundary, worked counter-example, pre-handoff self-check); test-handoff template gains a tests-per-distinct-branch line and self-check confirmation; `On exit` gains the self-check step.
- `docs/orchestrator-workflows/verifystory.md` — Phase E gains a mandatory `### Pre-handoff self-check` subsection.
- `docs/orchestrator-workflows/audit-tests.md` — Phase 4 gains `### 4a. Fan-out detection` (tests-per-distinct-branch metric, bidirectional pressure, grep for fan-out loops); Phase 6 summary table splits coverage into under-/over-coverage; an over-coverage example finding added; Phase summary table updated.
- `scripts/check-test-discipline-rules.sh` — new, executable; greps the three docs for the required rule wording, exits 1 with a per-rule report if any is missing.
- `package.json` — new script `check:test-discipline` (mirrors the `docker:build:cached` convention from the build-cache story).

### Exact rule text added

**Test-sizing rule (`test-writer.md`):**
> One test per distinct branch added. One test per distinct branch removed. The 4xx response-code matrix (401 / 422 / 429 / 413) is a per-route ceiling, not a per-asset multiplier. Loops over input strings that all exercise the same code branch count as ONE test, not N. When a conditional keys on a string prefix, every value matching that prefix takes the identical code path — one value proves the branch; the rest add zero branch coverage.

**Per-route ceiling reframe (Responsibility 4):** the 401/422/429/413 matrix "is a per-route ceiling of the *applicable* cases — not a floor and not a multiplier. It applies only when the diff actually adds a route" and only for codes the route can genuinely return.

**Pre-handoff self-check (`test-writer.md` + `verifystory.md`):**
> For every new test, answer — "Would this test fail in isolation if the code were wrong?" If the answer is "no — it only fails if another test would also fail," delete the test.

**Fan-out penalty (`audit-tests.md`):** "Coverage pressure in this phase is bidirectional… The audit metric is tests per distinct code branch… A ratio noticeably above 1 is a `[block]` over-coverage finding."

### The worked counter-example

`test-writer.md §Boundaries` contains a ❌/✅ pair. The ❌ shows a `for` loop over
6 asset paths × 4 assertions producing 24 tests for one `startsWith('/assets/')`
prefix check — and notes that the "no HX-Redirect" assertions test an outcome the
early `return` makes physically unreachable. The ✅ shows the correct ~4-test
version: one branch test, one negative, one boundary (`/assetsx`), one for the
real extra logic (query-string stripping) — smaller and strictly more diagnostic.

### How the audit script verifies presence

`scripts/check-test-discipline-rules.sh` uses `grep -qiF` against fixed,
load-bearing substrings of each rule across the three docs (11 checks total). Each
miss prints the file and the missing string; any miss exits 1 with a remediation
message. Run via `npm run check:test-discipline`. It is the verification artifact
for acceptance criterion 1 (Argos binding Decision 1 — a script in `scripts/`, not
a `src/__tests__/` unit test, since a test file would fall outside this story's
allowed file set).

### Decisions not covered by planning docs

- **Script language: bash.** Chosen to match `scripts/docker-build-cached.sh` (the build-cache story's precedent) and the `package.json` wiring style (`"docker:build:cached": "bash scripts/..."`). Adjoins the brief's instruction to "check how `docker:build:cached` was added."
- **Script name `check:test-discipline` / `check-test-discipline-rules.sh`.** No `check:*` namespace existed; chosen as a self-describing governance-lint name distinct from the `test:*` (vitest) namespace, so it is not mistaken for a test runner.
- **Self-check placed in `verifystory.md` Phase E** (the coverage gate — T's final phase before the aggregate handoff), as a `### Pre-handoff self-check` subsection. The brief said "add to T's workflow"; Phase E is where T last touches tests before its handoff, so it is the natural attach point.

### Findings addressed

N/A — iteration 1 from `brief.md`, not a review/fix-pass.

### Known issues / follow-ups

- The build-fix story's existing 31-test file (`src/__tests__/integration/static-asset-auth-bypass.test.ts`) is intentionally left untouched (brief constraint + acceptance criterion 3). The new rules are forward-looking; a separate housekeeping pass trims that file.
- Acceptance criterion 2's dry-run (re-deriving the build-fix test file under the new rules) is performed by the Phase 4 T spawn per Argos binding Decision 2 — not part of this F iteration.
