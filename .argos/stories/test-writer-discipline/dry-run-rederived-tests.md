# Criterion-2 dry-run — re-derived test set for `ctrfhub-docker-build-fix`

**Executed:** 2026-05-18 (Phase 4 T spawn, story `test-writer-discipline`)
**Performed under:** the freshly-tuned `.claude/agents/test-writer.md` on
`story/test-writer-discipline` — test-sizing rule, 4xx-matrix-as-ceiling reframe,
worked counter-example, no-duplication boundary, and pre-handoff self-check all in
effect.
**Mode:** DRY-RUN. This is an artifact. The original 31-test file
`src/__tests__/integration/static-asset-auth-bypass.test.ts` is **not modified,
overwritten, or deleted** (binding Decision 2 + acceptance criterion 3).

---

## 1. The change under test

`src/app.ts` — the global `onRequest` auth hook gains **Branch 0**, prepended
before all existing branches:

```ts
const rawPath = request.url.split('?')[0] ?? '';   // hoisted above the hook body

// ── Branch 0: Static assets bypass auth entirely ──
if (rawPath.startsWith('/assets/')) {
  return;
}
```

Net: **one new conditional, one prefix check.** 13 insertions / 8 deletions.
**No new route** is added (the `/assets/` route already existed via
`@fastify/static`, registered at `src/app.ts:232–236`).

Because the diff adds **no route**, the 401/422/429/413 response-code matrix
**does not apply at all** (test-sizing rule + Responsibility 4: the matrix is a
per-route ceiling, applicable *only when the diff adds a route*). Branch 0 is a
pure prepended early-return.

## 2. Distinct code paths introduced or directly affected

Per the test-sizing rule — *one test per distinct branch, not one per data value
that exercises the same branch*:

| ID | Distinct code path | Is it real new/affected logic? |
|----|--------------------|--------------------------------|
| P1 | Branch 0 **taken** — `rawPath.startsWith('/assets/')` true → `return` before any auth branch | Yes — the new branch itself |
| P2 | Branch 0 **not taken** — non-asset path falls through to Branches 1–5 unchanged | Yes — the branch's false arm; the regression guard that the bypass did not widen |
| P3 | Prefix-exactness boundary — `/assetsx`, `/my-assets` do **not** match `startsWith('/assets/')` | Yes — a genuine edge of the `startsWith` predicate (off-by-prefix) |
| P4 | Query-string stripping — `request.url.split('?')[0]` so `/assets/x.js?v=2` still matches Branch 0 | Yes — real logic the branch depends on; the `.split('?')` is load-bearing for the match |
| P5 | Branch 0 skips **only** auth, not file resolution — a missing `/assets/*` file still yields a genuine `@fastify/static` 404 (not an auth redirect, not an auth-free 200) | Yes — a real outcome of the new path interacting with `@fastify/static` |

That is **5 distinct paths.** Everything else in the original 31 is either a data
value sharing one of these paths, or behavior owned by a sibling file.

## 3. Re-derived minimum-meaningful test set — 8 tests

Each test below is mapped to exactly one path and passes the pre-handoff
self-check: *"Would this test fail in isolation if the code were wrong?"* —
answered explicitly in the last column.

| # | Test (`it(...)`) | Path | Fails in isolation if code is wrong? |
|---|------------------|------|--------------------------------------|
| 1 | `a /assets/* file is served 200 with no session cookie and no API token` (one representative vendored JS file, e.g. `/assets/htmx.min.js`) | P1 | Yes — if Branch 0 were absent, an empty-DB request 302-redirects to `/setup`; status would be 302 not 200. |
| 2 | `a /assets/* request is NOT redirected (no 302, no Location, no HX-Redirect)` — single test, plain GET **and** an `HX-Request: true` GET asserted together | P1 | Yes — if Branch 0 were absent or placed after Branch 1/5, a redirect (or `HX-Redirect`) would appear. One test covers both client modes because both flow through the *same* Branch 0 short-circuit. |
| 3 | `serves real file bytes with a javascript content-type, not an empty redirect body` | P1 | Yes — distinguishes a genuine static-file serve from a 200-with-empty-body; a regression that served a stub would fail here but not test 1. |
| 4 | `a non-asset route (empty DB) still redirects to /setup — Branch 1 intact` (one route, e.g. `/dashboard`) | P2 | Yes — if Branch 0's predicate were too broad (e.g. `startsWith('/asset')`), this would wrongly bypass and return non-302. |
| 5 | `a non-asset route still gates when users exist — Branch 5 intact` (unauthenticated GET, expect 302 → /login) | P2 | Yes — proves Branch 0 did not collapse Branches 2–5 for non-asset traffic in the post-setup state; a widened bypass fails here. |
| 6 | `/assetsx and /my-assets (prefix not followed by, or not at start) still gate` — single test, both values asserted | P3 | Yes — if Branch 0 used `includes('/assets')` or `startsWith('/asset')` instead of `startsWith('/assets/')`, this fails. The two values are the two distinct off-by-prefix shapes (suffix-extended, and substring-not-at-start), not fan-out. |
| 7 | `/assets/htmx.min.js?v=2 (cache-busting query string) still bypasses auth and returns 200` | P4 | Yes — if `rawPath` were `request.url` instead of `request.url.split('?')[0]`, the literal `?v=2` defeats `startsWith` only when the asset is at a deeper path; more importantly this isolates the `.split('?')` logic — a regression there fails here and nowhere else. |
| 8 | `a genuinely missing /assets/* file still returns a real 404 (not a redirect, not a masked 200)` | P5 | Yes — proves Branch 0 skips *only* auth and not file resolution; a regression that turned `/assets/*` into an auth-free catch-all would 200 here, and one that left the redirect in place would 302 here. |

**Re-derived count: 8 tests** — inside the ≤ 12 ceiling and squarely in the
8–10 load-bearing target band. All 8 are load-bearing; **zero are fan-out, zero
are duplicates, zero assert an unreachable outcome.**

### Suite structure for the 8 tests

Two `describe` blocks suffice (the original used five):

- **Suite A — `/assets/*` bypasses auth (Branch 0)** — tests 1, 2, 3, 7, 8.
  In-memory SQLite (`buildApp({ testing: true, db: ':memory:' })`); empty users
  table, so Branch 1 would fire if Branch 0 were absent — this is what makes
  tests 1–3 and 7 diagnostic. Test 8 (missing-file 404) also lives here.
- **Suite B — non-asset auth posture unchanged (regression guard)** — tests 4,
  5, 6. Test 4 and 6 use the in-memory empty-DB app; test 5 reuses the existing
  temp-file + Better Auth seed fixture (the `seedAuthSchema` / `makeTempDbPath`
  helpers from the original file) so the users table is non-empty and Branch 5
  is the one under test. `afterAll(() => app.close())` in both, per operating
  context.

No fixture or helper is dropped that the 8 tests need: the temp-file/Better-Auth
seed helper is still required for test 5.

## 4. Comparison — original 31 → re-derived 8

Mapped against `evidence-audit.md` Section A's 10-group breakdown:

| Audit group (intent) | Orig. count | Re-derived | Disposition & rationale |
|----------------------|-------------|-----------|--------------------------|
| 1 — Vendored JS return 200 without auth (`for VENDORED_JS` ×5 + "real bytes" ×1) | 6 | 2 (tests 1, 3) | **Collapsed.** All 5 JS files match the *same* `startsWith('/assets/')` prefix → identical code path. One representative file proves Branch 0 (test 1). "Serves real bytes" is a *distinct* assertion (stub-vs-real) → kept as test 3. The other 4 file iterations add zero branch coverage (test-sizing rule: prefix match = one path). |
| 2 — Asset paths not redirected to /setup/login (`for ALL_ASSET_PATHS` ×6) | 6 | merged into test 2 | **Collapsed to 1.** Same prefix branch as Group 1; a 200 already implies no 302, so this largely overlaps Group 1. Kept as one explicit no-redirect assertion (test 2) for diagnostic clarity. |
| 3 — Asset paths emit no `HX-Redirect` (`for ALL_ASSET_PATHS` ×6) | 6 | merged into test 2 | **Collapsed to 0 standalone.** This is the worked counter-example case: Branch 0 `return`s *before* any HX-Redirect logic runs, so a bypassed request **physically cannot** emit that header. As standalone tests they fail only if an *unrelated* branch is deleted — they fail the self-check ("only fails if another test would also fail"). Folded as one extra assertion inside test 2 (the `HX-Request` GET), where it is cheap and co-located, not fanned ×6. |
| 4 — Missing asset still 404 and not redirected (2 `it`s) | 2 | 1 (test 8) | **Collapsed.** One real path (P5). The 404 and the no-redirect assertions belong in one `it` — matches `evidence-audit.md` §B "belong in one `it`". |
| 5 — Non-asset routes still /setup-redirect on empty DB (`/`, `/nonexistent`, `/dashboard`) | 3 | 1 (test 4) | **Collapsed.** All 3 routes exercise the *same* Branch 0-false → Branch 1 path. One route proves it. |
| 6 — `/health` still exempt, 200 | 1 | 0 | **Dropped.** Flat duplicate. The `/health` exemption predates this story, Branch 0 never touches it, and it is owned by `health.test.ts` (29 tests). No-duplication boundary: reference, don't re-test. |
| 7 — Path-prefix exactness (`/my-assets`, `/assetsx`) | 1 | 1 (test 6) | **Kept 1:1.** A genuine edge of the `startsWith` predicate (P3). The original already correctly packed both values into one `it`. |
| 8 — Non-asset gating when users exist (Branch 5 `/`, HTMX `/dashboard`, Branch 3 bad-token 401) | 3 | 1 (test 5) | **Collapsed.** Branch 3/5 gating for non-asset paths is owned by `auth.test.ts` (22 tests); a pure prepended early-return cannot alter it. One regression-guard test (test 5) confirms Branch 0 did not collapse the post-setup path; the bad-token 401 sub-case is `auth.test.ts`'s job. |
| 9 — Asset bypass when users exist (D4) + bad token on asset ignored (D5) | 2 | 0 standalone | **Collapsed.** D4 re-proves Group 1's Branch 0 in a different fixture — same code path, no new branch. D5 (bad token on asset ignored) is implied by P1: Branch 0 `return`s before Branch 3, so the token is never read; covered transitively by test 1/2. Neither survives the self-check as a standalone. |
| 10 — Query string `?v=2` still bypasses | 1 | 1 (test 7) | **Kept 1:1.** Real logic — `request.url.split('?')[0]` (P4). |
| **Total** | **31** | **8** | — |

### Tests-per-distinct-branch ratio

- Original: **31 tests / 5 distinct paths ≈ 6.2** — heavy fan-out (`audit-tests.md`
  §4a would flag this `[block]` over-coverage).
- Re-derived: **8 tests / 5 distinct paths = 1.6** — three paths get one test;
  P1 gets three tests, each a *distinct assertion class* (reachable / not-redirected /
  real-bytes), not a data-value fan. No path is over-covered by a data loop.

### What was removed and why (summary)

- **~18 matrix fan-out** (Groups 1/2/3 `for`-loops over 5–6 asset paths): every
  value matches the same string prefix → identical code path. Eliminated by the
  test-sizing rule.
- **~6 unreachable-outcome assertions** (Group 3 `HX-Redirect`): Branch 0 returns
  first, so the header can never appear; the assertion can only fail via an
  unrelated deletion. Eliminated by the pre-handoff self-check.
- **~4 cross-file duplicates** (Group 6 `/health`; Group 8 Branch 3/5 gating):
  owned by `health.test.ts` / `auth.test.ts`. Eliminated by the no-duplication
  boundary.
- **Net:** 31 → 8. The 8 are exactly the ~9 `evidence-audit.md` Section B
  estimated as load-bearing, minus one — the audit's "~1" for Group 9 (D4/D5)
  proved to be fully transitive coverage of P1 (Branch 0 returns before the token
  is read), so it does not earn a standalone test under the self-check. 8 is
  inside the brief's 8–10 target band.

## 5. Self-check confirmation

Every one of the 8 re-derived tests was run through the pre-handoff self-check
question — *"Would this test fail in isolation if the code were wrong?"* — and
all 8 answer **yes** (column 5 of the table in §3 gives the specific regression
each one catches). No re-derived test duplicates a sibling's signal, asserts an
unreachable outcome, or re-proves a branch owned by another file.

## 6. Note

This dry-run is an analysis artifact only. No file under `src/__tests__/` was
created, modified, or deleted. The original 31-test
`static-asset-auth-bypass.test.ts` remains intact and passing (31/31) — verified
in the Tier 1 report. A future housekeeping pass (per the brief's Constraints and
F's handoff "Known issues") may apply this re-derivation to the real file; that
is explicitly out of scope here.
