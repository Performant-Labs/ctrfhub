# Fastify + TypeScript + Zod Conventions

> Sources: [Fastify Docs](https://fastify.dev/docs/latest/), [@fastify/type-provider-zod](https://github.com/fastify/fastify-type-provider-zod), [Fastify Plugin Guide](https://fastify.dev/docs/latest/Reference/Plugins/)

---

## Core Principles

- **Schema-first**: Zod schemas are the single source of truth for validation, TypeScript types, and OpenAPI docs.
- **Plugin encapsulation**: Every feature is a Fastify plugin. No global state.
- **Service layer**: Business logic never lives in route handlers — only in service classes.
- **`fastify.inject()` for tests**: No real HTTP server needed in tests.

---

## Project Structure

```
src/
├── app.ts                  # App factory (creates + configures Fastify instance)
├── index.ts                # Entry point (calls app.ts, starts listening)
├── plugins/                # Global plugins registered on root instance
│   ├── orm.ts              # MikroORM plugin (decorates fastify.orm)
│   ├── auth.ts             # Better Auth plugin
│   ├── view.ts             # @fastify/view + Eta registration
│   └── static.ts           # @fastify/static for assets
├── modules/                # Feature-based modules
│   ├── ingest/
│   │   ├── routes.ts
│   │   ├── schemas.ts      # Zod schemas for this module
│   │   └── service.ts
│   ├── runs/
│   │   ├── routes.ts
│   │   ├── schemas.ts
│   │   └── service.ts
│   └── auth/
│       └── routes.ts       # Delegates to Better Auth handler
├── client/
│   └── htmx-events.ts      # HTMX event name constants (see HTMX guide)
└── entities/               # MikroORM entity definitions
```

---

## App Initialization

Always use the `ZodTypeProvider` and configure both compilers before registering any routes.

```typescript
// src/app.ts
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from '@fastify/type-provider-zod';

export async function buildApp() {
  const app = Fastify({ logger: true })
    .withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register global plugins first
  await app.register(import('./plugins/orm'));
  await app.register(import('./plugins/auth'));
  await app.register(import('./plugins/view'));

  // Register feature modules
  await app.register(import('./modules/ingest/routes'), { prefix: '/api' });
  await app.register(import('./modules/runs/routes'));

  return app;
}
```

---

## Plugin Architecture

### Global plugins — use `fastify-plugin`

Plugins that add decorators or hooks that must be visible across all encapsulated scopes need `fastify-plugin` to break encapsulation.

```typescript
// src/plugins/orm.ts
import fp from 'fastify-plugin';
import { MikroORM } from '@mikro-orm/core';
import config from '../mikro-orm.config';

export default fp(async (fastify) => {
  const orm = await MikroORM.init(config);
  fastify.decorate('orm', orm);

  // Fork EntityManager per request
  fastify.addHook('onRequest', async (request) => {
    request.em = orm.em.fork();
  });

  fastify.addHook('onClose', async () => {
    await orm.close();
  });
});

// Augment Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    orm: MikroORM;
  }
  interface FastifyRequest {
    em: EntityManager;
  }
}
```

### Feature modules — standard plugins (with encapsulation)

Feature routes do NOT use `fastify-plugin`. They stay encapsulated.

```typescript
// src/modules/ingest/routes.ts
import { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { IngestService } from './service';

const plugin: FastifyPluginAsyncZod = async (fastify) => {
  const service = new IngestService();

  fastify.post('/ingest', {
    schema: {
      body: z.object({
        results: z.object({
          tool: z.object({ name: z.string() }),
          summary: z.object({
            tests: z.number(),
            passed: z.number(),
            failed: z.number(),
          }),
          tests: z.array(z.object({
            name: z.string(),
            status: z.enum(['passed', 'failed', 'skipped', 'pending', 'other']),
            duration: z.number(),
          })),
        }),
      }),
      response: {
        201: z.object({ runId: z.string() }),
      },
    },
  }, async (request, reply) => {
    const run = await service.ingest(request.em, request.body);
    return reply.status(201).send({ runId: run.id.toString() });
  });
};

export default plugin;
```

---

## Schemas

Keep Zod schemas in a dedicated `schemas.ts` per module. Import them into both routes and services.

```typescript
// src/modules/runs/schemas.ts
import { z } from 'zod';

export const RunFilterSchema = z.object({
  projectId: z.string().optional(),
  status:    z.enum(['passed', 'failed', 'mixed']).optional(),
  from:      z.string().datetime().optional(),
  to:        z.string().datetime().optional(),
  page:      z.coerce.number().min(1).default(1),
  limit:     z.coerce.number().min(1).max(100).default(20),
});

export type RunFilter = z.infer<typeof RunFilterSchema>;
```

---

## Service Layer

Business logic lives in service classes. Services receive `EntityManager` as a parameter — they do not import `fastify` or access `request`.

```typescript
// src/modules/ingest/service.ts
import type { EntityManager } from '@mikro-orm/core';
import { TestRun } from '../../entities/TestRun';

export class IngestService {
  async ingest(em: EntityManager, body: CtrfReport): Promise<TestRun> {
    const run = em.create(TestRun, {
      tool: body.results.tool.name,
      passed: body.results.summary.passed,
      failed: body.results.summary.failed,
      total:  body.results.summary.tests,
    });
    await em.flush();
    return run;
  }
}
```

> **Rule**: If a method needs `fastify`, `request`, or `reply`, it belongs in the route handler, not the service.

---

## Error Handling

Set a global error handler. Return HTML for browser requests, JSON for API requests.

```typescript
app.setErrorHandler(async (error, request, reply) => {
  const isHtmx = request.headers['hx-request'] === 'true';
  const isApi  = request.url.startsWith('/api/');

  if (isApi || !isHtmx) {
    return reply.status(error.statusCode ?? 500).send({
      error: error.message,
    });
  }

  // Return an HTMX-swappable error fragment
  return reply.status(error.statusCode ?? 500).view('partials/error.eta', {
    message: error.message,
  });
});
```

---

## HTMX + View Integration

Register `@fastify/view` with Eta as a global plugin. Add a `reply.fragment()` decorator for the common partial-vs-full-page pattern.

```typescript
// src/plugins/view.ts
import fp from 'fastify-plugin';
import view from '@fastify/view';
import { Eta } from 'eta';
import path from 'node:path';

export default fp(async (fastify) => {
  const eta = new Eta({ views: path.join(import.meta.dirname, '../views') });

  await fastify.register(view, { engine: { eta } });

  // Convenience: render partial when HX-Request, full layout otherwise
  fastify.decorateReply('page', async function (template: string, data?: object) {
    const isHtmx = this.request.headers['hx-request'] === 'true';
    if (isHtmx) {
      return this.view(`partials/${template}`, data);
    }
    return this.view('layouts/main.eta', { body: template, ...data });
  });
});
```

Usage in routes:

```typescript
fastify.get('/runs', async (request, reply) => {
  const runs = await service.list(request.em, query);
  return reply.page('run-list', { runs });
});
```

---

## Testing

Use `fastify.inject()` — no real server or HTTP needed.

```typescript
import { buildApp } from '../src/app';

describe('POST /api/ingest', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('returns 201 with runId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { results: { /* valid CTRF */ } },
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toHaveProperty('runId');
  });
});
```

---

## Common Gotchas

| Symptom | Cause | Fix |
|---|---|---|
| Decorator not found in route | Plugin registered with `fastify-plugin` but scope is wrong | Ensure global plugins use `fp()` wrapper |
| TypeScript doesn't infer body type | Forgot `withTypeProvider<ZodTypeProvider>()` on app creation | Add it before any routes |
| Schema validation not running | `validatorCompiler` / `serializerCompiler` not set | Set both immediately after `Fastify()` call |
| `request.em` undefined | ORM plugin not registered before route plugins | Register `plugins/orm` before any module plugins |
| ESM import errors | `import()` dynamic vs static | Use `await app.register(import('./module'))` pattern |
