/**
 * CTRFHub — Fastify App Factory.
 *
 * `buildApp(options?)` is the single entry point for constructing the
 * Fastify server instance. It wires up:
 *
 * - ZodTypeProvider (runtime validation + TS types from Zod schemas)
 * - Better Auth (session cookies + API-key validation via global preHandler)
 * - @fastify/helmet (CSP, HSTS, X-Content-Type-Options, COOP)
 * - @fastify/rate-limit (global 600/min default)
 * - @fastify/static (serves compiled Tailwind CSS from src/assets/)
 * - @fastify/view (Eta template engine, root src/views/)
 * - Global auth preHandler hook (skeleton — real logic in AUTH-001)
 * - GET /health (readiness probe — 200 when ready; the process is not
 *   listening before schema sync completes, so early-boot probes see
 *   connection-refused rather than 503)
 * - MikroORM lifecycle (init, per-request em fork, shutdown)
 * - Schema sync at boot (schema-generator, not migrator — INFRA-005)
 * - Graceful shutdown (SIGTERM/SIGINT → close sequence)
 *
 * The four optional DI seams in `AppOptions` allow integration tests
 * to inject in-memory doubles without mocking.
 *
 * @see skills/fastify-route-convention.md
 * @see skills/zod-schema-first.md
 * @see skills/better-auth-session-and-api-tokens.md
 * @see docs/planning/architecture.md §Backend, §CSP, §Graceful Shutdown
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from '@fastify/type-provider-zod';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import { Eta } from 'eta';
import { MikroORM } from '@mikro-orm/core';
import { fromNodeHeaders } from 'better-auth/node';

import fastifyMultipart from '@fastify/multipart';
import type { AppOptions } from './types.js';
import type { BootState } from './modules/health/schemas.js';
import { HealthResponseSchema } from './modules/health/schemas.js';
import { buildAuth } from './auth.js';
import { User } from './entities/index.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import ingestPlugin from './modules/ingest/routes.js';
import { MemoryEventBus } from './services/event-bus.js';
import { createAiProvider } from './services/ai/index.js';
import { LocalArtifactStorage } from './lib/local-artifact-storage.js';
import { wireAiPipeline } from './services/ai/pipeline/index.js';

// ---------------------------------------------------------------------------
// Module-private: resolve __dirname for ESM (needed by @fastify/static root)
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Fastify type augmentation — extend FastifyContextConfig with skipAuth
// ---------------------------------------------------------------------------

/**
 * Augment Fastify's route config to support the `skipAuth` flag.
 * Routes marked `config: { skipAuth: true }` bypass the global auth
 * preHandler. This is the pattern from `better-auth-session-and-api-tokens.md`.
 */
declare module 'fastify' {
  interface FastifyContextConfig {
    skipAuth?: boolean;
  }
  interface FastifyRequest {
    /**
     * Per-request MikroORM EntityManager fork.
     * Set by the `onRequest` hook — never use `fastify.orm.em` directly.
     * @see skills/mikroorm-dual-dialect.md
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    em: any; // typed as `any` here; downstream handlers use the concrete fork type
  }
  interface FastifyReply {
    /**
     * Render an Eta template with partial-vs-full-page branching.
     *
     * - When `HX-Request: true` header is present, renders `partials/{template}.eta`
     *   (an HTMX swap fragment).
     * - Otherwise renders `layouts/main.eta` with `{ body: template, ...data }`,
     *   which in turn includes `pages/{template}.eta`.
     *
     * @param template - Template name (without `.eta` extension or directory prefix).
     * @param data     - Template locals (available as `it` inside Eta templates).
     *
     * @see skills/eta-htmx-partial-rendering.md
     */
    page(template: string, data?: Record<string, unknown>): ReturnType<FastifyReply['view']>;
  }
}

// ---------------------------------------------------------------------------
// CSP policy — verbatim from architecture.md §CSP (main-app CSP)
// ---------------------------------------------------------------------------

/**
 * Content Security Policy directives copied verbatim from
 * `docs/planning/architecture.md §Content Security Policy (CSP)`.
 *
 * Do NOT invent values not in the architecture doc. If a directive
 * seems missing, flag it in `docs/planning/gaps.md`.
 */
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  frameSrc: [
    "'self'",
    'trace.playwright.dev',
    'loom.com',
    'www.loom.com',
    'youtube.com',
    'www.youtube.com',
    'youtube-nocookie.com',
    'vimeo.com',
    'player.vimeo.com',
  ],
  imgSrc: ["'self'", 'data:'],
  mediaSrc: ["'self'"],
  connectSrc: ["'self'"],
} as const;

// ---------------------------------------------------------------------------
// App Factory
// ---------------------------------------------------------------------------

/**
 * Build and configure the Fastify application instance.
 *
 * @param options - DI seams for testing and deployment variants.
 *   - `testing: true` suppresses startup logging and process signal handlers.
 *   - `db: ':memory:'` uses in-memory SQLite (integration tests).
 *   - `artifactStorage`, `eventBus`, `aiProvider` inject test doubles.
 *
 * @returns A fully configured Fastify instance (not yet listening).
 *
 * @example
 * ```typescript
 * // Production / dev bootstrap
 * const app = await buildApp();
 * await app.listen({ port: 3000, host: '0.0.0.0' });
 *
 * // Integration test bootstrap
 * const app = await buildApp({ testing: true, db: ':memory:' });
 * const res = await app.inject({ method: 'GET', url: '/health' });
 * ```
 */
export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const { testing = false } = options;

  // -----------------------------------------------------------------------
  // 0. Better Auth instance
  // -----------------------------------------------------------------------
  // Build early so the preHandler (step 9) and auth route (step 10b) can
  // close over it. `options.db` is forwarded so integration tests that pass
  // `db: ':memory:'` get a matching in-memory Better Auth database.
  const auth = await buildAuth(options.db);

  // -----------------------------------------------------------------------
  // 1. Fastify instance with ZodTypeProvider
  // -----------------------------------------------------------------------
  const app = Fastify({
    logger: !testing,
  }).withTypeProvider<ZodTypeProvider>();

  // Wire Zod compilers — required before any route with `schema:` is registered
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // -----------------------------------------------------------------------
  // 2. Boot state management
  // -----------------------------------------------------------------------

  /** Current boot lifecycle phase: booting → syncing → ready */
  let currentBootState: BootState = 'booting';

  /**
   * Decorated getter for the current boot state.
   * Used by `/health` to decide 503 vs 200.
   */
  app.decorate('getBootState', () => currentBootState);

  /**
   * Decorated setter for the boot state — called by the schema-sync
   * sequence and the main bootstrap.
   */
  app.decorate('setBootState', (state: BootState) => {
    currentBootState = state;
  });

  // -----------------------------------------------------------------------
  // 3. @fastify/helmet — CSP + security headers
  // -----------------------------------------------------------------------
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: CSP_DIRECTIVES,
    },
    // Cross-Origin-Opener-Policy: same-origin (DD-028 I7)
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    // HSTS — let reverse proxy handle in production, but set a default
    hsts: true,
  });

  // -----------------------------------------------------------------------
  // 4. @fastify/rate-limit — global default 600/min
  // -----------------------------------------------------------------------
  await app.register(fastifyRateLimit, {
    max: 600,
    timeWindow: '1 minute',
  });

  // -----------------------------------------------------------------------
  // 5. @fastify/static — serve compiled assets (Tailwind CSS output)
  // -----------------------------------------------------------------------
  await app.register(fastifyStatic, {
    root: path.join(__dirname, 'assets'),
    prefix: '/assets/',
    // Don't decorate reply with sendFile twice if another static plugin is registered
    decorateReply: true,
  });

  // -----------------------------------------------------------------------
  // 6. @fastify/view — Eta template engine
  // -----------------------------------------------------------------------
  const eta = new Eta({
    views: path.join(__dirname, 'views'),
    // Cache templates in production for performance
    cache: process.env['NODE_ENV'] === 'production',
  });

  await app.register(fastifyView, {
    engine: { eta },
    root: path.join(__dirname, 'views'),
    viewExt: 'eta',
  });

  /**
   * `reply.page()` — partial-vs-full-page branching decorator.
   *
   * Routes that return HTML must use `reply.page(template, data)` instead of
   * `reply.view()`. The decorator detects the `HX-Request` header:
   *
   * - **HTMX request** (`HX-Request: true`) → renders `partials/{template}.eta`
   *   as a swap-ready HTML fragment (no `<html>`, `<head>`, or layout chrome).
   * - **Direct navigation** (no `HX-Request`) → renders `layouts/main.eta` with
   *   `{ body: template, ...data }`. The layout in turn includes
   *   `pages/{template}.eta` via `includeAsync`.
   *
   * @see skills/eta-htmx-partial-rendering.md
   * @see skills/fastify-route-convention.md §HTMX + View Integration
   */
  app.decorateReply('page', function (this: FastifyReply, template: string, data: Record<string, unknown> = {}) {
    const isHxRequest = this.request.headers['hx-request'] === 'true';
    if (isHxRequest) {
      return this.view(`partials/${template}`, data);
    }
    return this.view('layouts/main', { body: template, ...data }, { async: true } as any);
  });

  // -----------------------------------------------------------------------
  // 6b. GET / — home page
  // -----------------------------------------------------------------------

  /**
   * Landing page — renders `pages/home.eta` inside the main layout.
   *
   * Uses `reply.page()` for HTMX partial-vs-full-page branching:
   *   - Direct navigation → full layout with `layouts/main.eta`
   *   - HTMX request → `partials/home.eta` fragment
   */
  app.get('/', {
    schema: {},
  }, async (_request, reply) => reply.page('home'));

  // -----------------------------------------------------------------------
  // 7. MikroORM lifecycle — init, per-request em fork, shutdown
  // -----------------------------------------------------------------------
  let orm: MikroORM;

  if (options.db !== undefined) {
    // Explicit DB path provided (typically ':memory:' for integration tests).
    // Reuse the production SQLite config (entities, schemaGenerator, skipTables)
    // and override only the dbName — required so `em.count(User)` in the
    // global preHandler resolves against a real entity registration.
    const { default: sqliteConfig } = await import('./mikro-orm.config.sqlite.js');
    orm = await MikroORM.init({
      ...sqliteConfig,
      dbName: options.db,
      debug: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  } else {
    // Resolve from environment — uses the runtime dialect selector.
    // The config may be PG or SQLite typed — MikroORM.init() accepts the
    // base Options type, so we cast through `any` to avoid the union
    // type incompatibility between PostgreSqlDriver and SqliteDriver.
    const { resolveOrmConfig } = await import('./mikro-orm.config.js');
    const config = await resolveOrmConfig();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orm = await MikroORM.init(config as any);
  }

  // Decorate the app instance with the ORM (for shutdown and direct access)
  app.decorate('orm', orm);

  /**
   * Per-request EntityManager fork.
   *
   * Every request gets its own EM fork — never use `fastify.orm.em` directly
   * in route handlers. This ensures request-scoped identity maps and
   * prevents cross-request entity state leakage.
   *
   * @see skills/mikroorm-dual-dialect.md — "request.em must always be forked"
   */
  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { em: ReturnType<typeof orm.em.fork> }).em = orm.em.fork();
  });

  // Run schema-generator to sync DDL (transition boot state).
  // `update()` is idempotent: safe on fresh DB and existing DB.
  // It creates missing tables and alters existing ones to match entity
  // definitions, respecting `skipTables` for Better Auth-managed tables.
  // INFRA-005: replaces `orm.migrator.up()` — no migration files exist.
  currentBootState = 'migrating';
  try {
    await orm.schema.update();
  } catch (err) {
    // Schema sync failure is fatal — log and let the process crash
    app.log.error({ err }, 'Schema sync failed — process will exit');
    throw err;
  }

  // Run Better Auth schema migrations (user, session, account, verification,
  // apikey tables). `runMigrations()` is idempotent — safe to call on every
  // startup; a no-op when tables already exist.
  // This is the production path that mirrors what `seedAuthSchema()` does in
  // integration tests, hoisted here so a fresh DB Just Works.
  try {
    const authCtx = await auth.$context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (authCtx as any).runMigrations();
  } catch (err) {
    app.log.error({ err }, 'Better Auth migration failed — process will exit');
    throw err;
  }
  currentBootState = 'ready';

  // -----------------------------------------------------------------------
  // 8. DI seams — instantiate and decorate (shutdown is consolidated below)
  // -----------------------------------------------------------------------

  // EventBus — always present. Tests inject via `options.eventBus`;
  // production/dev falls back to an in-process MemoryEventBus.
  const eventBus = options.eventBus ?? new MemoryEventBus();
  app.decorate('eventBus', eventBus);

  const artifactStorage = options.artifactStorage ?? (testing ? undefined : new LocalArtifactStorage());
  if (artifactStorage) {
    app.decorate('artifactStorage', artifactStorage);
  }

  // AiProvider — injected by tests via `options.aiProvider`; in production
  // constructed from env vars when `AI_PROVIDER` is set. Undefined when AI
  // is not configured (features silently disabled — no nagging).
  const aiProvider = options.aiProvider ?? (
    testing || !process.env['AI_PROVIDER']
      ? undefined
      : createAiProvider()
  );

  // ── AI pipeline wiring (boot-recovery + 3 subscribers + sweeper) ──
  // The wireAiPipeline() function in `src/services/ai/pipeline/wire.ts`
  // encapsulates the pipeline's composition; the composition root only
  // sees a single function call here and gets back a `stopSweeper`
  // handle to sequence shutdown below. When aiProvider is undefined
  // (no AI configured), the pipeline stays dormant.
  // @see src/services/ai/pipeline/wire.ts
  let stopSweeper: (() => void) | undefined;
  if (aiProvider) {
    app.decorate('aiProvider', aiProvider);
    const wired = await wireAiPipeline(app, { eventBus, aiProvider, orm });
    stopSweeper = wired.stopSweeper;
  }

  // -----------------------------------------------------------------------
  // 8b. Consolidated shutdown — one onClose, explicit forward order
  // -----------------------------------------------------------------------
  //
  // Teardown order is dependency-correct AS WRITTEN — top-to-bottom is the
  // order things actually shut down. We deliberately consolidate into a
  // single onClose hook (rather than five hooks relying on Fastify's
  // undocumented LIFO contract) so a future maintainer reading this file
  // top-to-bottom can see the sequence at a glance.
  //
  // Order (per architecture.md §Production Deployment → Graceful shutdown):
  //   1. sweeper        — stop scheduling new AI work
  //   2. aiProvider     — drain in-flight LLM calls, release SDK clients
  //   3. artifactStorage — close file handles / S3 clients
  //   4. eventBus       — drain pending handlers
  //   5. orm            — close DB pool last (every other layer used it)
  //
  // Each step is wrapped so a failure in one teardown doesn't skip the
  // remainder — operationally the process is exiting either way.
  app.addHook('onClose', async () => {
    if (stopSweeper) {
      try {
        stopSweeper();
      } catch (err) {
        app.log.error({ err }, 'AI sweeper stop failed during shutdown');
      }
    }
    if (aiProvider) {
      try {
        await aiProvider.close();
      } catch (err) {
        app.log.error({ err }, 'AiProvider close failed during shutdown');
      }
    }
    if (artifactStorage) {
      try {
        await artifactStorage.close();
      } catch (err) {
        app.log.error({ err }, 'ArtifactStorage close failed during shutdown');
      }
    }
    try {
      await eventBus.close();
    } catch (err) {
      app.log.error({ err }, 'EventBus close failed during shutdown');
    }
    try {
      await orm.close();
    } catch (err) {
      app.log.error({ err }, 'ORM close failed during shutdown');
    }
  });

  // -----------------------------------------------------------------------
  // 9. Global auth preHandler — skeleton (real logic lands in AUTH-001)
  // -----------------------------------------------------------------------

  /**
   * Global auth preHandler hook.
   *
   * Precedence (per `better-auth-session-and-api-tokens.md`):
   *   1. Empty-users redirect to /setup
   *   2. skipAuth bypass
   *   3. `x-api-token` API key (ctrf_*) validation
   *   4. Session cookie validation
   *   5. HTMX 200 with HX-Redirect: /login
   *
   * In this story (INFRA-002), all branches are stubbed — the hook exists
   * so AUTH-001 only has to fill in the body of each branch, never
   * restructure the hook.
   */
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawPath = request.url.split('?')[0] ?? '';

    // ── Branch 0: Static assets bypass auth entirely ──
    // Static client assets (/assets/*) carry no session and no API token,
    // so they must be served before any auth branch runs — otherwise an
    // unauthenticated asset request falls through to Branch 5 and is
    // redirected to /login (yielding a 404 for the asset). @fastify/static
    // already returns a real 404 for genuinely missing files.
    if (rawPath.startsWith('/assets/')) {
      return;
    }

    // ── Branch 1: Empty-users redirect to /setup ──
    // If the users table is empty, the app has never been configured.
    // Redirect ALL requests to /setup except the explicit allow-list:
    //   /setup, /api/auth/*, /health, and static assets (/assets/*).
    // Browser clients get a 302 redirect; HTMX clients get HX-Redirect + 200.
    const isExemptFromEmptyCheck =
      rawPath === '/setup' ||
      rawPath.startsWith('/setup/') ||
      rawPath.startsWith('/api/auth/') ||
      rawPath === '/health' ||
      rawPath.startsWith('/assets/') ||
      // `/__test__/*` is a reserved namespace used only by `e2e/test-server.ts`
      // (no `src/` route registers under it). E2E test routes already carry
      // `config: { skipAuth: true }`, but Branch 2's skipAuth bypass runs
      // *after* this Branch 1 redirect, so without this exemption an E2E
      // request to /__test__/home gets 302→/setup→404 even though the test
      // server seeds a user at startup. Exempt the namespace so Branch 2's
      // skipAuth contract takes effect as documented.
      rawPath.startsWith('/__test__/');

    if (!isExemptFromEmptyCheck) {
      let userCount = 0;
      try {
        userCount = await request.em.count(User);
      } catch {
        // The `user` table may not exist yet if Better Auth's schema migration
        // hasn't been run (e.g. fresh install before `npx auth migrate`).
        // Treat as zero users — redirect to /setup so the wizard can run.
        userCount = 0;
      }
      if (userCount === 0) {
        if (request.headers['hx-request']) {
          // HTMX needs a 200 (not a redirect) with HX-Redirect to perform
          // a client-side full-page navigation to /setup.
          reply.header('HX-Redirect', '/setup');
          return reply.status(200).send();
        }
        return reply.redirect('/setup');
      }
    }

    // ── Branch 2: skipAuth bypass ──
    // Routes marked with `config: { skipAuth: true }` bypass auth entirely.
    const routeConfig = request.routeOptions?.config as { skipAuth?: boolean } | undefined;
    if (routeConfig?.skipAuth) {
      return;
    }

    // ── Branch 3: API key (`x-api-token` header) validation ──
    // CI pipelines send a `ctrf_*` key in the `x-api-token` header.
    // `auth.api.verifyApiKey({ body: { key } })` returns { valid, error, key }.
    // On success, attach the key metadata to `request.apiKeyUser`.
    //
    // SECURITY: Never log or echo the raw `x-api-token` value.
    // Log only presence (truthy/falsy), never the token string itself.
    const apiToken = request.headers['x-api-token'] as string | undefined;
    if (apiToken) {
      const result = await auth.api.verifyApiKey({ body: { key: apiToken } });
      if (result.valid && result.key) {
        // Attach the verified key's metadata so downstream handlers (e.g.
        // CTRF-002 ingest route) can read `request.apiKeyUser.metadata.projectId`.
        request.apiKeyUser = result.key as import('./auth.js').ApiKeyUser;
        return;
      }
      // Invalid key — do not fall through to session or HTMX-401.
      // Return 401 immediately to prevent timing attacks where an invalid
      // key would otherwise trigger a session lookup.
      return reply.status(401).send({ error: 'Invalid API key', code: 'INVALID_API_KEY' });
    }

    // ── Branch 4: Session cookie validation ──
    // Browser users have a Better Auth session cookie (SameSite=Lax).
    // `fromNodeHeaders` converts Fastify's Node.js headers to the Fetch API
    // `Headers` object that Better Auth expects.
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (session?.user) {
      request.user = session.user as import('./auth.js').SessionUser;
      return;
    }

    // ── Branch 5: Unauthenticated — HTMX 200 with HX-Redirect or browser redirect ──
    // No auth resolved. HTMX clients need a 200-with-HX-Redirect (NOT 401)
    // because HTMX only processes response headers on 2xx responses by default.
    // Browser clients get a standard 302 redirect.
    //
    // Guard against redirect loops: /login and /setup don't have auth-guarded
    // routes yet (AUTH-003), so redirecting there would just loop forever.
    if (rawPath === '/login' || rawPath === '/setup') {
      return reply.status(404).send();
    }

    if (request.headers['hx-request']) {
      reply.header('HX-Redirect', '/login');
      return reply.status(200).send();
    }
    return reply.redirect('/login');
  });

  // -----------------------------------------------------------------------
  // 10. GET /health — readiness probe
  // -----------------------------------------------------------------------

  /**
   * Health / readiness endpoint.
   *
   * MVP behaviour:
   * - The process is **not listening** until `buildApp()` resolves (i.e.
   *   after schema sync). Probes that arrive during boot therefore see
   *   connection-refused — not 503. The `start_period: 30s` on the
   *   Docker compose healthcheck absorbs this window.
   * - Returns 200 when `bootState` is `ready` and DB responds to `SELECT 1`.
   * - Returns 503 with `status: 'error'` if DB is unreachable after boot
   *   (pool exhaustion / connectivity failure).
   * - The `booting` / `migrating` 503 branches below are retained for
   *   forward compatibility — a future restructure may register `/health`
   *   and call `app.listen()` before schema sync, at which point the
   *   503-during-sync contract becomes reachable. Today it is not.
   *
   * Skips auth (unauthenticated — used by Docker healthcheck, LBs, k8s probes).
   *
   * @see docs/planning/architecture.md §Health endpoint
   */
  app.get('/health', {
    config: { skipAuth: true },
    schema: {
      response: {
        200: HealthResponseSchema,
        503: HealthResponseSchema,
      },
    },
  }, async (_request, reply) => {
    const bootState = currentBootState;

    // During boot or schema sync, return 503 immediately — no DB check
    if (bootState !== 'ready') {
      return reply.status(503).send({
        status: bootState,
        bootState,
        dbReady: false,
      });
    }

    // In ready state, verify DB connectivity with SELECT 1.
    // Uses the base Connection.execute() API which is dialect-agnostic
    // (works on both PostgreSQL and SQLite drivers).
    let dbReady = false;
    try {
      await orm.em.getConnection().execute('SELECT 1');
      dbReady = true;
    } catch {
      // DB unreachable — pool exhaustion or connectivity failure
      dbReady = false;
    }

    if (!dbReady) {
      return reply.status(503).send({
        status: 'error',
        bootState: 'ready',
        dbReady: false,
      });
    }

    return reply.status(200).send({
      status: 'ok',
      bootState: 'ready',
      dbReady: true,
    });
  });

  // -----------------------------------------------------------------------
  // 10b. Register Better Auth `/api/auth/*` catch-all route
  // -----------------------------------------------------------------------
  await registerAuthRoutes(app, auth);

  // -----------------------------------------------------------------------
  // 10c. Register @fastify/multipart (required for CTRF multipart ingest)
  // -----------------------------------------------------------------------
  await app.register(fastifyMultipart, {
    // Don't attach files to body — we iterate parts manually in the route
    attachFieldsToBody: false,
    // Plugin-level ceiling sits at the highest per-type limit (zip = 200 MB).
    // Per-type ceilings (image 10 MB / video 100 MB / zip 200 MB / log 5 MB)
    // are enforced in src/lib/artifact-validation.ts after we classify the file.
    // Without this, @fastify/multipart's default 1 MB cap preempts every check.
    limits: {
      fileSize: 200 * 1024 * 1024,
    },
  });

  // -----------------------------------------------------------------------
  // 10d. Register CTRF ingest route plugin
  // -----------------------------------------------------------------------
  await app.register(ingestPlugin);

  // -----------------------------------------------------------------------
  // 11. Process signal handlers (production only — tests manage lifecycle)
  // -----------------------------------------------------------------------
  if (!testing) {
    const shutdown = async (signal: string) => {
      app.log.info({ signal }, 'Shutdown initiated');
      await app.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  }

  return app;
}
