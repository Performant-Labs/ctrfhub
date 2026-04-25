# Spec-enforcer Audit — AUTH-001

**Executed:** 2026-04-25 13:02
**Scope:** diff `main..story/AUTH-001`
**Checklists run:** Architecture rules, Coverage, Planning docs conformance, Skills violations (better-auth-session-and-api-tokens, fastify-route-convention, zod-schema-first, mikroorm-dual-dialect, htmx-4-forward-compat)

---

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| 1 | `src/app.ts:416` | `docs/planning/tasks.md` line 65 (authoritative spec): "HTMX request missing auth → **200** with `HX-Redirect: /login`". Skill doc `skills/better-auth-session-and-api-tokens.md` line 30 contradicts this with "401". The inline comment at `src/app.ts:411–412` also says "HTMX clients need a 200-with-HX-Redirect (NOT 401)". The implementation sends 401. | Spec conflict between `tasks.md` (200) and `skills/better-auth-session-and-api-tokens.md` (401) requires human resolution before remediation. If `tasks.md` prevails (it is the authoritative spec per CLAUDE.md): change `reply.status(401).send()` → `reply.status(200).send()` and update the skill doc. If the skill doc prevails: update `tasks.md` line 65 and remove the contradicting inline comment. | **BLOCKING** |
| 2 | `src/app.ts` — no call to Better Auth schema migration | `docs/planning/tasks.md` line 66 acceptance criteria: "Better Auth schema generated (`npx better-auth generate`)". `brief.md` line 22–23: "Output schema lives alongside the User/Organization entities in `src/entities/`". No schema files added to `src/entities/`. `buildApp()` calls `orm.migrator.up()` (MikroORM only); Better Auth tables are in `skipTables` and are never created on a fresh deploy. Integration tests work only because `seedAuthSchema()` calls `auth.$context.runMigrations()` before `buildApp()`. In production, a fresh database will fail all Better Auth endpoints. | Either: (a) generate the Better Auth schema (`npx better-auth generate`, commit output to `src/entities/` or a `migrations/better-auth/` directory), and add `auth.$context.runMigrations()` to the `buildApp()` startup sequence after `orm.migrator.up()`; or (b) document the manual pre-deploy migration step in `docs/planning/` and update `tasks.md`. Requires Argos/human decision on intended deployment pattern. | **BLOCKING** |
| 3 | `src/app.ts:328` | Stale comment from INFRA-002 TODO. Says "3. Bearer API key (ctrf_*) validation" — `Authorization: Bearer` was the old convention corrected by PR #14. Brief line 73 explicitly says to remove this artifact. | Change "Bearer API key" → "`x-api-token` API key" | NIT |
| 4 | `src/app.ts:411–412` | Inline comment contradicts implementation: "HTMX clients need a 200-with-HX-Redirect (NOT 401)" but code sends 401. Either the comment or the code is wrong. Resolution depends on Finding #1. | Resolve after Finding #1 is decided: if 200 is correct, fix the code; if 401 is correct, fix the comment. | NIT (linked to BLOCKING #1) |

---

## Coverage gaps

| # | What's missing | Required by | Severity |
|---|---|---|---|
| 1 | `request.apiKeyUser` population is not asserted. Tests verify a valid `ctrf_*` key causes the request to pass (returns 404 at routing), but no test asserts `request.apiKeyUser` is populated with the correct `id`, `referenceId`, or `metadata.projectId`. | `brief.md` line 46 critical test path: "Valid `ctrf_*` API key in `x-api-token` header → request passes; `request.apiKeyUser` populated." `tasks.md` line 65 critical test paths. | **BLOCKING** |
| 2 | Test files named in brief were consolidated. Brief (`brief.md` line 79–81) specified four separate test files: `auth-prehandler.test.ts`, `auth-catchall.test.ts`, `api-key-storage.test.ts`, `empty-users-redirect.test.ts`. All tests were written into a single `auth.test.ts`. Coverage is functionally equivalent; this is a file-organization deviation only. | `brief.md` §Files in scope | NIT |

---

## Planning-doc conformance (lines relevant to AUTH-001 scope)

- [x] `/api/auth/*` catch-all route registered with `config: { skipAuth: true }` — `src/modules/auth/routes.ts:52`
- [x] API key header is `x-api-token` (not `Authorization: Bearer`) — `src/auth.ts:169`, `src/app.ts:385`
- [x] `defaultPrefix: 'ctrf_'` configured on the apiKey plugin — `src/auth.ts:171`
- [x] `disableKeyHashing` not set → defaults to `false` → raw key never persisted — `src/auth.ts:162–164`
- [x] `skipAuth: true` on `/api/auth/*` (explicitly exempts from preHandler) — `src/modules/auth/routes.ts:52`
- [x] `skipAuth: true` on `/health` — `src/app.ts:437`
- [x] Session cookie uses Better Auth default (SameSite=Lax) per `architecture.md §CSRF protection` — `src/auth.ts:147–148`
- [x] `'apikey'` added to `schemaGenerator.skipTables` in both dialect configs — `src/mikro-orm.config.sqlite.ts:45`, `src/mikro-orm.config.pg.ts:44`
- [x] `request.em` used for `User` count (not `fastify.orm.em`) — `src/app.ts:353`
- [x] Raw API key never logged — no `console.log` or `request.log.*` of `x-api-token` value in any changed file
- [x] All integration test suites call `afterAll(() => app.close())` — `src/__tests__/integration/auth.test.ts:157,223,261,379,431`; `src/__tests__/integration/health.test.ts` all describe blocks
- [ ] Better Auth schema generated (`npx better-auth generate`) and committed — **NOT DONE** (Finding #2 above)
- [ ] Branch 5 HTMX status: `tasks.md` says 200; implementation sends 401 — **spec conflict** (Finding #1 above)

---

## Forbidden-pattern scan (from CLAUDE.md)

Diff scanned against all forbidden patterns from CLAUDE.md:

- [x] No `hx-target`/`hx-swap` inherited from a parent — not applicable (no templates in this story)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — not applicable (no HTMX event usage in this story)
- [x] No `hx-disable` anywhere in templates — not applicable
- [x] No Alpine `x-data` inside an HTMX swap target — not applicable
- [x] No Postgres-only SQL / dialect-specific features without a SQLite equivalent — no `p.array()`, `p.jsonb()`, or UUID PKs added; `skipTables` changes are dialect-neutral
- [x] No DB mocked in integration tests — `buildApp({ testing: true, db: ':memory:' })` and `buildApp({ db: tmpPath })` use real SQLite; `auth.$context.runMigrations()` in `seedAuthSchema()` uses real Better Auth against real SQLite
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — not applicable (T3/T2 not in scope for this story)
- [x] No layout-token change without T2 backdrop-contrast re-check — not applicable
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — session is validated exclusively via `auth.api.getSession()` at `src/app.ts:404`; cookies are not read directly
- [x] No Zod schema defined ad-hoc in a handler — `/api/auth/*` catch-all correctly skips ZodTypeProvider (per brief §Notes from Argos); `src/modules/auth/schemas.ts` exists as a placeholder per the module layout convention

---

## Verdict

**BLOCK** — remediation required on the following before the story may proceed to PR:

- **Finding #1** (BLOCKING): Branch 5 HTMX status code — spec conflict between `tasks.md` (200) and `skills/better-auth-session-and-api-tokens.md` (401). Requires human decision on which is authoritative, then code or skill update accordingly. Both `src/app.ts:416` and `src/app.ts:411–412` comment need to be consistent and match the resolved spec. The test at `src/__tests__/integration/auth.test.ts:357` currently asserts 401 — it must also be updated once the spec is resolved.
- **Finding #2** (BLOCKING): Better Auth schema not generated. `tasks.md` acceptance criteria explicitly requires "Better Auth schema generated (`npx better-auth generate`)". The production startup path has no mechanism to create Better Auth's tables on a fresh database. Requires Argos/human decision on whether to (a) generate + commit the schema and call `runMigrations()` in `buildApp()`, or (b) document the deployment-time migration step.
- **Coverage gap #1** (BLOCKING): `request.apiKeyUser` population not asserted. Add a test that verifies the populated fields (e.g. a dedicated test route in the integration test fixture that returns `request.apiKeyUser`, or assert via a downstream check).

Findings #3, #4 (NITs) and Coverage gap #2 (NIT) may be resolved in the same pass or deferred to a follow-up.

Return the story to the Feature-implementer per `implementstory.md` Phase 1. Once remediated, re-run T1 integration tests (tests → spec-audit). T2/T3 not applicable for this story.
