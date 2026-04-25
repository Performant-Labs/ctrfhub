/**
 * CTRFHub — Fastify App Factory.
 *
 * `buildApp(options?)` is the single entry point for constructing the
 * Fastify server instance. It wires up:
 *
 * - ZodTypeProvider (runtime validation + TS types from Zod schemas)
 * - @fastify/helmet (CSP, HSTS, X-Content-Type-Options, COOP)
 * - @fastify/rate-limit (global 600/min default)
 * - @fastify/static (serves compiled Tailwind CSS from src/assets/)
 * - @fastify/view (Eta template engine, root src/views/)
 * - Global auth preHandler hook (skeleton — real logic in AUTH-001)
 * - GET /health (readiness probe — 503 during boot, 200 when ready)
 * - MikroORM lifecycle (init, per-request em fork, shutdown)
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
import { defineConfig } from '@mikro-orm/sqlite';

import type { AppOptions } from './types.js';
import type { BootState } from './modules/health/schemas.js';
import { HealthResponseSchema } from './modules/health/schemas.js';

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

  /** Current boot lifecycle phase: booting → migrating → ready */
  let currentBootState: BootState = 'booting';

  /**
   * Decorated getter for the current boot state.
   * Used by `/health` to decide 503 vs 200.
   */
  app.decorate('getBootState', () => currentBootState);

  /**
   * Decorated setter for the boot state — called by the migration
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

  // -----------------------------------------------------------------------
  // 7. MikroORM lifecycle — init, per-request em fork, shutdown
  // -----------------------------------------------------------------------
  let orm: MikroORM;

  if (options.db !== undefined) {
    // Explicit DB path provided (typically ':memory:' for integration tests)
    orm = await MikroORM.init(
      defineConfig({
        entities: [],
        dbName: options.db,
        // Disable debug logging in tests unless explicitly enabled
        debug: false,
        // TODO(INFRA-004): Remove once entities ship — MikroORM v7 throws
        // when entities array is empty and this flag is true (default).
        discovery: { warnWhenNoEntities: false },
      }),
    );
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

  // Run migrations (transition boot state)
  currentBootState = 'migrating';
  try {
    // MikroORM v7 exposes migrator as a getter property, not a method
    await orm.migrator.up();
  } catch (err) {
    // Migration failure is fatal — log and let the process crash
    app.log.error({ err }, 'Migration failed — process will exit');
    throw err;
  }
  currentBootState = 'ready';

  // Register ORM cleanup on shutdown
  app.addHook('onClose', async () => {
    await orm.close();
  });

  // -----------------------------------------------------------------------
  // 8. DI seam cleanup on shutdown (event bus, artifact storage, AI provider)
  // -----------------------------------------------------------------------
  if (options.eventBus) {
    app.decorate('eventBus', options.eventBus);
    app.addHook('onClose', async () => {
      await options.eventBus!.close();
    });
  }

  if (options.artifactStorage) {
    app.decorate('artifactStorage', options.artifactStorage);
    app.addHook('onClose', async () => {
      await options.artifactStorage!.close();
    });
  }

  if (options.aiProvider) {
    app.decorate('aiProvider', options.aiProvider);
    app.addHook('onClose', async () => {
      await options.aiProvider!.close();
    });
  }

  // -----------------------------------------------------------------------
  // 9. Global auth preHandler — skeleton (real logic lands in AUTH-001)
  // -----------------------------------------------------------------------

  /**
   * Global auth preHandler hook.
   *
   * Precedence (per `better-auth-session-and-api-tokens.md`):
   *   1. Empty-users redirect to /setup
   *   2. skipAuth bypass
   *   3. Bearer API key (ctrf_*) validation
   *   4. Session cookie validation
   *   5. HTMX 401 with HX-Redirect: /login
   *
   * In this story (INFRA-002), all branches are stubbed — the hook exists
   * so AUTH-001 only has to fill in the body of each branch, never
   * restructure the hook.
   */
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // ── Branch 1: Empty-users redirect to /setup ──
    // TODO(AUTH-001): Check if users table is empty → redirect to /setup
    // for all non-exempt routes. Example:
    //   const userCount = await request.em.count(User);
    //   if (userCount === 0 && !isExemptRoute(request)) {
    //     return reply.redirect('/setup');
    //   }

    // ── Branch 2: skipAuth bypass ──
    // Routes marked with `config: { skipAuth: true }` bypass auth entirely.
    // This is fully implemented — no TODO.
    const routeConfig = request.routeOptions?.config as { skipAuth?: boolean } | undefined;
    if (routeConfig?.skipAuth) {
      return;
    }

    // ── Branch 3: Bearer API key validation (ctrf_* tokens) ──
    // TODO(AUTH-001): Extract Authorization header, validate with
    // auth.api.verifyApiKey(). If valid, attach token metadata to request.
    //   const authHeader = request.headers.authorization;
    //   if (authHeader?.startsWith('Bearer ctrf_')) {
    //     const result = await auth.api.verifyApiKey(authHeader.slice(7));
    //     if (result.valid) { request.apiKeyUser = result; return; }
    //   }

    // ── Branch 4: Session cookie validation ──
    // TODO(AUTH-001): Validate session cookie with auth.api.getSession().
    //   const session = await auth.api.getSession({ headers: request.headers });
    //   if (session) { request.user = session.user; return; }

    // ── Branch 5: HTMX 401 with HX-Redirect ──
    // TODO(AUTH-001): If HTMX request and unauthenticated:
    //   if (request.headers['hx-request']) {
    //     reply.header('HX-Redirect', '/login');
    //     return reply.status(401).send();
    //   }
    //   return reply.redirect('/login');

    // ── INFRA-002 stub: allow all requests through ──
    // This always-allow behaviour is replaced by AUTH-001 with real checks.
    return;
  });

  // -----------------------------------------------------------------------
  // 10. GET /health — readiness probe
  // -----------------------------------------------------------------------

  /**
   * Health / readiness endpoint.
   *
   * - Returns 503 while `bootState` is `booting` or `migrating`
   * - Returns 200 when `ready` and DB responds to `SELECT 1`
   * - Returns 503 with `status: 'error'` if DB is unreachable after boot
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

    // During boot or migration, return 503 immediately — no DB check
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
