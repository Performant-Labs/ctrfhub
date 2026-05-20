# Task Brief — audit-auth-S1: Remove the dead `getAuth()` singleton and fix the stale auth JSDoc

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: none (S1 is independent of AUTH-002 per the source decomposition — it deletes code AUTH-002 does not use)
- [x] No P0 gap blocks this story: gaps.md P0 items (G-P0-001..004) are Tailwind/Eta/settings-schema/AI-recovery — none touch auth.ts
- [x] Branch cut: `story/audit-auth-S1` from `main` @ `ba7d55c`
- [x] `tasks.md` flip: N/A — this story is decomposed from an architecture audit, not a `tasks.md` row (same shape as `architecture-augment`)
- [x] No other story mid-flight: no open `.argos/stories/<otherId>/` pipeline. (PR #79 — the `audit-auth` audit-loop artifacts — is open but it touches only `.argos/audits/audit-auth/*`; zero file overlap with S1's `src/auth.ts` edit.)

## Source

**Audit:** `audit-auth` (territory T1 of the codebase audit campaign).
**Findings:** `.argos/audits/audit-auth/findings.md` — Findings #1 and #2 (both `warn`, Theme A).
**Decomposition entry:** `.argos/audits/audit-auth/decomposition.md §Story audit-auth-S1`.

Both files currently live on the unmerged `audits/audit-auth` branch (PR #79). They are referenced for traceability — F does not need them on main to do this story; everything F needs is inlined below.

## Story

**Description.** `src/auth.ts` exports a `getAuth()` function and a module-level `_auth` lazy-singleton variable that have **zero callers** anywhere in `src/`. The composition root (`src/app.ts:176`) calls `buildAuth(options.db)` directly so the integration-test DI seam works. The file-header JSDoc and `getAuth()`'s `@example` JSDoc still describe the singleton as the live access path — actively misleading documentation about an architecture that does not exist. This story deletes the dead singleton and rewrites the JSDoc to match how auth is actually wired.

**Acceptance criteria.**
- `getAuth()` and the module-level `_auth` lazy-singleton variable are deleted from `src/auth.ts`.
- `buildAuth()` and the `AuthInstance` type alias are retained unchanged — they are the live API.
- The `src/auth.ts` file-header JSDoc is rewritten to describe `buildAuth()` as a factory called once by `buildApp()` (`src/app.ts`) as the composition root, and once per integration test with an in-memory DB; it no longer references a consumed `auth` singleton or a `getAuth()` access path.
- `grep -rn "getAuth\|_auth\b" src/` returns zero matches after the change (including under `src/__tests__/` — see implementer notes).
- `tsc --noEmit` clean.
- The existing test suite still passes.

**Test tiers required.**
- Unit: no — pure deletion of dead code; no new logic.
- Integration: no — no behaviour change; existing auth integration tests are the regression guard.
- E2E: no.

**Page verification tiers.** none — `src/auth.ts` has no rendered route.

**Critical test paths.** Existing auth integration tests under `src/__tests__/integration/auth.test.ts` continue to pass unchanged. No new test paths required.

## Required reading

**Skills (full paths).**
- `skills/better-auth-session-and-api-tokens.md` — the auth subsystem's conventions; confirms `buildAuth()` is the intended factory shape.

**Planning doc sections.**
- `docs/planning/architecture.md §Layering and Dependency Direction` — "`buildApp()` is the composition root" — the rationale for direct instantiation over a module-level singleton.
- `docs/planning/architecture.md §Code Conventions → Abstraction level` — "ambient module-level singletons" named as the anti-pattern; this story removes exactly that anti-pattern.

## Implementer notes (from the decomposition)

- **Narrowly-scoped deletion** — do **not** expand surface area or refactor `buildAuth()` itself. Two changes only: delete the singleton (`getAuth`, `_auth`, their JSDoc) and rewrite the file-header JSDoc.
- **Watch for stale test imports.** The audit's `Out of scope but noticed` flagged a risk: a test file under `src/__tests__/` may still import the now-deleted `getAuth`. Check (`grep -rn "getAuth" src/__tests__/`) and remove any such stale import as part of this story — if one exists, the deletion will not compile until it is fixed. Removing a now-invalid import is **not** test authoring and is the one place this story legitimately touches a test file.
- **Auth is high-stakes.** Keep the diff tight; do not chase adjacent issues (the `database as any` cast on line ~131 and the dev-secret fallback on line ~118 are audit-auth-S2's scope, not S1's).

## Iteration tracking (for F's awareness)

This brief is F's input on **iteration 1**. On subsequent iterations F is spawned with:
- `architecture-review-<N-1>.md` (F↔A loop, iter N>1, cap 3)
- `fix-pass-notes.md` (Phase 5 fix-pass after T BLOCK)
- `spec-audit-<M-1>.md` (Phase 6b spec-remediation, cap 2; light remediation rule)

Each F invocation appends a `## Iteration <N>` (or `## Fix-pass`, `## Spec-remediation iter <M-1>`) section to `feature-handoff.md`.
