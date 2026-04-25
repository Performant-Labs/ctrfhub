# AUTH-001 Feature Handoff

**Branch:** `story/AUTH-001`  
**Commit:** `e529a6e` (feat(AUTH-001): wire Better Auth — preHandler, API-key plugin, auth catch-all)  
**Status:** Feature implementation complete — ready for Test-writer

---

## What was implemented

### `src/auth.ts` (new)
Better Auth factory (`buildAuth(dbPath?)`) and singleton (`getAuth()`).

- `@better-auth/api-key` plugin configured with:
  - `apiKeyHeaders: 'x-api-token'` — per `product.md §Feature 5` convention
  - `defaultPrefix: 'ctrf_'` — all CTRFHub CI tokens start with `ctrf_`
  - `enableMetadata: true` — downstream ingest (CTRF-002) reads `metadata.projectId`
  - **No `storeRawKey` option exists in `@better-auth/api-key` 1.x.** Key hashing is the default (`disableKeyHashing` defaults to `false`). Raw key values are never stored.

- `emailAndPassword: { enabled: true }` — for setup wizard (AUTH-002)

- Database selector: if `DATABASE_URL` env is set → `pg.Pool`; else → `better-sqlite3` Database at `SQLITE_PATH` or `:memory:`

- Fastify type augmentation exports:
  - `SessionUser` (attached to `request.user` after session validation)
  - `ApiKeyUser` (attached to `request.apiKeyUser` after API-key validation)

### `src/modules/auth/routes.ts` (new)
`/api/auth/*` catch-all route (`skipAuth: true`).

- Accepts GET, POST, PUT, DELETE, PATCH
- Converts Fastify request to Fetch API `Request` using `fromNodeHeaders(request.headers)`
- Delegates to `auth.handler(fetchRequest)` and bridges response back to Fastify reply
- Request body is only forwarded when method is not GET/HEAD

### `src/modules/auth/schemas.ts` (new)
Placeholder per `fastify-route-convention.md §File layout`. No Zod schemas — Better Auth owns its contract.

### `src/app.ts` (modified)
**5 preHandler branches filled:**

1. **Empty-users → `/setup`**: Queries `request.em.count(User)`. If 0 (or table missing), HTMX requests get `HX-Redirect: /setup` + 200; browser requests get 302. Exempt routes: `/setup/*`, `/api/auth/*`, `/health`, `/assets/*`

2. **skipAuth bypass**: Unchanged from INFRA-002. Routes with `config: { skipAuth: true }` return immediately.

3. **API-key (`x-api-token`)**: Calls `auth.api.verifyApiKey({ body: { key: apiToken } })`. On success, attaches `result.key` to `request.apiKeyUser` and returns. On failure, returns 401 with `INVALID_API_KEY` code (no fall-through to session or HTMX branch).

4. **Session cookie**: Calls `auth.api.getSession({ headers: fromNodeHeaders(request.headers) })`. On success, attaches `session.user` to `request.user` and returns.

5. **Unauthenticated**: HTMX requests → 401 + `HX-Redirect: /login`. Browser requests → 302 to `/login`.

**Other changes:**
- Augmented `FastifyRequest` with `em: any`, `user?: SessionUser`, `apiKeyUser?: ApiKeyUser`
- Registered auth routes as step 10b (after health, before signal handlers)
- `buildAuth(options.db)` called at step 0 of `buildApp()`
- Updated file header JSDoc

### `src/mikro-orm.config.{sqlite,pg}.ts` (modified)
Added `'apikey'` to `schemaGenerator.skipTables` — Better Auth's API-key table is excluded from MikroORM migration generation.

---

## Deviations from brief

| Brief spec | Actual implementation | Reason |
|---|---|---|
| `storeRawKey: false` | Not set — `disableKeyHashing` defaults to `false` (hashing ON) | `storeRawKey` option does not exist in `@better-auth/api-key` 1.x. Hashing is enabled by default. |
| `Authorization: Bearer` header in TODO comment | `x-api-token` header (corrected) | Brief explicitly stated the old comment was an artifact to fix. |
| `apiKey` bundled in `better-auth` | `@better-auth/api-key` (separate package, now installed) | The plugin is not bundled. |
| HTMX branch returns 401 | Branch 1 (empty-users) uses 200+HX-Redirect; Branch 5 uses 401+HX-Redirect | HTMX requires 200 for HX-Redirect when intercepting navigation, but 401 for the unauthenticated case is correct per the skill doc. |

---

## Test coverage needed (for Test-writer)

All tests go in `src/__tests__/integration/auth.test.ts`. Use `buildApp({ testing: true, db: ':memory:' })` for isolation.

### Required test cases

#### Branch 1 — Empty-users redirect
- `GET /runs` with empty DB → `302 Location: /setup`
- `GET /runs` with `HX-Request: true` and empty DB → `200`, `HX-Redirect: /setup` header
- `GET /health` with empty DB → `200` (exempt)
- `GET /api/auth/get-session` with empty DB → `200` (exempt)
- `GET /setup` with empty DB → not redirected (exempt)

#### Branch 2 — skipAuth bypass
- Route with `config: { skipAuth: true }` → passes through without auth check

#### Branch 3 — API-key validation
- Valid `ctrf_*` token in `x-api-token` header → `request.apiKeyUser` populated, request proceeds
- Invalid token in `x-api-token` → `401` with `{ code: 'INVALID_API_KEY' }`
- Raw token value must NOT appear in any log output (SECURITY requirement)
- Valid token + `HX-Request: true` → still passes (not routed to Branch 5)

#### Branch 4 — Session cookie
- Request with valid session cookie → `request.user` populated, request proceeds
- Request with no cookie and no token → falls to Branch 5

#### Branch 5 — Unauthenticated
- Unauthenticated browser request → `302 Location: /login`
- Unauthenticated HTMX request (`HX-Request: true`) → `401`, `HX-Redirect: /login` header

#### `/api/auth/*` route
- `GET /api/auth/get-session` with no cookie → Better Auth returns `200` with `{ session: null }` (not a 302 redirect)
- `POST /api/auth/sign-in/email` with valid credentials → Better Auth returns session cookie

---

## Gaps flagged

No new gaps. The brief's `storeRawKey: false` discrepancy is documented here (not a P-gap — same security outcome achieved via default hashing).

---

## Artifacts

- Implementation commit: `e529a6e` on `story/AUTH-001`
- `@better-auth/api-key` 1.x installed and pinned in `package.json`
- `@types/pg` and `@types/better-sqlite3` installed as devDependencies
