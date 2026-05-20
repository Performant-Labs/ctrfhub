# [audit-auth-S1] Remove the dead `getAuth()` singleton and fix the stale auth JSDoc

## Summary

A narrowly-scoped, deletion-only fix in `src/auth.ts`: removes the exported
`getAuth()` function and the module-level `_auth` lazy singleton (both had **zero
callers** anywhere in `src/`) and rewrites the file-header JSDoc that incorrectly
described the dead singleton as the live access path. Decomposed from the
`audit-auth` architecture audit (Theme A — findings #1 + #2; PR #79).

## Acceptance criteria

- [x] `getAuth()` and the module-level `_auth` lazy-singleton variable are deleted from `src/auth.ts`
- [x] `buildAuth()` and the `AuthInstance` type alias are retained unchanged — they are the live API
- [x] The `src/auth.ts` file-header JSDoc is rewritten to describe `buildAuth()` as the composition-root factory called once per app instance by `buildApp()` (`src/app.ts:176`) and standalone by integration tests that need to seed Better Auth's schema or mint API-key fixtures; it no longer references a consumed `auth` singleton or a `getAuth()` access path
- [x] `grep -rn "getAuth\|_auth\b" src/` returns zero matches (including under `src/__tests__/`)
- [x] `tsc --noEmit` clean
- [x] The existing test suite still passes (498/498)

## Test tiers

| Layer | Declared in brief | Present in diff | Notes |
|---|---|---|---|
| Unit | no | N/A | Deletion-only; no new logic |
| Integration | no | N/A | No behaviour change; existing `src/__tests__/integration/auth.test.ts` is the regression guard (22/22) |
| E2E | no | N/A | No rendered route |

## Page verification tiers

None — `src/auth.ts` has no rendered route. T1/T2/T2.5/T3 all N/A.

## Architecture reviews

| # | Verdict | File |
|---|---|---|
| 1 | BLOCK (1 block, 0 warn, 1 nit) | `.argos/stories/audit-auth-S1/architecture-review-1.md` |
| 2 | PASS (0 block, 0 warn, 0 nit) | `.argos/stories/audit-auth-S1/architecture-review-2.md` |

Iter-1 block: the rewritten JSDoc invented an `auth` field on `AppOptions` (which has only `db`, `artifactStorage`, `eventBus`, `aiProvider`) and misdescribed why integration tests instantiate `buildAuth(dbPath)` standalone. Iter-2 (`913a1ee`) rewrote lines 13–20 to name the two real reasons tests call `buildAuth(dbPath)` directly — schema seeding via `auth.$context.runMigrations()` and API-key fixture minting via `auth.api.createApiKey(...)` — and made explicit that `buildApp({ testing: true, db: dbPath })` calls `buildAuth(options.db)` itself and does not accept an externally constructed auth instance.

## Decisions that deviate from spec

- **JSDoc wording: avoid the literal `getAuth` substring.** The brief's acceptance criterion is a literal-grep contract (`grep -rn "getAuth\|_auth\b" src/` must return zero). The rewritten JSDoc therefore describes the absent *pattern* ("this module caches no instance and exposes no module-level accessor function") rather than negating a specific symbol that no longer exists. F flagged this for review in iter 1; A ruled it acceptable in iter 1 and confirmed clean in iter 2.

## Follow-ups (not in scope for this story)

- **`audit-auth-S2`** — the auth-config-hardening sibling story from the same audit (Theme B, findings #3 + #4). Covers the `database as any` cast and the dev-secret fallback. Sequence-sensitive with AUTH-002 (`[/]` in `tasks.md`); see PR #79's decomposition.
- **`SESSION_SECRET` (spec) vs `BETTER_AUTH_SECRET` (code) naming mismatch** — flagged in `audit-auth`'s decomposition (PR #79) for André's call on a `gaps.md` entry; not in scope here.

## Gaps filed during this story

none

## Spec-enforcer verdict

**PASS** — see `.argos/stories/audit-auth-S1/spec-audit-1.md` (0 block, 0 warn, 0 nit). S concurred with A's two-iteration ruling on the literal-grep-substring decision.
**Date:** 2026-05-19

---
_Generated from `.argos/stories/audit-auth-S1/pr-body.md`._
