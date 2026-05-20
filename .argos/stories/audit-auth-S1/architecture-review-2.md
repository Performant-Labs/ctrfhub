# Architecture review — audit-auth-S1 — iteration 2

**Reviewer:** architecture-reviewer (Claude Opus 4.7) — review mode
**Date:** 2026-05-19
**Verdict:** PASS
**Diff base:** main @ `ba7d55c`
**Diff head:** story/audit-auth-S1 @ `913a1ee`

## Summary

F's iter-2 commit (`913a1ee`) is a clean, JSDoc-only edit that resolves the iter-1 block. The fabricated `buildApp({ db, auth })` call shape is gone; the rewritten second paragraph correctly states that tests call `buildAuth(dbPath)` standalone for schema seeding (`auth.$context.runMigrations()`) and API-key fixture minting (`auth.api.createApiKey(...)`), and that `buildApp({ testing: true, db: dbPath })` calls `buildAuth(options.db)` itself and does not accept an external auth instance. The optional nit ("exactly once" → "once per app instance") was also addressed. Scope discipline is exemplary — the S2-scoped lines (`database as any` cast on line 148, dev-secret fallback on line 134) remain untouched.

## Findings

No drift detected.

## Prior-iteration check

Iter-1 had one `block`-severity finding and one `nit`-severity finding. Both are resolved by F's iter-2 edit to `src/auth.ts` lines 1–20.

| Iter-1 finding | Status | Evidence |
|---|---|---|
| #1 (block) — JSDoc invents an `auth` field on `AppOptions` and misdescribes why tests call `buildAuth(dbPath)` | resolved | `src/auth.ts:13–20` (committed at `913a1ee`) no longer contains the `buildApp({ db, auth })` call shape. Line 20: "does not accept an externally constructed auth instance." Lines 15–17 name the two concrete reasons tests call `buildAuth(dbPath)` standalone — schema seeding (`auth.$context.runMigrations()`) and API-key fixture minting (`auth.api.createApiKey(...)`). Lines 18–19 state the actual `buildApp` call shape: `buildApp({ testing: true, db: dbPath }) internally calls buildAuth(options.db) itself`. All three sub-requirements of the iter-1 block satisfied. |
| #2 (nit) — "exactly once" reads ambiguously alongside the test-wiring paragraph | resolved | `src/auth.ts:9` now reads "once per app instance during application wiring." F picked the stronger of the two suggested fixes (rather than dropping the adjective), and the choice reinforces the "no process-level singleton" framing of the header. Aligned with the brief. |

### Other ratifications from iter 1 still in force

- `getAuth()` and the `_auth` module-level singleton remain deleted. `grep -rn "getAuth\|_auth\b" src/` exits 1 (zero matches).
- F's literal-grep substring-avoidance phrasing — "this module caches no instance and exposes no module-level accessor function" — is preserved on lines 5–6. The iter-1 ruling on F's decision still stands; no reversal.
- `buildAuth()`, `AuthInstance`, the Fastify module augmentation, `buildDatabase()`, the API-key plugin config, the `database as any` cast on line 148, and the dev-secret fallback on line 134 are all untouched. S2's scope is intact for the next story.

## Notes for the implementer

N/A — PASS.

## Patterns referenced

- `src/auth.ts:1–38` (committed at `913a1ee`) — the rewritten file-header JSDoc. The two paragraphs now match the actual wiring contract.
- `src/types.ts:60–83` — `AppOptions` interface; confirmed (again) that the four DI seams are `db`, `artifactStorage`, `eventBus`, `aiProvider` — no `auth` field. The iter-2 JSDoc no longer conflicts with this.
- `src/app.ts:167–176` — `buildApp(options)` and the internal `await buildAuth(options.db)` call. The iter-2 JSDoc's `buildApp({ testing: true, db: dbPath })` call shape matches.
- `src/__tests__/integration/auth.test.ts:48,115` — `seedAuthSchema` (which calls `auth.$context.runMigrations()`) and `fixtureAuth.api.createApiKey(...)`. Both concrete reasons the iter-2 JSDoc cites are real.
- `src/__tests__/integration/ingest.test.ts:138` — second-suite confirmation of the `createApiKey` fixture pattern.
