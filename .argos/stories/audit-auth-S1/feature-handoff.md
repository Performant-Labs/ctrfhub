# Feature handoff — audit-auth-S1

## Iteration 1

**Date:** 2026-05-19
**Branch:** `story/audit-auth-S1`
**Commits added this iteration:**
- (pending) `feat(audit-auth-S1): remove dead getAuth() singleton and fix stale auth JSDoc`

### What was built / fixed

- Deleted the dead `getAuth()` exported function and its module-level lazy singleton `_auth` (plus the now-obsolete `@example` block and singleton-section banner comment) from `src/auth.ts`. Both had zero callers anywhere in `src/` — confirmed by `grep -rn "getAuth\|_auth\b" src/` before the change, which surfaced only the seven self-references inside `src/auth.ts` itself.
- Rewrote the `src/auth.ts` file-header JSDoc. It now describes `buildAuth()` as the composition-root factory called once by `buildApp()` (`src/app.ts`) during application wiring and once per integration test (`buildAuth(':memory:')`) for an isolated in-memory Better Auth instance. The new header explicitly states "this module caches no instance and exposes no module-level accessor function," and adds `@see` links to `architecture.md §Layering and Dependency Direction` and `architecture.md §Code Conventions → Abstraction level` (the two sections cited by the brief). The old language about an "exported `auth` instance consumed by …" is gone.
- `buildAuth()` itself, the `AuthInstance` type alias, the `SessionUser` / `ApiKeyUser` interfaces, the Fastify module augmentation, `buildDatabase()`, and the JSDoc on `buildAuth()` were all left **unchanged** — they are the live API and out of scope. The `database as any` cast on line 146 and the dev-secret fallback on line 132 were also left unchanged — those are `audit-auth-S2`, per the brief.

### Commands run locally (results)

- `grep -rn "getAuth\|_auth\b" src/` — **zero matches** (exit 1) after the edit. Including under `src/__tests__/`: also zero matches (no stale test imports existed to remove; all test files already use `buildAuth(dbPath)` directly via `AppOptions`).
- `npx tsc --noEmit` — 0 errors.
- `npm test` — 498/498 tests pass across 23 files (7.32 s). Auth-touching suites that exercised the deleted path: `integration/auth.test.ts` (22), `integration/ingest.test.ts` (12), `integration/ingest-artifacts.test.ts` (10), `integration/static-asset-auth-bypass.test.ts` (31) — all green. No new tests written or modified (per role boundary; pure dead-code deletion has no new behaviour to assert).

### Files created or modified

- `src/auth.ts` — (1) rewrote the file-header JSDoc (lines 1–36) to describe `buildAuth()` as the composition-root factory rather than a "consumed `auth` instance"; (2) deleted the trailing 34-line block that defined `_auth`, `getAuth()`, and the "Singleton export" banner comment, leaving the `AuthInstance` type alias intact at the bottom of the file. Net diff: `+17 / −32`, file shrunk from 213 → 198 lines.
- `.argos/stories/audit-auth-S1/feature-handoff.md` — this file.

No migrations needed — no entity changes.

### Decisions not covered by planning docs

- **JSDoc wording: avoiding the literal token `getAuth` in the new header.** My first draft of the rewritten header used the phrase "and no `getAuth()` accessor" to state explicitly what the file no longer exports. That phrasing left a `getAuth` substring match in `grep -rn "getAuth\|_auth\b" src/`, which the brief's acceptance criteria specify must return zero matches. I considered two options: (a) keep the explicit "no `getAuth()`" reference and treat the grep as a proxy for "no live symbol" (the documentation explicitly describes the absence), or (b) reword to "this module caches no instance and exposes no module-level accessor function," which preserves the meaning without the literal token. I picked (b) because the brief is explicit about "zero matches" and option (b) loses no information — anyone searching the file history can still find the rationale via git blame on this commit. Flagging it here so A can adjudicate if they prefer the more literal phrasing.

### Findings addressed (iter N>1 / fix-pass / spec-remediation only)

N/A — iteration 1.

### Known issues / follow-ups

- **`audit-auth-S2` is the next story in this theme.** It addresses the `database as any` cast (~line 146, now-renumbered) and the dev-secret fallback (~line 132). Those lines were deliberately untouched here, per the brief's scoping rule.
- **`src/app.ts:176` already passes `options.db` into `buildAuth`** (`const auth = await buildAuth(options.db);`), so the new JSDoc's claim that `buildApp()` is the sole production call site is accurate. Integration tests in `src/__tests__/integration/auth.test.ts`, `ingest.test.ts`, `ingest-artifacts.test.ts`, and `static-asset-auth-bypass.test.ts` all call `buildAuth(dbPath)` directly with `':memory:'`, matching the JSDoc's description of the test wiring.
- No other follow-ups.
