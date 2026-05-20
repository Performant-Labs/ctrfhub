# Test Handoff — audit-auth-S1

**Branch:** `story/audit-auth-S1`
**Commits added by Test-writer:** none — no new tests authored (see "Test tiers" below).

## Nature of this story

This is a **pure dead-code deletion + JSDoc rewrite** in `src/auth.ts`. The brief
(`.argos/stories/audit-auth-S1/brief.md`) explicitly states:

> Test tiers required: **Unit no, Integration no, E2E no**.
> Page verification tiers: **none** (`src/auth.ts` has no rendered route).
> Critical test paths: existing auth integration tests continue to pass unchanged.

The existing auth integration suite is the regression guard. T's job here is a
regression check, not test authoring. Authoring a literal-grep test asserting
`getAuth` is `undefined` would assert a property of the source file, not a
behaviour, and would add no diagnostic value over the `grep -rn` acceptance
criterion the brief already specifies.

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless | N/A — no route/behaviour change | — |
| T2 ARIA (clean room) | N/A — no rendered route | — |
| T2.5 Authenticated State | N/A — no rendered route | — |
| T3 Visual | N/A — non-UI story | — |
| Backdrop-contrast | N/A | — |

No tier reports were written because no tier ran. The brief authorises this:
the story is a deletion + JSDoc rewrite with no application-layer behaviour
change and no rendered surface.

## Diff scope confirmation

`git diff --stat main..story/audit-auth-S1`:

```
 .../stories/audit-auth-S1/architecture-review-1.md |  46 ++++++++++
 .argos/stories/audit-auth-S1/brief.md              |  62 +++++++++++++
 .argos/stories/audit-auth-S1/feature-handoff.md    | 102 +++++++++++++++++++++
 src/auth.ts                                        |  51 ++++-------
 4 files changed, 229 insertions(+), 32 deletions(-)
```

Scope is exactly: `src/auth.ts` + `.argos/stories/audit-auth-S1/` artifacts.
No other `src/` files, no test files, no planning docs touched. Constraint
respected.

## Regression checks

| Check | Command | Result |
|---|---|---|
| TypeScript compilation | `npx tsc --noEmit` | exit 0 — clean |
| Forbidden identifiers removed | `grep -rn "getAuth\|_auth\b" src/` | zero matches (exit 1) — brief's literal acceptance criterion satisfied |
| Full test suite | `npm test` | **498 / 498 passing across 23 test files** (7.66s) |

### Auth-touching integration suites (focused regression surface)

All passed cleanly with no behavioural change observed:

- `src/__tests__/integration/auth.test.ts` — 22 tests passing
- `src/__tests__/integration/ingest.test.ts` — 12 tests passing
- `src/__tests__/integration/ingest-artifacts.test.ts` — 10 tests passing
- `src/__tests__/integration/static-asset-auth-bypass.test.ts` — 31 tests passing

The Better Auth `ERROR` lines visible in stderr are expected output from
negative-path tests asserting invalid-credential and invalid-API-key outcomes;
they are intentional and unchanged by this diff.

## Tests added

None. See "Nature of this story" above.

**Pre-handoff self-check:** N/A — no tests were authored. The discipline rule
("every test must fail in isolation if the code is wrong") was applied to the
question of whether to author a test at all, and the answer was no: any test
of "`getAuth` is undefined" would be a source-file property assertion, not a
behavioural assertion, and the existing 498-test regression guard already
proves the deletion is safe.

## Non-blocking issues

- None.

## Verdict

**PASS** — Argos may proceed to Phase 6 close-out.
