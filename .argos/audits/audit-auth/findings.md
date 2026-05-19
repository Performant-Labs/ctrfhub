# Architecture audit — audit-auth

**Reviewer:** architecture-reviewer (Claude Opus 4.7) — audit mode
**Date:** 2026-05-19
**Scope:** Auth subsystem (T1) — `src/auth.ts` (`buildAuth()` Better Auth factory) and `src/modules/auth/` (`routes.ts` `/api/auth/*` catch-all, `schemas.ts`).
**Files examined:** 3 in-scope, read in full; 4 neighbouring files read as pattern evidence.
**Patterns baseline:** `docs/planning/architecture.md` (merged PRs #76 + #77 — §Security/CSRF, §Layering and Dependency Direction, §Code Conventions); `skills/better-auth-session-and-api-tokens.md`; `skills/zod-schema-first.md`.

## Summary

The auth subsystem is in good architectural shape: the Better Auth integration boundary is clean — no raw CSRF-token, session-cookie, or API-token handling escapes the Better Auth integration, so there are **no `block`-severity findings**. CSRF posture (`SameSite=Lax`, no explicit token) and API-key configuration (`x-api-token` header, `ctrf_` prefix, hashing-on) conform to `skills/better-auth-session-and-api-tokens.md` and `architecture.md §CSRF protection`. The drift that exists is concentrated in `src/auth.ts`: an exported-but-unused `getAuth()`/`_auth` singleton whose JSDoc actively misdescribes how `app.ts` wires auth, an `as any` cast on the `database` config, and a hardcoded dev-secret fallback. The route layer (`routes.ts`) is thin, correctly delegates to `auth.handler()`, and conforms to the adjudicated `registerAuthRoutes` variant shape. The highest-leverage fix is collapsing the dead singleton (Finding 1), which also removes the inaccurate JSDoc.

## Findings

| # | Severity | File:line | Drift dimension | Finding | Suggested remediation | Estimated story size |
|---|---|---|---|---|---|---|
| 1 | warn | `src/auth.ts:179-212` | abstraction level / pattern consistency | `getAuth()` and the module-level `_auth` lazy singleton are exported but consumed by no code in `src/` (`grep` finds zero callers outside `auth.ts`). `app.ts:176` instead calls `buildAuth(options.db)` directly so the integration-test DI seam works. This is an over-abstraction — a singleton accessor for a thing that is constructed exactly once at the composition root — and it is dead code. | Delete `getAuth()` and the `_auth` variable; keep `buildAuth()` and the `AuthInstance` type alias. `buildApp()` already owns instantiation as the composition root, which is the codebase's DI convention (`architecture.md §Abstraction level` — "ambient module-level singletons" are the anti-pattern). | XS |
| 2 | warn | `src/auth.ts:4-7` | naming / pattern consistency (stale doc) | The file-header JSDoc states the `auth` instance is "consumed by `src/app.ts` global preHandler" and the `getAuth()` JSDoc (`auth.ts:194`) is `@example`-documented as the canonical access path — but `app.ts` never imports `getAuth` or any `auth` singleton; it calls `buildAuth()` directly. The doc describes an architecture that does not exist. | Fold into Finding 1: when the singleton is removed, rewrite the header JSDoc to state that `buildAuth()` is a factory called once by `buildApp()` (`src/app.ts`) and once per integration test with `':memory:'`. Self-consistent with `architecture.md §Layering` ("`buildApp()` is the composition root"). | XS |
| 3 | warn | `src/auth.ts:131-132` | pattern consistency / abstraction level | `database: database as any` casts away all type safety on the Better Auth config's most security-sensitive field, suppressed with a blanket `eslint-disable @typescript-eslint/no-explicit-any`. The cast exists because `buildDatabase()` returns a `pg.Pool \| BetterSqlite3.Database` union. The ingest module shows the same `as any` idiom for the `fastify.eventBus` DI seam (`ingest/routes.ts:141-143`), so this is a recurring codebase pattern, not unique drift — but on the auth DB connection it is the least desirable place for it. | Give `buildDatabase()` an explicit return type (the Better Auth `database`-option type, or a documented narrowed union) so the `as any` and its `eslint-disable` can be dropped. Low urgency — Better Auth's own option typing makes a clean annotation non-trivial; track as a tidy-up when AUTH-002 next touches the file. | S |
| 4 | warn | `src/auth.ts:118` | cross-cutting / security posture | `secret:` falls back to a hardcoded literal (`'ctrfhub-dev-secret-do-not-use-in-production-32c'`) when `BETTER_AUTH_SECRET` is unset. `architecture.md §Environment variables` lists `SESSION_SECRET` as a required (✅) min-32-char secret; a silent dev-secret fallback means a misconfigured production deploy boots with a known, source-visible signing key instead of failing fast. Auth is high-stakes; this is a posture inconsistency, not an active breach (no token handling escapes Better Auth), hence `warn`. | Fail fast when `BETTER_AUTH_SECRET` is missing and `NODE_ENV === 'production'` (throw in `buildAuth()`), or gate the literal fallback behind an explicit non-production check. Keep the dev convenience for local/test only. Confirm against `architecture.md §Environment variables` whether `BETTER_AUTH_SECRET` should be promoted to the required table. | S |

Severity scale: `block` (architectural violation that should be fixed), `warn` (inconsistency worth tracking but not urgent).
Estimated story size: XS (<1 hr), S (1–4 hr), M (half-day), L (full day or more).

## Themes

**Theme A — `src/auth.ts` carries a dead, mis-documented singleton (Findings 1 + 2).** Both findings share one root cause: an early `getAuth()`/`_auth` lazy-singleton design that was superseded by direct `buildAuth()` instantiation at the composition root once the integration-test DI seam (`buildApp(options.db)`) landed. The singleton was never deleted, and the file-header and `@example` JSDoc still describe it as the live access path. These collapse into **a single XS story**: delete `getAuth()` + `_auth`, rewrite the header JSDoc to describe `buildAuth()` as a composition-root factory. This is the highest-leverage fix — it removes dead code *and* the only actively misleading documentation in the subsystem.

**Theme B — type-safety and secret-posture hardening on the Better Auth config (Findings 3 + 4).** Both touch `buildAuth()`'s config object and both are best handled when AUTH-002 next opens the auth module (the adjudicated normalization point in `architecture.md §Code Conventions → Route registration`). Finding 3 (the `database as any` cast) and Finding 4 (the hardcoded secret fallback) are independent but co-located; bundling them into **one S-sized "auth config hardening" story** alongside the AUTH-002 route-registration normalization minimizes churn on a high-stakes file. Neither blocks; both are tracked drift.

## Out of scope but noticed

- **The global auth preHandler (`src/app.ts §9`, lines ~547-602) is territory T6 (`audit-composition-root`) — not audited here.** Read only as wiring evidence. Two observations to carry into that audit, *not* filed as findings: (a) `app.ts:176` calls `buildAuth(options.db)` directly rather than `getAuth()` — relevant to how T6 assesses composition-root DI consistency; (b) the preHandler's Branch-3 API-key path correctly logs presence-not-value and returns `401` early (`app.ts:561-573`), which is conformant — worth confirming under T6's lens.
- **`src/modules/auth/` ships no `service.ts`.** This is correct and expected — Better Auth *is* the service for `/api/auth/*`, and `architecture.md §Module boundaries` makes `service.ts` conditional ("when it has non-trivial logic"). Noted only so a future audit does not mistake its absence for drift.
- **Auth has no in-scope test files** (auth tests live under `src/__tests__/`, out of scope per `audit-scope.md`). Whether the `getAuth()` singleton being dead code is masked by a test that still imports it is worth a glance during the test audit — recommend the test-suite audit territory check for stale imports of removed auth exports if Finding 1 is actioned.

## Files examined

Read in full (in scope):
- `src/auth.ts`
- `src/modules/auth/routes.ts`
- `src/modules/auth/schemas.ts`

Read as neighbouring pattern evidence (out of scope):
- `src/modules/ingest/routes.ts` — canonical `FastifyPluginAsync` route shape, `{ error, code }` error bodies, `as any` DI-seam idiom
- `src/modules/health/schemas.ts` — Zod-schema-location convention reference
- `src/app.ts` (lines 49-51, 176, 358, 540-669) — auth wiring / `registerAuthRoutes` registration / global preHandler (T6 territory, evidence only)
- `docs/planning/architecture.md` §Security/CSRF, §Layering and Dependency Direction, §Code Conventions
- `skills/better-auth-session-and-api-tokens.md`
