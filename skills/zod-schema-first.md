---
name: zod-schema-first
description: Zod is the single source of truth for runtime validation and TypeScript types; schemas are defined per-module and consumed by both routes and services.
trigger: adding a new API route, adding a new request body, adding a new query parameter, writing a Fastify route handler
source: docs/planning/architecture.md §Backend (Zod row); ~/Sites/ai_guidance/frameworks/fastify/conventions.md §Core Principles, §Schemas
---

## Rule

Every route's request shape (body, querystring, params, response) is defined as a Zod schema in the module's `schemas.ts` file before the route handler is written; TypeScript types are derived from those schemas with `z.infer<>`; no hand-written TypeScript interfaces duplicate what a Zod schema already defines.

## Why

CTRFHub uses `@fastify/type-provider-zod` to make Zod schemas the authoritative source of runtime validation AND TypeScript type information. This eliminates three common bugs: (1) TypeScript types and runtime validation drifting apart, (2) forgetting to validate a request field, (3) OpenAPI docs becoming stale. The `architecture.md §Backend` row for Zod reads: "single source of truth for runtime validation and TypeScript types."

## How to apply

1. **Create `schemas.ts` in the module directory first**, before `routes.ts` or `service.ts`.
2. Define every Zod schema the module needs: request body schemas, querystring schemas, response schemas.
3. Export TypeScript types derived with `z.infer<>` — no separate `interface` or `type` declaration that duplicates the Zod shape.
4. Import schemas into `routes.ts` and pass them to the Fastify route's `schema:` option.
5. Import the same schemas (or their derived types) into `service.ts` — the service accepts typed parameters that come from the validated request.
6. Set up `ZodTypeProvider` and both compilers in `src/app.ts` before any routes are registered (one-time setup; already wired in the app factory).
7. For CTRF ingestion specifically: the CTRF JSON schema lives in `src/modules/ingest/schemas.ts` and is the canonical definition. Do not define CTRF shapes elsewhere.

## Good example

```typescript
// src/modules/runs/schemas.ts
import { z } from 'zod';

export const RunFilterSchema = z.object({
  projectSlug: z.string(),
  status:      z.enum(['passed', 'failed', 'mixed']).optional(),
  from:        z.string().datetime().optional(),
  to:          z.string().datetime().optional(),
  page:        z.coerce.number().min(1).default(1),
  limit:       z.coerce.number().min(1).max(100).default(20),
});

export type RunFilter = z.infer<typeof RunFilterSchema>;  // ✅ derived type, not a duplicate interface

export const RunResponseSchema = z.object({
  runId:   z.number(),
  status:  z.enum(['passed', 'failed', 'mixed']),
  total:   z.number(),
  passed:  z.number(),
  failed:  z.number(),
});

export type RunResponse = z.infer<typeof RunResponseSchema>;
```

```typescript
// src/modules/runs/routes.ts
import { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { RunFilterSchema, RunResponseSchema } from './schemas';
import { RunsService } from './service';

const plugin: FastifyPluginAsyncZod = async (fastify) => {
  const service = new RunsService();

  fastify.get('/projects/:projectSlug/runs', {
    schema: {
      params:      RunFilterSchema.pick({ projectSlug: true }),
      querystring: RunFilterSchema.omit({ projectSlug: true }),
      response:    { 200: z.array(RunResponseSchema) },
    },
  }, async (request, reply) => {
    const runs = await service.list(request.em, {
      ...request.params,
      ...request.query,
    });
    return runs;
  });
};
```

## Bad example

```typescript
// ❌ Hand-written TypeScript interface that duplicates a Zod schema
interface RunFilter {
  projectSlug: string;
  status?: 'passed' | 'failed' | 'mixed';  // duplicates z.enum — now two sources of truth
  page?: number;
}

// ❌ Inline schema in route — not reusable by service or tests
fastify.get('/runs', {
  schema: {
    querystring: { type: 'object', properties: { page: { type: 'number' } } }  // JSON Schema, not Zod
  }
}, handler);
```

Why it's wrong: hand-written interfaces drift from runtime validation; JSON Schema isn't Zod and loses TypeScript inference.
