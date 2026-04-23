---
name: fastify-route-convention
description: Standard shape of a Fastify route file — schema, handler, auth guard, rate limiter, template rendering — and the service-layer boundary that keeps business logic out of handlers.
trigger: writing any new Fastify route, adding a new module directory, writing a new handler
source: ~/Sites/ai_guidance/frameworks/fastify/conventions.md §Plugin Architecture, §Service Layer, §Error Handling, §HTMX + View Integration, §Rate Limiting; docs/planning/architecture.md §Backend
---

## Rule

Every route file is a Fastify plugin that declares its schema (Zod), delegates business logic to a service class, guards itself with `preHandler` for auth, applies per-route rate limits when needed, and uses `reply.page()` for the partial-vs-full-page response pattern.

## Why

Fastify's plugin encapsulation model separates concerns cleanly: the route handler owns request/response lifecycle; the service owns business logic; the schema owns validation and types. This structure is directly specified in `fastify/conventions.md §Plugin Architecture` and `§Service Layer`. Mixing business logic into route handlers makes testing hard (must mock HTTP) and makes services non-reusable.

## How to apply

1. **File layout per module:**
   ```
   src/modules/<feature>/
   ├── routes.ts    — Fastify plugin; imports schema and service
   ├── schemas.ts   — Zod schemas and derived types (see zod-schema-first.md)
   └── service.ts   — Business logic; receives EntityManager, not fastify/request
   ```

2. **Route plugin template:**
   - Export a `FastifyPluginAsyncZod` (from `@fastify/type-provider-zod`)
   - Do NOT wrap with `fastify-plugin` (feature routes stay encapsulated)
   - Declare `schema:` on every route
   - Call `service.method(request.em, params)` — never access the DB directly in the handler
   - Use `reply.page(templateName, data)` for HTML routes (returns partial for HTMX, full layout otherwise)

3. **Auth guard:** Routes that need authentication rely on the global `preHandler` hook (registered in `src/app.ts`). To opt out of auth (e.g. `/health`, `/setup`, `/api/auth/*`), add `config: { skipAuth: true }` to the route options.

4. **Per-route rate limits:** Add `config: { rateLimit: { max: N, timeWindow: T } }` overrides only where the default 600/min is too permissive. See `rate-limiting-mixed-backends.md` for the canonical limits table.

5. **Error handling:** The global error handler (set in `app.ts`) returns an HTMX-swappable fragment for browser/HTMX requests and JSON for API requests. Throw `fastify.httpErrors.badRequest('...')` or similar — do not call `reply.send()` for errors inside handlers.

6. **SSE routes** follow the full lifecycle pattern in `fastify/conventions.md §SSE Route Lifecycle` — authenticate, enforce per-user and per-org limits, register, keepalive, max-age, cleanup on disconnect.

## Good example

```typescript
// src/modules/runs/routes.ts
import { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { RunFilterSchema } from './schemas';
import { RunsService } from './service';

const plugin: FastifyPluginAsyncZod = async (fastify) => {
  const service = new RunsService();

  // HTML route — returns partial for HTMX, full page for direct navigation
  fastify.get('/projects/:slug/runs', {
    schema: {
      params:      z.object({ slug: z.string() }),
      querystring: RunFilterSchema,
    },
  }, async (request, reply) => {
    const runs = await service.list(request.em, {
      slug: request.params.slug,
      ...request.query,
    });
    return reply.page('run-list', { runs });  // partial or full layout
  });

  // API route — returns JSON
  fastify.post('/api/v1/projects/:slug/runs', {
    config: { rateLimit: {
      keyGenerator: (req) => (req.headers['x-api-token'] as string) ?? req.ip,
      max: async (req) => {
        const token = await service.resolveToken(req);
        return token?.rate_limit_per_hour ?? 120;
      },
      timeWindow: 3_600_000,
    }},
    schema: {
      params:   z.object({ slug: z.string() }),
      body:     CtrfReportSchema,
      response: { 201: z.object({ runId: z.string() }) },
    },
  }, async (request, reply) => {
    const run = await service.ingest(request.em, request.params.slug, request.body);
    return reply.status(201).send({ runId: run.id.toString() });
  });
};

export default plugin;
```

## Bad example

```typescript
// ❌ Business logic in the route handler — not testable without HTTP
fastify.post('/api/v1/projects/:slug/runs', async (request, reply) => {
  const project = await request.em.findOne(Project, { slug: request.params.slug });
  if (!project) throw fastify.httpErrors.notFound();
  const run = request.em.create(TestRun, { ... });  // DB logic in handler
  await request.em.flush();
  return reply.status(201).send({ runId: run.id });
});
// To unit-test this, you must spin up a full Fastify server.
// Put DB logic in RunsService; test RunsService directly.
```
