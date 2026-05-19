# Architecture review — audit-auth-S1 — iteration 1

**Reviewer:** architecture-reviewer (Claude Opus 4.7) — review mode
**Date:** 2026-05-19
**Verdict:** BLOCK
**Diff base:** main @ `ba7d55c`
**Diff head:** story/audit-auth-S1 @ `ebd8239`

## Summary

The dead-code deletion itself is clean and meets every mechanical acceptance criterion (singleton gone, `buildAuth()`/`AuthInstance`/Fastify augmentation untouched, grep returns zero, `tsc --noEmit` clean, 498/498 tests pass). However, the rewritten file-header JSDoc — the *other* half of this story's two-change scope — contains a factual fabrication about the test-wiring contract. It claims integration tests pass the result of `buildAuth(':memory:')` into `buildApp({ db, auth })`, but no such `auth` field exists on `AppOptions` and no test calls `buildApp` with an `auth` parameter. This is exactly the failure mode S1 was created to fix ("actively misleading documentation about an architecture that does not exist"), so it has to be corrected before merge.

## Findings

| # | Severity | File:line | Drift dimension | Finding | Suggested fix |
|---|---|---|---|---|---|
| 1 | block | `src/auth.ts:15–18` | pattern consistency / semantic faithfulness | New JSDoc asserts: "Integration tests therefore call `buildAuth(':memory:')` themselves and pass the result into `buildApp({ db, auth })`." This is incorrect on two counts. (a) `AppOptions` in `src/types.ts:60–83` has exactly four optional DI seams — `db`, `artifactStorage`, `eventBus`, `aiProvider` — **no `auth` field exists**. (b) Every test under `src/__tests__/integration/` that calls `buildAuth(dbPath)` does so to (i) seed Better Auth's schema via `auth.$context.runMigrations()` (e.g. `auth.test.ts:48–55`, `seedAuthSchema`) or (ii) construct API-key fixtures via `fixtureAuth.api.createApiKey(...)` (e.g. `auth.test.ts:115`, `ingest.test.ts:138`). None of them thread the result into `buildApp` — they pass `{ testing: true, db: dbPath }` and let `buildApp` call `buildAuth(options.db)` itself at `src/app.ts:176`. The JSDoc both invents a DI seam that does not exist and misdescribes why tests instantiate `buildAuth` directly. Check #3 of the review charter is explicit: "The JSDoc should not assert anything else." | Rewrite lines 13–18 of `src/auth.ts` to state the actual contract — for example: *"Per `architecture.md §Code Conventions → Abstraction level`, cross-cutting dependencies a test needs to substitute belong on the `AppOptions` DI seam — not as ambient module-level singletons. Integration tests that need to seed Better Auth's schema or mint API-key fixtures directly therefore call `buildAuth(dbPath)` standalone and operate on the returned instance; `buildApp({ testing: true, db: dbPath })` internally calls `buildAuth(options.db)` once when wiring the app."* Keep the architecture-section pointer and the test-seam framing; drop the fictional `{ db, auth }` call shape and the implication that tests thread an auth instance into `buildApp`. |
| 2 | nit | `src/auth.ts:8–9` | abstraction level | The phrase "calls `buildAuth(options.db)` **exactly once** during application wiring" is technically true per `buildApp` invocation but reads ambiguously alongside the test-wiring sentence (which describes multiple invocations). Consider "calls `buildAuth(options.db)` once per app instance" or just dropping "exactly". Non-blocking; cosmetic. | Soften "exactly once" to "once per app instance" or remove the adjective. |

## Prior-iteration check (iteration > 1 only)

N/A — iteration 1.

## Ruling on F's flagged decision (handoff §"Decisions not covered by planning docs")

**F's call stands.** F reworded the JSDoc to avoid the literal `getAuth` substring rather than using a "no `getAuth()` accessor" negative phrasing. This is the correct read of the brief. The acceptance criterion is explicit and literal — `grep -rn "getAuth\|_auth\b" src/` must return zero — and F's chosen phrasing ("this module caches no instance and exposes no module-level accessor function") loses no semantic content while satisfying the contract. The brief also frames the audit's theme as "an architecture that does not exist" — describing the absence of a *category of pattern* (a module-level accessor function) is on-spec and arguably more durable than naming a specific symbol that no longer exists. The literal-grep convention is in line with how the rest of the audit-loop tooling works (mechanical, scriptable checks). No reversal warranted.

## Notes for the implementer (BLOCK only)

One targeted JSDoc edit. Lines 13–18 of `src/auth.ts`:

- Remove the parenthetical `into buildApp({ db, auth })` — there is no `auth` seam on `AppOptions`. If you want to keep a `buildApp` reference here, write the actual call shape (`buildApp({ testing: true, db: dbPath })` or `buildApp({ db })`) and clarify that `buildApp` calls `buildAuth(options.db)` *itself* — the standalone `buildAuth(dbPath)` call in tests exists for schema-seeding / fixture purposes, not for injection.
- Optionally address finding #2 ("exactly once") while you are in there — same paragraph, one-word edit.

No other source changes needed. Re-run `grep -rn "getAuth\|_auth\b" src/` (still must be empty), `tsc --noEmit`, and `npm test` after the edit; expect all three to remain clean.

Do **not** touch anything else in `src/auth.ts` (`buildAuth`, `AuthInstance`, the Fastify augmentation, `buildDatabase`, the API-key plugin config, the `database as any` cast on line 146, or the dev-secret fallback on line 132 — those last two are explicitly S2's scope).

## Patterns referenced

- `src/types.ts:60–83` — `AppOptions` interface; defines the four DI seams (`db`, `artifactStorage`, `eventBus`, `aiProvider`). Used as the authority that "auth" is not among them.
- `src/app.ts:167–176` — `buildApp(options)` and its internal `await buildAuth(options.db)` call. Confirms `buildApp` always builds its own `auth`; never receives one.
- `src/app.ts:669` — `await registerAuthRoutes(app, auth);` — the second internal consumer of the in-process `auth` instance, also not externally injectable.
- `src/__tests__/integration/auth.test.ts:48,81,115,154,494,527` — full picture of how tests use `buildAuth` (schema seed + API-key fixture, plus `buildApp({ testing, db })` without an `auth` field).
- `src/__tests__/integration/ingest.test.ts:75,96,138` — same pattern in a second suite, confirming the wiring is consistent across the integration tests, not a one-off in `auth.test.ts`.
- `src/modules/auth/routes.ts:36` — `registerAuthRoutes` naming confirms the new JSDoc's reference to that function name is accurate (the only piece of the rewritten header that *is* faithful to a real symbol it didn't already cite on `main`).
