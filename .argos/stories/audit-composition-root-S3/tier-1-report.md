# Tier 1 Headless Report — audit-composition-root-S3

**Executed:** 2026-05-20 14:05
**Method:** `fastify.inject()` via `npx vitest run` (no browser); `npx tsc --noEmit` for the type-augmentation finding.

## Framing

This is a regression-check report on a deletion / refactor / rename story:

- **Finding #3** (typed `FastifyInstance` augmentation) — type-level only; verified by `tsc --noEmit`. No new behaviour to exercise.
- **Finding #5** (auth hook rename `onRequest` → `preHandler`) — string-literal change at the registration site; the five auth branches still run on every request. Regression guard: `auth.test.ts` (all five branches), `rate-limit-and-auth-log.test.ts` (DD-029 429 contract), `static-asset-auth-bypass.test.ts` (Branch 0).
- **Finding #8** (dead `/assets/` exemption removed from Branch 1) — Branch 0 unconditionally returns on `/assets/*` before Branch 1 runs, so the removed clause was unreachable. Regression guard: `static-asset-auth-bypass.test.ts` (Suites A, B, C, D, E — 31 tests covering bypass-on, bypass-still-on-with-users, non-asset-paths-still-gate, prefix-boundary cases).
- **Finding #9** (closure-scoped `usersBootstrapped` cache) — performance optimization that's correctness-preserving by construction (latch only flips after `userCount > 0`; exception path leaves it `false`). Regression guard: `auth.test.ts` Branch 1 suite (empty DB → /setup) and the same `static-asset-auth-bypass.test.ts` Suites C + D (Branch 1 fires on empty DB; Branch 1 does NOT fire once a user is seeded — both observable as 302 location values).
- **Finding #10** (inline `GET /` + JSDoc — F's option (b)) — no new route, no shape change. The pre-existing `layout.test.ts` (39 tests) and the home-route render in `health.test.ts` exercise the unchanged registration.
- **Plus the optional finding-#9 unit test (skipped — see test-handoff.md §Non-blocking issues).**
- **Plus a comment-alignment edit** in `src/__tests__/integration/static-asset-auth-bypass.test.ts` (lines 6 + 16) — replaced two stale `onRequest` references with `preHandler` so the file's documentation matches the renamed hook. Comments only; no test logic changed.

## Checks

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | Finding #3 — typed augmentations compile | `npx tsc --noEmit` | 0 errors | 0 errors | ✓ |
| 2 | Finding #5 — auth `preHandler` still gates the five branches | `npx vitest run src/__tests__/integration/auth.test.ts` (in full-suite run) | all branches pass | 23 tests pass | ✓ |
| 3 | Finding #5 — DD-029 429 contract still holds after the rename | full-suite run includes `rate-limit-and-auth-log.test.ts` | all 13 pass | 13 tests pass | ✓ |
| 4 | Finding #8 — `/assets/*` bypass unchanged after Branch-1 dedup | full-suite run includes `static-asset-auth-bypass.test.ts` Suite A + B + E | all pass | covered in 31 tests | ✓ |
| 5 | Finding #8 — non-asset routes still gate as before | full-suite run includes `static-asset-auth-bypass.test.ts` Suite C + D | all pass | covered in 31 tests | ✓ |
| 6 | Finding #9 — empty DB still redirects to /setup (cache miss path) | `auth.test.ts` Branch 1 + `static-asset-auth-bypass.test.ts` Suite C | 302 /setup | passes | ✓ |
| 7 | Finding #9 — seeded DB no longer redirects to /setup (Branch 1 bypassed) | `static-asset-auth-bypass.test.ts` Suite D | non-/setup redirect | passes | ✓ |
| 8 | Finding #10 option (b) — `GET /` registration shape unchanged | `layout.test.ts` (39 tests exercising home-route rendering) | all pass | 39 tests pass | ✓ |
| 9 | Full suite stays at the F-baseline 513 / 513 | `npx vitest run` | 513 / 513 | 513 / 513 | ✓ |
| 10 | Comment-alignment edit doesn't perturb the suite | `npx vitest run src/__tests__/integration/static-asset-auth-bypass.test.ts` post-edit | 31 / 31 | 31 / 31 | ✓ |

## Excerpt of raw output

```
 Test Files  25 passed (25)
      Tests  513 passed (513)
   Start at  08:05:14
   Duration  9.13s (transform 659ms, setup 0ms, collect 7.52s, tests 13.64s, environment 6ms, prepare 1.83s)
```

```
$ npx tsc --noEmit
(no output — clean)
```

```
$ grep -n onRequest src/__tests__/integration/static-asset-auth-bypass.test.ts
(no output post-edit — both stale references replaced with `preHandler`)
```

```
$ grep -n onRequest src/__tests__/integration/rate-limit-and-auth-log.test.ts
139:// route-level `onRequest` hooks attached by `@fastify/rate-limit` and they run
```

(That remaining `onRequest` is correct — it describes `@fastify/rate-limit`'s own route-level `onRequest` hooks, NOT the global auth hook. No edit warranted.)

## Verdict

**PASS** — proceed to test-handoff.
