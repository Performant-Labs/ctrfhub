# Architecture review — test-writer-discipline — iteration 1

**Reviewer:** architecture-reviewer (Claude Opus 4.7) — review mode
**Date:** 2026-05-18
**Verdict:** PASS
**Diff base:** main @ 4e07a3c
**Diff head:** story/test-writer-discipline @ eb21b89

## Summary

PASS. This governance-documentation + tooling story is fully scope-confined,
internally coherent, and addresses the root cause diagnosed in `evidence-audit.md`.
The three doc edits (test-writer.md, verifystory.md, audit-tests.md), the new
`scripts/` audit script, and the `package.json` wiring all hold together; the
audit script runs green, cannot pass vacuously, and follows the established
colon-namespaced convention. Both Argos binding decisions are honored. The only
findings are two `nit`-level documentation-locator imprecisions — no `block`,
no `warn`.

## Findings

| # | Severity | File:line | Drift dimension | Finding | Suggested fix |
|---|---|---|---|---|---|
| 1 | nit | `.claude/agents/test-writer.md:27`, `.claude/agents/test-writer.md:298` | document coherence | Responsibility 4 and the test-handoff template both say "See the worked counter-example **under §Boundaries**" / "see §Boundaries". The counter-example and the pre-handoff self-check actually live in the new top-level `## Test-sizing rule` section, not in `## Boundaries (hard)`. The only thing added to §Boundaries is the no-duplication bullet. A reader following the cross-reference lands one section short. | Change the two cross-references to point at `§Test-sizing rule` (or split the difference: "see §Test-sizing rule — Worked counter-example"). Not load-bearing — the script keys on rule text, not section names — but tidy it for navigability. |
| 2 | nit | `docs/orchestrator-workflows/audit-tests.md` (Phase 6 example block) | document coherence | The new `[block] Over-coverage` example finding cites `static-asset-auth-bypass.test.ts:30` and `ALL_ASSET_PATHS`, which is fine as an illustrative example, but the surrounding audit-tests.md examples are otherwise generic (`settings/routes.ts`, `ingest/service.ts`). Tying a workflow-doc example to one real, still-uncleaned file is slightly brittle once the housekeeping pass trims that file. | Optional: keep it (it is a real, instructive case) or genericize the path. No action required. |

## Prior-iteration check (iteration > 1 only)

N/A — iteration 1.

## Review against the five requested checks

1. **Scope confinement — PASS.** `git diff main..story/test-writer-discipline
   --name-only` touches exactly: `.claude/agents/test-writer.md`,
   `docs/orchestrator-workflows/audit-tests.md`,
   `docs/orchestrator-workflows/verifystory.md`, `package.json`,
   `scripts/check-test-discipline-rules.sh` (new), and four `.argos/stories/test-writer-discipline/`
   files. No `src/` change. The build-fix story's `static-asset-auth-bypass.test.ts`
   is **not** in the diff — acceptance criterion 3 honored. No edit to
   `feature-implementer.md`, `architecture-reviewer.md`, or `spec-enforcer.md`.
   Editing `test-writer.md` is in scope and correct.

2. **Internal consistency — PASS.** The test-sizing rule (one-test-per-branch),
   the 4xx-matrix-as-ceiling reframe (Responsibility 4 + `## Test-sizing rule`),
   the worked ❌/✅ counter-example, the pre-handoff self-check, and the
   no-duplication boundary do not contradict each other or the unchanged parts of
   the file. Responsibilities 3 and 5 still say "every new pure function" / "every
   new screen's happy path" — this is **not** a contradiction: those are
   per-unit/per-screen floors, while the new ceiling governs how many tests one
   *branch* gets. The reframe narrows only the 4xx route matrix, which is the exact
   target of `evidence-audit.md` Section C item 1. The self-check appears coherently
   in BOTH `test-writer.md` (`## Test-sizing rule` + `On exit` step 1 + handoff
   template) and `verifystory.md` (Phase E `### Pre-handoff self-check`) with the
   identical load-bearing question string.

3. **`audit-tests.md` reframe — PASS.** The metric genuinely changed: new Phase 4
   preamble states pressure is "bidirectional"; new `### 4a. Fan-out detection`
   makes "tests per distinct code branch" the metric and flags a ratio "noticeably
   above 1" as `[block]` over-coverage — symmetric with the existing `[block]`
   under-coverage finding. Phase 6 summary table splits "Coverage gaps
   (under-coverage)" from "Over-coverage / fan-out findings", and a worked
   `[block] Over-coverage` example is added. This directly addresses
   `evidence-audit.md` Section C item 3 (one-directional file-existence reward).

4. **Audit script quality — PASS.** `scripts/check-test-discipline-rules.sh` is
   sound: `set -euo pipefail`, `cd "$(dirname "$0")/.."` for path-independence,
   `grep -qiF --` (fixed-string, case-insensitive, `--` guards against
   needles starting with `-`), per-rule `✓`/`✗` report, missing-file branch,
   accumulating `FAILURES` counter, exit 1 with a remediation message on any
   miss, exit 0 otherwise, marked executable (mode 100755). It checks 11 rule
   substrings across all three docs — I independently verified every needle
   exists in its target doc and that the script exits 0; it cannot pass
   vacuously (each needle is a load-bearing fragment of the actual rule text;
   F's reported negative test — delete a line → `✗` + exit 1 — is consistent
   with the logic). The `package.json` entry `"check:test-discipline": "bash
   scripts/check-test-discipline-rules.sh"` follows the established
   colon-namespaced convention (`test:unit`, `docker:build:cached`) and the
   `check:` prefix is correctly distinct from the `test:` vitest namespace.

5. **Brief binding decisions — PASS.** Decision 1: criterion 1's artifact is the
   `scripts/` script — no `src/__tests__/` unit test was added (verified: nothing
   under `__tests__` in the diff). Decision 2: no criterion-2 dry-run was
   attempted; the handoff explicitly defers it to the Phase 4 T spawn.

## Notes for the implementer (BLOCK only)

N/A — verdict is PASS. The two `nit` findings are optional polish, not required
for merge.

## Patterns referenced

- `package.json` (lines 14–33) — established colon-namespaced npm-script
  convention; `docker:build:cached` precedent for the `bash scripts/*.sh` wiring.
- `.claude/agents/test-writer.md` (unchanged Responsibilities 3/5, §Boundaries) —
  baseline for confirming the ceiling rule does not contradict the existing floors.
- `docs/orchestrator-workflows/audit-tests.md` (Phase 4 / Phase 6, pre-edit) —
  baseline showing the one-directional file-existence reward the reframe corrects.
- `docs/orchestrator-workflows/verifystory.md` (Phase E) — attach point for the
  self-check; confirmed it is the coverage gate where T last touches tests.
- `.argos/stories/test-writer-discipline/evidence-audit.md` Sections C & D —
  the root-cause/recommendation baseline the edits are audited against.
