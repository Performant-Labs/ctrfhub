# AUTH-001 Test-Writer Handoff

**Branch:** `story/AUTH-001`
**Commit:** `46483d0` (test(AUTH-001): integration tests for global auth preHandler + /api/auth/* catch-all)
**Status:** All integration tests written and passing — ready for spec-audit / PR.

---

## Tests written and passing

File: `src/__tests__/integration/auth.test.ts` — 21 tests, all green.

| Suite | Test | Notes |
|---|---|---|
| Branch 1 — empty-users redirect | `GET /runs (browser, empty DB) → 302 to /setup` | |
| | `GET /runs with HX-Request: true (empty DB) → 200 + HX-Redirect: /setup` | |
| | `GET /health (empty DB) → 200 (exempt)` | |
| | `GET /api/auth/get-session (empty DB) → not redirected to /setup` | |
| | `GET /assets/missing.css (empty DB) → not redirected to /setup` | |
| | `GET /setup (empty DB) → not redirected back to /setup` | |
| Branch 2 — skipAuth bypass | `/health returns 200 with no auth and empty DB` | |
| | `/api/auth/sign-in/email reachable without prior auth` | |
| Branch 3 — API key | `valid ctrf_* key → request passes preHandler (not 302/401)` | |
| | `invalid token in x-api-token → 401 INVALID_API_KEY` | |
| | `valid token + HX-Request: true → passes (not Branch 5)` | |
| | `invalid token does NOT fall through to session/HTMX-401` | |
| Branch 4 — session cookie | `valid session cookie → request passes preHandler` | |
| | `no cookie + no token → falls through to Branch 5` | |
| Branch 5 — unauthenticated | `browser (no auth) → 302 to /login` | |
| | `HTMX (no auth) → 401 + HX-Redirect: /login` | |
| /api/auth/* catch-all | `GET /api/auth/get-session with no cookie → 200` | |
| | `POST sign-in with valid credentials → 200 + Set-Cookie` | |
| | `POST sign-in with bad credentials → 4xx (not 302)` | |
| SECURITY — raw key | `apikey table contains hash, not raw ctrf_* key` | |
| | `verifyApiKey accepts raw key, rejects tampered variant` | |

## Tests not written (confirmed not in scope)

None — all critical paths from `brief.md` §Test tiers and `feature-handoff.md` §Required test cases are covered.

---

## Supporting production changes made

### `src/app.ts`
Resolved the INFRA-002 TODO on `buildApp()`'s test path: when `options.db` is provided, the ORM is now initialized with the production sqlite config (real entities, migrations, `skipTables`) and only overrides `dbName`, `debug`, and `migrations.snapshot`. Without this, `em.count(User)` always threw "entity not discovered" → caught as 0 → Branch 1 redirected all non-Branch-1 tests to `/setup`, making Branches 2–5 unreachable.

Migration snapshots are disabled in the test path (`snapshot: false`) to prevent one `.snapshot-<uuid>.json` being created per unique tempfile DB.

### `src/__tests__/integration/health.test.ts`
The existing `returns 404 for an unregistered route` test was failing because AUTH-001's live preHandler redirects empty-DB requests to `/setup` before routing. Updated to assert the correct behavior.

---

## Fixture strategy (key architectural decision)

Two test layouts are used:

- **`:memory:` apps** — Branch 1 and skipAuth suites. `em.count(User)` throws (table doesn't exist after MikroORM migrations, since `user` is in `skipTables`), caught as 0 → Branch 1 fires. Exactly the right setup for these tests.

- **Tempfile apps** — Branches 3/4/5, /api/auth/* catch-all, and raw-key-storage. `auth.$context.runMigrations()` pre-creates Better Auth's tables in a unique `$TMPDIR/ctrfhub-auth-<uuid>.db`. `buildApp({ db: tmpPath })` opens the same file with MikroORM (CTRFHub tables) and Better Auth (Kysely). A user is signed up via the catch-all; `em.count(User)` now returns 1 → Branch 1 skipped. API key created via `auth.api.createApiKey({ body: { name, userId, metadata } })` on a second auth instance bound to the same file. Tempfiles are deleted in `afterAll`.

---

## Gaps / notes for Argos / spec-audit

1. **`/assets/*` not marked `skipAuth: true`** — static assets are exempt from the empty-users redirect (Branch 1) but NOT from the unauthenticated redirect (Branch 5). This means CSS/JS won't load on the `/login` page until `/login` is shipped with `skipAuth: true` and fastify-static's prefix route is similarly exempted. Not blocking AUTH-001 (no UI in this story), but AUTH-003 (login form) will hit this if it doesn't mark the static route skipAuth. Flagging here; add to `docs/planning/gaps.md` if Argos judges it P0.

2. **`/setup` hits Branch 5 before AUTH-002 ships** — with empty users, `/setup` is exempt from Branch 1 but has no `skipAuth` marker (AUTH-002 ships that route). Any browser hitting `/setup` is 302'd to `/login`, which itself redirects to `/setup` (Branch 1) → loop. This is only observable in the gap between AUTH-001 and AUTH-003 landing, so it's not production-blocking, but worth noting.

3. **`createApiKey` via a second auth instance** — the fixture uses a separate `buildAuth(dbPath)` instance to call `auth.api.createApiKey`. This works because both instances share the same underlying SQLite file. There's no "admin" API key creation endpoint tested here; that's downstream (token management UI, AUTH-00x).
