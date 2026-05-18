# Tier 1 Headless Report — test-writer-discipline

**Executed:** 2026-05-18 04:07
**Method:** `npm run check:test-discipline` (bash audit script) · `npx vitest run` · `npx tsc --noEmit` — no browser, no rendered route.

This is a governance + tooling story (no application code, no rendered route).
"Tier 1" here means headless verification of the three acceptance criteria via
the audit script, the criterion-2 dry-run artifact, and the regression baseline.

## Checks

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | Criterion 1 — audit script confirms the new rule text is present in all three docs | `npm run check:test-discipline` | 11/11 rule checks ✓, exit 0, `PASS` line | 11/11 ✓ across `test-writer.md` (6), `verifystory.md` (2), `audit-tests.md` (3); `==> PASS`; exit 0 | ✓ |
| 2 | Criterion 2 — re-derived `ctrfhub-docker-build-fix` test set under the tuned rules lands ≤ 12 tests (target band 8–10 load-bearing) | Dry-run analysis — see `dry-run-rederived-tests.md` | ≤ 12; 8–10 load-bearing | **8 tests** (was 31); 8/8 load-bearing; 0 fan-out, 0 duplicates, 0 unreachable-outcome assertions | ✓ |
| 3 | Criterion 3 — existing 31-test file intact and still green | `git status` + `git log` on the file; `npx vitest run src/__tests__/integration/static-asset-auth-bypass.test.ts` | File present, unmodified, 31/31 pass | Present (342 lines), no working-tree changes, last commit `142fb97` (PR #71); **31/31 pass** | ✓ |
| 4 | Regression baseline — full suite green (no app code changed this story) | `npm test` | 498 tests pass | **498/498 pass**, 23 files passed | ✓ |
| 5 | TypeScript typecheck clean | `npx tsc --noEmit` | 0 errors, exit 0 | 0 errors, exit 0 | ✓ |

## Criterion 1 — audit script (raw output)

```
==> Checking test-writer discipline rules

.claude/agents/test-writer.md
  ✓ test-sizing rule — one test per distinct branch added
  ✓ test-sizing rule — one test per distinct branch removed
  ✓ 4xx matrix is a per-route ceiling, not a per-asset multiplier
  ✓ loops over inputs sharing a branch count as ONE test
  ✓ worked counter-example present (24-test fan-out)
  ✓ pre-handoff self-check — fail-in-isolation question

docs/orchestrator-workflows/verifystory.md
  ✓ pre-handoff self-check present in verifystory workflow
  ✓ pre-handoff self-check is mandatory before handoff

docs/orchestrator-workflows/audit-tests.md
  ✓ fan-out penalized — metric is tests-per-distinct-branch
  ✓ coverage pressure is bidirectional, not one-directional
  ✓ fan-out detection section present

==> PASS: all test-writer discipline rules present.
EXIT: 0
```

## Criterion 2 — dry-run outcome

Full analysis: `.argos/stories/test-writer-discipline/dry-run-rederived-tests.md`.

The Phase 4 T spawn (this invocation), running under the freshly-tuned
`.claude/agents/test-writer.md` on `story/test-writer-discipline`, re-derived the
`ctrfhub-docker-build-fix` test set independently:

- **31 → 8 tests.** Inside the ≤ 12 ceiling, squarely in the 8–10 load-bearing
  target band.
- The change under test adds **no route** (`/assets/*` already existed via
  `@fastify/static`) — so the 401/422/429/413 matrix does not apply, per the new
  per-route-ceiling reframe.
- 5 distinct code paths identified; tests-per-distinct-branch ratio **1.6**
  (was 6.2 — heavy fan-out).
- Removed: ~18 matrix fan-out (loops over asset paths sharing one `startsWith`
  prefix branch), ~6 unreachable-outcome `HX-Redirect` assertions (Branch 0
  returns first), ~4 cross-file duplicates owned by `health.test.ts` /
  `auth.test.ts`.
- All 8 re-derived tests pass the pre-handoff self-check ("would this test fail
  in isolation if the code were wrong?" — yes for all 8).
- Mapped 1:1 against `evidence-audit.md` Section A's 10-group breakdown; the
  audit's ~9-load-bearing estimate resolves to 8 (Group 9's D4/D5 proved fully
  transitive coverage of path P1).

The dry-run is an **analysis artifact only** — no file under `src/__tests__/`
was created, modified, or deleted (binding Decision 2 + criterion 3).

## Criterion 3 — existing 31-test file intact

```
src/__tests__/integration/static-asset-auth-bypass.test.ts
  342 lines · last commit 142fb97 ([ctrfhub-docker-build-fix] PR #71)
  git status: clean (no working-tree modification)

  ✓ static-asset-auth-bypass.test.ts (31 tests) 616ms
  Tests  31 passed (31)
```

The build-fix story's existing 31-test file is **not modified, overwritten, or
deleted** and still passes 31/31. The dry-run re-derivation is forward-looking
analysis only; a separate housekeeping pass may trim the real file later.

## Regression baseline (raw excerpt)

```
 Test Files  23 passed (23)
      Tests  498 passed (498)
   Duration  7.11s
```

`npx tsc --noEmit` — 0 errors, exit 0.

## Verdict

**PASS** — all three acceptance criteria verified headlessly. Criterion 1 audit
script green (11/11, exit 0); criterion 2 dry-run lands 8 tests (≤ 12, in the
8–10 band); criterion 3 existing 31-test file intact and 31/31 green; full suite
498/498; typecheck clean.
