# Test-writer audit — `ctrfhub-docker-build-fix`

**Subject:** 31 integration tests added in `src/__tests__/integration/static-asset-auth-bypass.test.ts`
for a 1-branch app change. **Verdict: T is over-testing.** ~9 tests load-bearing; ~22 are matrix
fan-out or duplicates of existing files.

## The app change (one paragraph)

`src/app.ts` adds **Branch 0** to the global `onRequest` auth hook: it hoists the existing
`rawPath` declaration above the hook body and inserts `if (rawPath.startsWith('/assets/')) return;`.
Any request whose path starts with `/assets/` skips every auth branch and is served by
`@fastify/static`. Net behavior: 13 insertions / 8 deletions, one new conditional, one prefix check.

## Section A — Test breakdown (31)

| # | Group (intent) | Count |
|---|---|---|
| 1 | Vendored JS files return **200 without auth** (`for VENDORED_JS`, 5) + "serves real bytes" (1) | 6 |
| 2 | Asset paths **not redirected** to /setup or /login (`for ALL_ASSET_PATHS`, 6) | 6 |
| 3 | Asset paths emit **no `HX-Redirect`** header for HTMX requests (`for ALL_ASSET_PATHS`, 6) | 6 |
| 4 | Missing asset still **404**, and not redirected (Suite B) | 2 |
| 5 | Non-asset routes still redirect to /setup on empty DB — Branch 1 (`/`, `/nonexistent`, `/dashboard`) | 3 |
| 6 | `/health` still exempt, returns 200 | 1 |
| 7 | Path-prefix exactness — `/my-assets` & `/assetsx` still gate | 1 |
| 8 | Non-asset routes gate when users exist — Branch 5 `/`, HTMX `/dashboard`, Branch 3 bad-token 401 | 3 |
| 9 | Asset bypass persists when users exist (D4) + bad token on asset ignored (D5) | 2 |
| 10 | Query string `?v=2` on asset URL still bypasses | 1 |

Total = 6+6+6+2+3+1+1+3+2+1 = **31**.

## Section B — Necessity assessment

- **Groups 1/2/3 (18 tests) — matrix fan-out.** Branch 0 keys on a *string prefix*, not on
  filename or file existence. All 6 asset paths take the identical code path. One path proves the
  branch; the per-file `for` loops add 0 branch coverage. Group 3 is worse: Branch 0 `return`s
  *before* any HX-Redirect logic runs — the hook physically cannot emit that header for a bypassed
  request, so 6 tests assert an unreachable outcome. Groups 2 and 3 also overlap Group 1 (a 200
  already implies no 302). **Load-bearing: ~3** (one 200, one no-redirect, one no-HX-Redirect).
- **Group 4 (2) — load-bearing**, but the 404 and no-redirect assertions belong in one `it`. **~1.**
- **Group 5 (3) — regression guard.** Valid intent (Branch 0 didn't break Branch 1) but one route
  proves it. **~1 load-bearing, 2 matrix.**
- **Group 6 (1) — flat duplicate.** `/health` exemption predates this story and is covered by
  `health.test.ts` (29 tests). Branch 0 never touches it. **0.**
- **Group 7 (1) — load-bearing.** `/assetsx` not matching `startsWith('/assets/')` is a real edge.
- **Group 8 (3) — mostly duplicate.** Branch 3/5 gating for non-asset paths is already covered by
  `auth.test.ts` (22 tests); a pure prepended early-return cannot alter it. **~1 load-bearing.**
- **Group 9 (2) — D4 duplicates Group 1** in a different fixture; D5 (bad token ignored) is a mild
  edge. **~1.**
- **Group 10 (1) — load-bearing.** `request.url.split('?')[0]` is real logic.

**Tally: ~9 load-bearing · ~18 matrix-completeness · ~4 flat duplicates of `health.test.ts` /
`auth.test.ts`.** For comparison, the largest existing integration files cover whole subsystems —
`layout.test.ts` 34, `health.test.ts` 29, `auth.test.ts` 22. 31 tests for a one-`if` change is the
outlier in tests-per-line-of-feature-code, not raw count.

## Section C — Root cause

1. **`test-writer.md` §Responsibilities 4:** *"Write integration tests for every new route … covering
   happy path, auth error (401), validation error (422), and any rate-limit (429) or size-limit
   (413) cases."* A fixed matrix mandate. This story had **no new route**, so T improvised — it
   treated each `/assets/*` path as a route and fanned the matrix across the `VENDORED_JS` /
   `ALL_ASSET_PATHS` arrays via `for` loops.
2. **No ceiling anywhere.** Every quantity rule in the role file is a *minimum* ("every new pure
   function", "every new route", "every new screen"). Nothing says "one test per distinct branch"
   or "don't iterate across data sharing a code path." Boundaries §66–72 forbid mocking and
   tier-skipping but never over-coverage.
3. **`audit-tests.md` Phase 4** flags *"any route file without a corresponding integration test
   file"* as `[block]`. It rewards file existence, never penalizes redundant tests — pressure is
   one-directional. `verifystory.md` is standalone re-verification and did not apply here.
4. **`test-handoff.md` rationale** confirms it: T frames the work as exhaustively covering "Branch 0
   … across Branches 1/3/5 … path-prefix exactness … query-string handling" — completeness as the
   explicit goal, with no signal-per-test filter.

## Section D — Recommendation

Add a **test-sizing rule** to `test-writer.md` Boundaries: *"Write one test per distinct code path
/ branch — not one per data value that exercises the same branch. If N inputs flow through the same
conditional, one representative input plus one boundary/negative case suffices; do not fan a
data-driven loop across values sharing a branch."* Reword §Responsibilities 4 so the 401/422/429/413
list reads as a *per-route ceiling of applicable cases*, not a multiplier, and explicitly note it
applies only when the diff adds a route. Add a Boundary: *"Do not re-test behavior already covered
in another file — `/health` exemption lives in `health.test.ts`, auth-branch gating in
`auth.test.ts`; reference it, don't duplicate."* Finally add a pre-handoff self-check: *"For each
test ask — would it fail if every other test passed? If not, delete it."* Applied here, that lands
the file near ~9 tests.
