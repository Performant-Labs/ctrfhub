# Better Auth Conventions

> Sources: [Better Auth Docs](https://www.better-auth.com/docs), [Fastify Integration](https://www.better-auth.com/docs/integrations/fastify), [API Keys Plugin](https://www.better-auth.com/docs/plugins/api-key)

---

## Core Principles

- Better Auth handles all session/cookie management and API key lifecycle.
- Fastify delegates all `/api/auth/*` routes to the Better Auth handler — never reimplement auth logic.
- API tokens for CI pipelines use the `apiKey` plugin, not session cookies.
- Routes protect themselves via a Fastify `preHandler` hook.

---

## Auth Instance (`src/auth.ts`)

```typescript
import { betterAuth } from 'better-auth';
import { apiKey } from 'better-auth/plugins';

export const auth = betterAuth({
  secret:  process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  database: mikroOrmAdapter(orm),
  emailAndPassword: { enabled: true },
  plugins: [
    apiKey({
      defaultPrefix: 'ctrf_',
      storeRawKey: false,   // store only hash — never the raw key after creation
    }),
  ],
});
```

Generate database schema after configuring:

```bash
npx better-auth generate --config src/auth.ts
```

---

## Fastify Route Handler

```typescript
// src/modules/auth/routes.ts
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../../auth';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.route({
    method: ['GET', 'POST', 'PUT', 'DELETE'],
    url: '/api/auth/*',
    config: { skipAuth: true },
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const webRequest = new Request(url.toString(), {
        method:  request.method,
        headers: fromNodeHeaders(request.headers),
        body:    ['GET', 'HEAD'].includes(request.method)
                   ? undefined
                   : JSON.stringify(request.body),
      });
      const response = await auth.handler(webRequest);
      reply.status(response.status);
      response.headers.forEach((v, k) => reply.header(k, v));
      return reply.send(response.body ? await response.text() : null);
    },
  });
};
```

---

## Global Route Protection

Add a `preHandler` hook on the root app. Routes opt out with `config: { skipAuth: true }`.

```typescript
app.addHook('preHandler', async (request, reply) => {
  if ((request.routeOptions.config as any)?.skipAuth) return;

  // 1. API key (CI clients)
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const result = await auth.api.verifyApiKey({
      headers: fromNodeHeaders(request.headers),
    });
    if (result?.valid) { request.apiKeyUser = result; return; }
    return reply.status(401).send({ error: 'Invalid API key' });
  }

  // 2. Session (browser users)
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (session) { request.session = session; return; }

  // 3. HTMX: redirect to login fragment
  if (request.headers['hx-request']) {
    reply.header('HX-Redirect', '/login');
    return reply.status(401).send();
  }

  return reply.redirect('/login');
});
```

---

## API Keys for CI Ingestion

CI pipelines send `Authorization: Bearer ctrf_abc123...` — no browser session needed.

```bash
# From a GitHub Actions workflow
curl -X POST https://ctrfhub.example.com/api/ingest \
  -H "Authorization: Bearer ctrf_abc123..." \
  -H "Content-Type: application/json" \
  -d @ctrf-report.json
```

Generate a key server-side (triggered from the UI):

```typescript
const { key } = await auth.api.createApiKey({
  name:      'GitHub Actions — my-repo',
  metadata:  { projectId: '42' },
  expiresIn: 60 * 60 * 24 * 365,  // 1 year
});
// Show `key` once — only the hash is stored.
```

---

## Roles: Admin vs Viewer

```typescript
function requireRole(role: 'admin' | 'viewer') {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const userRole = request.session?.user?.role
                  ?? request.apiKeyUser?.metadata?.role;
    if (userRole !== role) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }
  };
}

// Usage
fastify.post('/api/projects', { preHandler: [requireRole('admin')] }, handler);
```

---

## Security Rules

| Rule | Detail |
|---|---|
| Never log raw API keys | Log only the key ID or prefix (`ctrf_abc...`) |
| Store only the hash | `storeRawKey: false` in plugin config |
| Expose revoke + regenerate UI | Allow users to rotate compromised keys |
| HTTPS required | Bearer tokens in headers are plaintext |
| Rate limit `/api/ingest` | Use `@fastify/rate-limit` keyed on the API key hash |

---

## Common Gotchas

| Symptom | Cause | Fix |
|---|---|---|
| 401 on valid session | Session cookie not sent correctly | Check `baseURL` and `sameSite` cookie policy |
| `fromNodeHeaders` not found | Wrong import path | `import { fromNodeHeaders } from 'better-auth/node'` |
| Auth routes return 404 | Catch-all not registered early enough | Register auth routes before other modules in `buildApp` |
| CLI `generate` produces nothing | Syntax error in `auth.ts` | Must have a valid named/default `auth` export |
