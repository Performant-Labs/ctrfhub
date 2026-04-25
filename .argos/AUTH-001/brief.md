# Task Brief — AUTH-001: Better Auth integration and global auth hook

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: INFRA-002 (`buildApp()` + auth preHandler skeleton with TODO stubs) and INFRA-004 (entities including `User` matching Better Auth schema) — both merged.
- [x] Required doc fix landed: PR #14 corrected `skills/better-auth-session-and-api-tokens.md` to use `x-api-token` (the convention specified by `product.md §Feature 5 Acceptance criteria`) instead of `Authorization: Bearer`. The TODO stub in `src/app.ts:326-333` still shows the old `Authorization: Bearer` reference — that's an artifact left for AUTH-001 to correct as part of filling in the preHandler branch bodies.
- [x] No P0 gap blocks this story: G-P0-001 / G-P0-002 are UI gaps (downstream); G-P0-003 is settings-UI (downstream); G-P0-004 is closed.
- [x] Branch cut: `story/AUTH-001` from `main`
- [x] `tasks.md` flipped `[ ]` → `[/]` on the story branch (commit `chore(AUTH-001): assign`)
- [x] **Parallel story:** CTRF-001 (Zod CTRF schema + unit tests) is being implemented by **Talos** in the macOS VM at the same time. No file overlap expected (CTRF-001 lives entirely in `src/modules/ingest/schemas.ts` + `src/__tests__/unit/ctrf-validator.test.ts`). You are **Daedalus** on the Mac.

## Story

**Description.** Wire Better Auth into the Fastify factory built by INFRA-002. Replace the five TODO-stub branches of the global auth `preHandler` (created in INFRA-002 at `src/app.ts:309-351`) with their real implementations. Register the `/api/auth/*` catch-all route that delegates to Better Auth's HTTP handler. Configure the apiKey plugin with the `ctrf_` prefix and `storeRawKey: false`. Generate the Better Auth schema files for the existing User entity from INFRA-004.

**Acceptance criteria.** (verbatim from `docs/planning/tasks.md` §AUTH-001, broken into bullets)

- `src/auth.ts` exports `auth` from `betterAuth({ ... })` configured with:
  - The apiKey plugin: `defaultPrefix: 'ctrf_'`, `storeRawKey: false`, `header: 'x-api-token'` (or whatever the plugin's option name is at the version we pin — verify against the corrected skill).
  - The PostgreSQL/SQLite adapter pointing at the same MikroORM-managed connection used by `buildApp({ db })`.
  - The session cookie configuration consistent with `architecture.md §CSRF protection` (SameSite=Lax — Better Auth's default).
- Better Auth schema generated via `npx better-auth generate` (or programmatic equivalent). Output schema lives alongside the User/Organization entities in `src/entities/` per INFRA-004's barrel export. Better Auth-managed tables (`user`, `session`, `account`, `verification`) are excluded from MikroORM migration generation via `schemaGenerator.skipTables` (already in `mikro-orm.config.{pg,sqlite}.ts` from INFRA-004 — confirm it still excludes the right tables after Better Auth's schema lands).
- `/api/auth/*` catch-all route registered with `config: { skipAuth: true }`. Forwards request to `auth.handler(webRequest)` and copies status/headers/body back to the Fastify reply. (See the Good example in the corrected skill.)
- Global `preHandler` (currently a 5-branch TODO scaffold in `src/app.ts:309-351`) gets the bodies filled in — **do not restructure the hook, only fill in the branch bodies**:
  1. **Empty-users check.** Query the `User` entity count via `request.em`. If zero AND the route is not in the explicit allow-list (`/setup`, `/api/auth/*`, `/health`, static assets), redirect to `/setup`. Use `reply.redirect('/setup')` for browser; for HTMX requests set `HX-Redirect: /setup` header + 200.
  2. **`config.skipAuth` bypass.** If the route's `config.skipAuth === true`, return immediately (no auth check).
  3. **API key (`x-api-token` header).** If the header is present, call `auth.api.verifyApiKey({ key, header: 'x-api-token' })`. If valid, attach the resolved API-key user to `request` (typically `request.apiKeyUser` per the skill) and return; if invalid, 401.
  4. **Session cookie.** Call `auth.api.getSession({ headers: request.headers })`. If a valid session, attach `request.user` and return; otherwise fall through to step 5.
  5. **HTMX 401.** If no auth resolved AND `request.headers['hx-request']`, set `HX-Redirect: /login` header + 401 status with empty body. Otherwise, browser redirect to `/login` (302).
- The raw API key value is **never** stored, logged, or echoed back to the client after creation. `storeRawKey: false` enforces this on Better Auth's side; double-check no `console.log` / `request.log.info` of `request.headers['x-api-token']` slipped in.

**Test tiers required.**

- **integration** — fastify.inject() against `buildApp({ testing: true, db: ':memory:' })` covering all five precedence branches plus the `/api/auth/*` catch-all.

**Page verification tiers.**

- **T1 Headless only** — assert response shapes: 401 status / body, `HX-Redirect` response header on HTMX-401, `/setup` redirect on empty DB, 200 with skipAuth bypass for `/health`.
- T2 / T2.5 / T3 not applicable — no rendered UI in this story (login form is AUTH-003, setup wizard is AUTH-002).

**Critical test paths.** (verbatim from tasks.md, broken out)

- Valid session cookie → request passes (200 / handler runs).
- Valid `ctrf_*` API key in `x-api-token` header → request passes; `request.apiKeyUser` populated.
- Missing auth on a non-skipAuth route → 401.
- HTMX request missing auth → 200 status with `HX-Redirect: /login` response header (NOT 401 — HTMX needs the 200 to consume the redirect).
- Raw API key never stored — only the hash. Test by creating a key, asserting the DB row contains a hash (not the plaintext).
- Empty `User` table → request to `/runs` (or any non-allowlisted route) redirects to `/setup`. Once a user is seeded, the same request goes through normal auth.
- `skipAuth: true` bypass works for `/api/auth/*` and `/health` (already verified for `/health` in INFRA-002; add `/api/auth/*` coverage).

## Required reading

**Skills (full paths — read before any code).**

- `skills/better-auth-session-and-api-tokens.md` — **Read this whole skill.** Recently corrected in PR #14 to use `x-api-token` instead of `Authorization: Bearer`. The §Why paragraph that was added in that PR explains where the convention comes from. The §How to apply preHandler enumeration matches the 5-branch structure already scaffolded in `src/app.ts:309-351`. The §Good example shows the `/api/auth/*` catch-all and the ingest-route token-scope check pattern.
- `skills/page-verification-hierarchy.md` — T1 Headless patterns for asserting `HX-Redirect` headers via `app.inject()`. The §T1 section on `inject().headers` is what your integration tests use.
- `skills/zod-schema-first.md` — If any new request/response schemas appear (e.g., the `/api/auth/*` route's response shape), define them as Zod schemas and let TS types derive — don't write ad-hoc TS interfaces alongside.
- `skills/fastify-route-convention.md` — For the `/api/auth/*` catch-all: it's a Fastify plugin that delegates to `auth.handler()`; it does NOT use the service-layer pattern (the service is Better Auth itself). The skipAuth bypass mechanism is canonical fastify-route-convention.

**Planning doc sections.**

- `docs/planning/product.md` §Feature 5 (Auth) and §Feature 5 Acceptance criteria — authoritative spec for the API token header convention (`x-api-token`) and the preHandler precedence order.
- `docs/planning/architecture.md` §CSRF protection — explains why we deliberately don't add CSRF tokens (SameSite=Lax + HTMX XHR semantics make it redundant).
- `docs/planning/database-design.md` §4 (Better Auth note) — confirms which tables Better Auth owns and why they're excluded from MikroORM migration generation.
- `docs/planning/tasks.md` §AUTH-001 — the canonical acceptance criteria source.

## Files in scope

- `src/auth.ts` — new (the `betterAuth({ ... })` config + export of `auth`)
- `src/app.ts` — modify
  - Fill in the 5 preHandler branch bodies at `src/app.ts:309-351` (do NOT restructure the hook itself)
  - Register the `/api/auth/*` catch-all route (typically near where `/health` is registered around L368)
  - Update the TODO comment at L326-333 to remove the stale `Authorization: Bearer` reference (it predates PR #14's skill correction)
- `src/modules/auth/routes.ts` — new (the `/api/auth/*` catch-all plugin per `fastify-route-convention.md` §Good example)
- Generated Better Auth schema — wherever `npx better-auth generate` puts it; align with INFRA-004's existing `src/entities/User.ts` if there's drift
- `src/__tests__/integration/auth-prehandler.test.ts` — new (covers the 5 precedence branches)
- `src/__tests__/integration/auth-catchall.test.ts` — new (`/api/auth/*` skipAuth, request forwarding, response copying)
- `src/__tests__/integration/api-key-storage.test.ts` — new (asserts raw key never persists; only the hash)
- `src/__tests__/integration/empty-users-redirect.test.ts` — new (the empty-DB → `/setup` redirect for browser AND HTMX)
- `package.json` — add `better-auth` dep if INFRA-002 didn't already

## Anti-patterns (will fail spec-enforcer review — see `CLAUDE.md` "Forbidden patterns")

- Raw CSRF-token or session-cookie handling outside Better Auth → `better-auth-session-and-api-tokens.md`. Use Better Auth's `auth.api.getSession()` only; don't read `request.cookies` directly to do auth.
- Zod schema defined ad-hoc inside a handler instead of in a schemas file → `zod-schema-first.md`. If `/api/auth/*` introduces any response schemas, put them in `src/modules/auth/schemas.ts`.
- Mocking Better Auth in integration tests → tests should use the real Better Auth instance against the in-memory SQLite DB (per `vitest-three-layer-testing.md` §Layer 2).
- Logging or echoing the raw API token. The `Bad example` in the corrected skill shows what NOT to do.
- Restructuring the preHandler skeleton from INFRA-002 — fill in the bodies only. The 5-branch ordering is canonical per the skill's §How to apply.

## Next action (Feature-implementer = Daedalus)

1. Open a fresh AntiGravity session on the Mac. Paste `.antigravity/agents/feature-implementer.md` first, then this Brief (`.argos/AUTH-001/brief.md`) second.
2. `git checkout story/AUTH-001` (already cut and pushed by Argos).
3. `npm install better-auth` (and any peer deps Better Auth needs — check its README for the version range pinned in our package.json after install).
4. Read the four skills + planning sections above. The Better Auth skill especially — it was just rewritten in PR #14 and is the canonical statement of what this story implements.
5. Implement in this order to surface integration issues early:
   - `src/auth.ts` — config first; running `npx better-auth generate` will exercise it
   - Generated schema reconciliation with INFRA-004's `src/entities/User.ts`
   - `/api/auth/*` route in `src/modules/auth/routes.ts`
   - Fill in the 5 preHandler branch bodies in `src/app.ts` (delete the TODOs as you complete each one)
   - Integration tests
6. Commit with `feat(AUTH-001): …`, `test(AUTH-001): …`, `fix(AUTH-001): …`. `chore(AUTH-001): …` is reserved for Argos status flips.
7. Write the feature-handoff to `.argos/AUTH-001/feature-handoff.md`. The Test-writer (or the spec-audit step that follows) reads only that — be precise about: any deviation from the corrected skill, any places Better Auth's API surface differs from what the skill describes, any decisions about where the generated Better Auth schema files live.
8. Hand back to André so he can open the Test-writer / spec-audit step.

## Notes from Argos

- INFRA-004's `User` entity exists. Better Auth will want to manage its own User schema. The `database-design.md §4 (Better Auth note)` says: CTRFHub's Organization/User entities exist for ORM relationship mapping only; the actual DDL is Better Auth's. So when `npx better-auth generate` produces its schema, the User entity from INFRA-004 should align (or the entity should be revised to match what Better Auth emits). Don't run two parallel User schemas — pick one source of truth and adjust the other.
- The `/api/auth/*` catch-all is the **only** route that should NOT use `ZodTypeProvider` — it forwards to Better Auth's HTTP handler which has its own contract. All other routes (none in this story, but going forward) keep ZodTypeProvider.
- The TODO stub in `src/app.ts:326-333` references `Authorization: Bearer` — that's drift from INFRA-002 that PR #14 fixed at the skill level but couldn't fix at the code level (the TODO is a stub, not real code). When you fill in the API-key branch (precedence step 3), use `x-api-token` per the corrected skill. The TODO comment itself can be deleted as you replace the stub with real code.
- For testing: use `auth.api.createApiKey({ name, metadata: { projectId }, userId })` to seed test fixtures. The `metadata.projectId` is what CTRF-002's ingest route will check for token-scope per the skill's §Good example — your tests don't need to exercise the project-scope check (that's CTRF-002's territory) but the apiKey-creation path should be exercised.
- Ignore CTRF-001 entirely. Talos is on it in the VM; the two stories don't share files.
