# Feature handoff — audit-auth-S1

## Iteration 1

**Date:** 2026-05-19
**Branch:** `story/audit-auth-S1`
**Commits added this iteration:**
- `b69f37f` `feat(audit-auth-S1): remove dead getAuth() singleton and fix stale auth JSDoc`

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

## Iteration 2

**Date:** 2026-05-19
**Branch:** `story/audit-auth-S1`
**Commits added this iteration:**
- (to be added) `fix(audit-auth-S1): address arch review iter 1`

### What was built / fixed

- Rewrote the second paragraph of the `src/auth.ts` file-header JSDoc (lines 13–20) to remove the fabricated `buildApp({ db, auth })` call shape. Iter 1 incorrectly implied that integration tests construct a Better Auth instance via `buildAuth(':memory:')` and thread it into `buildApp` as an `auth` DI seam. No such seam exists — `AppOptions` in `src/types.ts:60–83` has exactly four optional fields (`db`, `artifactStorage`, `eventBus`, `aiProvider`) and `buildApp` at `src/app.ts:176` always constructs its own auth via `await buildAuth(options.db)`. The new paragraph describes the actual contract: tests call `buildAuth(dbPath)` standalone for schema-seeding (`auth.$context.runMigrations()` in `auth.test.ts:48`) and API-key fixture minting (`auth.api.createApiKey(...)` in `auth.test.ts:115` and `ingest.test.ts:138`), then call `buildApp({ testing: true, db: dbPath })` separately, and `buildApp` calls `buildAuth(options.db)` itself.
- Softened the "exactly once" wording on line 9 (the nit on finding #2) to "once per app instance" — same paragraph, addressed in the same edit because it was zero marginal cost and removes the ambiguity flagged by A (the old phrasing read awkwardly next to the test-wiring paragraph, which implicitly describes multiple invocations).

### New JSDoc lines 8–20 (verbatim, for diff against iter 1)

```
 * `src/app.ts` is the single composition root — it calls `buildAuth(options.db)`
 * once per app instance during application wiring and threads the result into
 * the global preHandler hook (session + API-key validation) and into
 * `registerAuthRoutes()` for the `/api/auth/*` catch-all.
 *
 * Per `architecture.md §Code Conventions → Abstraction level`, cross-cutting
 * dependencies a test needs to substitute belong on the `AppOptions` DI seam —
 * not as ambient module-level singletons. Integration tests that need to seed
 * Better Auth's schema (`auth.$context.runMigrations()`) or mint API-key
 * fixtures (`auth.api.createApiKey(...)`) therefore call `buildAuth(dbPath)`
 * standalone and operate on the returned instance directly; `buildApp({ testing:
 * true, db: dbPath })` internally calls `buildAuth(options.db)` itself when
 * wiring the app and does not accept an externally constructed auth instance.
```

The fictional `{ db, auth }` call shape is gone, and the second paragraph now names the two concrete reasons tests instantiate `buildAuth` directly (schema seeding via `runMigrations`, API-key fixture minting via `createApiKey`) — both verified by reading `src/__tests__/integration/auth.test.ts:47–55` and `:113–123`. The architecture-section pointer and the test-seam framing from iter 1 are preserved.

### Commands run locally (results)

- `grep -rn "getAuth\|_auth\b" src/` — zero matches (exit 1). Acceptance criterion still satisfied.
- `npx tsc --noEmit` — 0 errors.
- `npm test` — 498/498 tests pass across 23 files (7.14 s). No behavioural change; the edit is JSDoc-only.

### Files created or modified

- `src/auth.ts` — JSDoc-only edit, lines 8–9 ("exactly once" → "once per app instance") and lines 13–20 (rewritten second paragraph). No code touched. The `database as any` cast and the dev-secret fallback (S2's scope) were not touched.
- `.argos/stories/audit-auth-S1/feature-handoff.md` — this section.

No migrations needed — no entity changes.

### Decisions not covered by planning docs

- **Addressed the nit (finding #2) in the same edit.** A's verdict was BLOCK on finding #1 only and the brief explicitly said the nit was optional ("Address it as part of this same edit since you are already in the JSDoc — it costs nothing"). I changed "exactly once" → "once per app instance" rather than dropping the adjective entirely (A's other suggested option) because the explicit "once per app instance" reads slightly stronger about the singleton-vs-factory distinction the whole header is making — the file is about the absence of a process-level singleton, so naming what the actual scope of "once" *is* reinforces the point.

### Findings addressed (iter N>1 / fix-pass / spec-remediation only)

| Source row | File:line | What you changed | Status |
|---|---|---|---|
| #1 (block) | `src/auth.ts:13–20` | Rewrote the second JSDoc paragraph. Removed the fabricated `buildApp({ db, auth })` call shape; replaced with a correct description that tests call `buildAuth(dbPath)` standalone for schema seeding / fixture minting and that `buildApp({ testing: true, db: dbPath })` calls `buildAuth(options.db)` itself. The "AppOptions has an `auth` seam" invention is gone. | resolved |
| #2 (nit)   | `src/auth.ts:8–9`   | Softened "exactly once" → "once per app instance". | resolved |

### Known issues / follow-ups

- `audit-auth-S2` remains the next story in this theme (`database as any` cast on ~line 146; dev-secret fallback on ~line 132). Untouched this iteration, per scope.
- No other follow-ups.
