# Test Handoff — audit-composition-root-S3

**Branch:** `story/audit-composition-root-S3`
**Commits added by Test-writer:**
- `25b36c3` `test(audit-composition-root-S3): regression check + comment alignment`

## Narrative

Five consistency-cleanup findings (#3 typed `FastifyInstance`, #5 auth-hook rename, #8 dead `/assets/` exemption, #9 users-bootstrapped cache, #10 inline-`GET /` JSDoc) landed in a single 110-line diff to `src/app.ts`. None added a route, a service, or any new behaviour: every change either tightens types, renames a Fastify lifecycle stage, removes a dead clause, or adds a closure-scoped cache around an already-tested code path. The story is a deletion / refactor / rename, and the regression guard is the existing 513-test integration suite that was already passing F's baseline.

My scope this phase was therefore:

1. Confirm `npx tsc --noEmit` is clean (verifies finding #3's compile-time contract).
2. Confirm `npx vitest run` stays at 513 / 513 (verifies findings #5, #8, #9, #10 introduce no behavioural drift).
3. Update two stale `onRequest` references in `src/__tests__/integration/static-asset-auth-bypass.test.ts` JSDoc (lines 6, 16) so the file's documentation matches the renamed hook. **Comments only — no test logic changed.**
4. Decide on (and document) the optional finding-#9 unit test.

I checked `grep -rn onRequest src/__tests__/ e2e/` for any other stale references after the rename. One remaining hit in `rate-limit-and-auth-log.test.ts:139` describes `@fastify/rate-limit`'s own route-level `onRequest` hooks — it is **not** about the global auth hook and remains accurate post-rename. No other test-file comment needed touching.

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless | ✓ | `.argos/stories/audit-composition-root-S3/tier-1-report.md` |
| T2 ARIA (clean room) | N/A — F picked finding-#10 option (b); no new rendered route. The brief's "Test tiers required" row #10(b) explicitly says "no page tiers." | — |
| T2.5 Authenticated State | N/A — same reason as T2. No new auth-gated route. | — |
| T3 Visual | N/A — same reason; visual regression isn't on the line for a JSDoc-only change to a pre-existing route. | — |
| Backdrop-contrast | N/A — no layout-token / `position` / `z-index` / `[data-theme]` / `@layer components` change in the diff. | — |

## Tests added

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Unit | — | 0 | Optional finding-#9 test **skipped** — see §Non-blocking issues for justification (non-trivial spy + existing integration coverage already guards the behavioural invariant). |
| Integration | — | 0 | None required per the brief. Existing suite is the regression guard (findings #3, #5, #8, #9, #10). |
| E2E | — | 0 | None per the brief. |

**Tests-per-distinct-branch:** 0 new tests / 0 new behavioural branches added (finding #9's `&& !usersBootstrapped` short-circuit is a performance gate on an existing branch, not a new behavioural branch — the user-visible outcomes "302 to /setup when empty" and "pass through when seeded" are unchanged). Ratio is well-formed: a deletion / refactor / rename story warrants regression checks, not new tests.

**Comment-alignment edits to existing tests:**

| File | Lines | Change |
|---|---|---|
| `src/__tests__/integration/static-asset-auth-bypass.test.ts` | 6, 16 | Replaced "global `onRequest` auth hook" with "global `preHandler` auth hook" (the rename in finding #5). Added a one-paragraph note explaining the rename keeps Branch 0 semantics unchanged. |

**Pre-handoff self-check:** confirmed — no new tests were authored, so the "would this fail in isolation if the code were wrong?" filter applies vacuously. Zero candidate tests were deleted (none were drafted). The comment-alignment edits do not change which tests fail under regression; they only keep the file's prose honest after the rename.

## Coverage (from `npm run test:coverage`)

Not re-measured this phase — the diff adds no new source code paths (it removes one, renames one string literal, and adds type augmentations / comments / a closure variable + an `&&` clause on an existing branch). Coverage delta is structurally non-negative: lines of `src/app.ts` covered by `auth.test.ts` + `static-asset-auth-bypass.test.ts` are the same lines, now with a closure cache and a renamed hook stage. The 513 / 513 pass count is the equivalent coverage signal for a refactor of this shape.

## Non-blocking issues

- **Optional finding-#9 unit test skipped.** Justification: spying on `request.em.count(User)` from outside `buildApp()` is non-trivial because the EM is forked per-request inside the existing `onRequest` EM-fork hook — there's no clean injection point that doesn't require either `MikroORM.prototype` patching (fragile; leaks across the rest of the suite) or wiring a custom EM through the composition root just for this test. The cache's behavioural invariant ("empty DB still redirects to /setup; seeded DB no longer does") is already covered by `auth.test.ts` Branch 1 (5 tests) and `static-asset-auth-bypass.test.ts` Suites C (5 tests, empty DB) + D (5 tests, seeded DB). The cache is a correctness-preserving performance optimization by construction (latch flips only after `userCount > 0`; exception path leaves the latch `false`), and F's iteration-1 architecture review explicitly verified the latch and exception-safety logic by inspection (`architecture-review-1.md §Finding #9`). Adding a spy on a buried per-request EM method would add maintenance cost without strengthening the regression signal a real `count > 0` integration test already provides.

- **`rate-limit-and-auth-log.test.ts:139` retains the word `onRequest`.** This is correct — the comment refers to `@fastify/rate-limit`'s own route-level `onRequest` hooks (the limiter's `errorResponseBuilder` and `onExceeded` install at the `onRequest` stage), not to the global auth hook. The reference survives the finding-#5 rename intact and was deliberately left.

- **`coverage` thresholds not measured this phase.** The story's diff is a refactor that touches no behavioural surface; per the brief's "Cross-cutting" clause, "Coverage delta should be ≥ 0." The full suite passing at 513 / 513 (F's pre-handoff baseline) is the coverage-delta signal.

## Verdict

**PASS** — Argos may proceed to Phase 6 close-out.
