---
name: better-auth-session-and-api-tokens
description: How browser session auth and project-scoped CI API tokens coexist in the global preHandler hook; the /setup bootstrap wizard flow; what skipAuth means and when to use it.
trigger: writing any authenticated route; generating API tokens; writing the /setup wizard; configuring the auth plugin
source: docs/planning/product.md §Feature 0 (Setup Wizard), §Feature 5 (Auth), §Acceptance criteria; docs/planning/architecture.md §CSRF protection; ~/Sites/ai_guidance/frameworks/better-auth/conventions.md §Global Route Protection, §API Keys for CI Ingestion
---

## Rule

All routes are authenticated by default via a global `preHandler` hook that checks (1) `x-api-token: <ctrf_*>` for CI clients, then (2) the Better Auth session cookie for browser users; routes opt out with `config: { skipAuth: true }`; the `/setup` wizard is the only unauthenticated path to account creation; raw API tokens are shown exactly once and never logged.

## Why

CTRFHub has two distinct auth surfaces: browser users (QA leads, developers) using session cookies, and CI pipelines using project-scoped API tokens in the `x-api-token` header. Both must be handled in the same middleware layer so any route can serve either client.

The custom header (rather than `Authorization: Bearer`) is the convention specified by `product.md §Feature 5 Acceptance criteria` and used consistently across `architecture.md`, `testing-strategy.md`, `database-design.md`, `tasks.md`, and `skills/ctrf-ingest-validation.md`. The Better Auth `apiKey` plugin reads from a configurable header — pass `header: 'x-api-token'` (or whatever the plugin's option is named at the version we pin) so its built-in `verifyApiKey()` looks at the right place.

The `/setup` wizard occupies a special position: on a fresh instance (empty `users` table), ALL non-`/setup` routes redirect to `/setup` — this is the only path to creating the bootstrap admin account. Once a user exists, `/setup` returns `410 Gone` permanently (spec: `product.md §Feature 0 Acceptance criteria`).

CSRF protection is by design absent: Better Auth issues `SameSite=Lax` cookies; HTMX uses XHR/fetch; browsers enforce `SameSite=Lax` on cross-origin XHR so the session cookie is not sent from `evil.com`. Do not add explicit CSRF tokens — this would be redundant and complicates API key flows (per `architecture.md §CSRF protection`).

## How to apply

### Global preHandler (already wired in src/app.ts):

1. Check if `users` table is empty → redirect to `/setup` for all non-exempt routes.
2. Check `config.skipAuth` → skip auth for `/setup`, `/health`, `/api/auth/*`, static assets.
3. Check `x-api-token: ctrf_*` → validate with `auth.api.verifyApiKey()`.
4. Check Better Auth session cookie → validate with `auth.api.getSession()`.
5. If HTMX request and unauthenticated → set `HX-Redirect: /login` header + 200 (not 401) so HTMX consumes `HX-Redirect` cleanly without `hx-on::after-request` handling.
6. Otherwise → redirect to `/login`.

### Project-scoped API tokens:

- Created via `auth.api.createApiKey({ name, metadata: { projectId }, expiresIn })`.
- Shown plaintext **once** at creation; only the hash is stored (Better Auth `apiKey` plugin with `storeRawKey: false`).
- Validated on every ingest request via `auth.api.verifyApiKey()`.
- Scoped: a token for `project-slug-A` cannot ingest into `project-slug-B` — the route handler verifies the token's `metadata.projectId` matches the route param.
- Prefix: `ctrf_` (configured in `betterAuth({ plugins: [apiKey({ defaultPrefix: 'ctrf_' })] })`).

### Setup wizard:

- Steps 1–4 are defined in `product.md §Feature 0 Flow`.
- Each step commits immediately (crash-resumable).
- Once `users` count > 0, the route is `410 Gone` — no re-bootstrap.
- Env-var seed: if `CTRFHUB_INITIAL_ADMIN_EMAIL` + `CTRFHUB_INITIAL_ADMIN_PASSWORD` + `CTRFHUB_INITIAL_ORG_NAME` are set at boot AND `users` is empty, the migration routine creates user + org in a single transaction; wizard never shown.

### Routes to always mark skipAuth:

```
/setup           — unauthenticated bootstrap
/health          — readiness probe
/api/auth/*      — Better Auth handler (handles its own auth)
/login           — login form
/forgot-password — password reset form (when SMTP configured)
/reset-password  — token-based reset
```

## Good example

```typescript
// src/modules/auth/routes.ts — delegates to Better Auth handler
fastify.route({
  method: ['GET', 'POST', 'PUT', 'DELETE'],
  url: '/api/auth/*',
  config: { skipAuth: true },   // ✅ Better Auth owns this route's auth
  async handler(request, reply) {
    const webRequest = new Request(/* ... */);
    const response = await auth.handler(webRequest);
    // forward status, headers, body
  },
});

// src/modules/ingest/routes.ts — CI token auth via global preHandler
fastify.post('/api/v1/projects/:slug/runs', {
  // No skipAuth — global preHandler validates the x-api-token header
  // The handler can read request.apiKeyUser for the token's metadata
  schema: { params: z.object({ slug: z.string() }), body: CtrfReportSchema, ... },
}, async (request, reply) => {
  const tokenProjectId = request.apiKeyUser?.metadata?.projectId;
  const project = await projectService.findBySlug(request.em, request.params.slug);
  if (tokenProjectId !== project.id.toString()) {
    return reply.status(403).send({ error: 'Token not authorized for this project' });
  }
  // ... ingest
});
```

## Bad example

```typescript
// ❌ Implementing auth check inside the handler — duplicates global middleware
fastify.post('/api/v1/projects/:slug/runs', async (request, reply) => {
  const apiToken = request.headers['x-api-token'];
  if (!apiToken) return reply.status(401).send({ error: 'Unauthorized' });
  // This is already handled by the global preHandler — don't repeat it
});

// ❌ Logging the raw API token
fastify.log.info({ token: request.headers['x-api-token'] }, 'Ingest request');
// API token values must NEVER appear in logs — log only the prefix or token ID
```
