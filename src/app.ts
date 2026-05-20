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

import { createHash } from 'node:crypto';
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
import type { AppOptions, ArtifactStorage, EventBus, AiProvider } from './types.js';
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
  /**
   * Compile-time contract for the six `app.decorate(...)` calls that
   * `buildApp()` makes against the `FastifyInstance`. Without this block,
   * a typo at a downstream call site (e.g. `app.aiProvier`) would compile
   * cleanly because the decorated property is implicitly typed as
   * `unknown`. With it, decorator consumers get full IntelliSense and
   * mismatched types fail `tsc --noEmit`.
   *
   * Optional decorators (`artifactStorage`, `aiProvider`) are typed as
   * `?` because they may be `undefined` when their feature is disabled
   * (no AI configured; tests that don't need artifact storage).
   *
   * @see src/app.ts §2 (boot state), §7 (ORM), §8 (DI seams) — the
   *      `app.decorate(...)` call sites this contract types.
   * @see docs/planning/architecture.md §Layering and Dependency Direction
   *      — the composition root seam these decorators expose.
   */
  interface FastifyInstance {
    /** MikroORM root EntityManager — for shutdown and direct access. Per-request handlers must read `request.em`, not this. */
    orm: MikroORM;
    /** In-process or external event bus — `MemoryEventBus` in production, injected double in tests. */
    eventBus: EventBus;
    /** Artifact storage adapter — local FS in production, optional in tests. Undefined when not configured. */
    artifactStorage?: ArtifactStorage;
    /** AI provider — present only when `AI_PROVIDER` env is set or a test double is injected. */
    aiProvider?: AiProvider;
    /** Current boot lifecycle phase (`booting` | `migrating` | `ready`). Read by `/health`. */
    getBootState(): BootState;
    /** Setter for the boot state — called by the schema-sync sequence. */
    setBootState(state: BootState): void;
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
  // Aligned with `database-design.md §DD-012` Layer 2 row
  // "General authenticated API | 600 req/min | session-user-id |
  // `@fastify/rate-limit` default store" and `§DD-029` (429 response contract +
  // observability rule).
  //
  // KEY GENERATOR
  //   The plugin runs *before* the global auth preHandler (step 9), so on a
  //   request's first pass `request.user` and `request.apiKeyUser` are still
  //   undefined. The fallback chain matches DD-012's intent: authenticated
  //   browser sessions key on Better Auth's `request.user.id`; authenticated
  //   CI requests key on the API key owner's `referenceId` (Better Auth 1.x's
  //   canonical user-id field on an apikey row — see `src/auth.ts ApiKeyUser`);
  //   everything else falls back to `request.ip`. Collapsing the
  //   unauthenticated-then-authenticated lookup into a single function avoids
  //   the "all unauthenticated traffic shares one bucket" trap that simpler
  //   keyGenerators fall into.
  //
  // 429 CONTRACT (DD-029 point 4)
  //   - `enableDraftSpec: true` switches the plugin's default header family
  //     from the legacy `X-RateLimit-*` to the RFC 9728 draft `RateLimit-*`,
  //     matching DD-029's explicit "do NOT emit the non-standard
  //     `X-RateLimit-*` variant" stance. `Retry-After` is still emitted (for
  //     older-client compatibility).
  //   - `errorResponseBuilder` shapes the JSON body for `/api/v1/*` (and any
  //     other non-`/hx/*` path) as
  //     `{"error":"rate_limited","code":"too_many_requests","retry_after_s":<int>}`.
  //   - For `/hx/*` routes, the builder attaches an `HX-Trigger: rate-limited`
  //     header (non-enumerable, applied by Fastify's `setErrorHeaders`); a
  //     paired global `onSend` hook below rewrites the body to empty bytes so
  //     Alpine's `htmx:trigger` listener consumes the toast event without a
  //     stray JSON payload swap. No `/hx/*` routes exist on `main` today; the
  //     split is installed pre-emptively so the contract is correct when the
  //     dashboard story lands.
  //
  // OBSERVABILITY (DD-029 point 7)
  //   `onExceeded` emits a single Pino `event=ratelimit.exceeded` line. The
  //   limiter key is hashed (first 8 hex chars of SHA-256) so repeat-offender
  //   patterns are visible without writing raw IPs / user-ids / token-ids to
  //   the log stream. The Prometheus counter
  //   `ctrfhub_ratelimit_exceeded_total{endpoint,backend}` mentioned in DD-029
  //   is **explicitly deferred** — no Prometheus integration exists yet; this
  //   block will gain the increment alongside that wiring.
  await app.register(fastifyRateLimit, {
    max: 600,
    timeWindow: '1 minute',
    // RFC 9728 draft headers only — DD-029 forbids the `X-RateLimit-*` family.
    enableDraftSpec: true,
    keyGenerator: (request: FastifyRequest) => {
      // Post-auth: prefer session-user-id (browser), then API-key owner-id
      // (CI), then IP. Pre-auth (first preHandler ordering): both auth
      // properties are undefined, so we fall through to IP — which is what
      // DD-012 expects for unauthenticated traffic anyway.
      return (
        request.user?.id ??
        request.apiKeyUser?.referenceId ??
        request.ip
      );
    },
    errorResponseBuilder: (request, context) => {
      // `context.ttl` is the milliseconds until the bucket resets; the
      // canonical DD-029 body field is `retry_after_s` (seconds, integer).
      const retryAfterS = Math.ceil(context.ttl / 1000);
      const rawPath = request.url.split('?')[0] ?? '';
      const isHxRoute = rawPath.startsWith('/hx/');

      // DD-029 (`docs/planning/database-design.md:1191-1198`) fixes the
      // serialized body to exactly three keys: `error`, `code`,
      // `retry_after_s`. The TypeScript literal type matches the wire-format
      // view. `statusCode` is set non-enumerably below because Fastify's
      // `setErrorStatusCode` reads `err.statusCode` off the thrown body to
      // set the reply code (`node_modules/fastify/lib/error-handler.js`), but
      // it must not appear in the JSON serialization.
      const body: {
        error: string;
        code: string;
        retry_after_s: number;
      } = {
        error: 'rate_limited',
        code: 'too_many_requests',
        retry_after_s: retryAfterS,
      };

      // `statusCode` is read by Fastify's `setErrorStatusCode` via direct
      // property access (not iteration), so making it non-enumerable keeps
      // it out of the JSON-serialized body while still driving the reply
      // status code. Same trick as `headers` below.
      Object.defineProperty(body, 'statusCode', {
        value: 429,
        enumerable: false,
      });

      if (isHxRoute) {
        // `headers` is read by Fastify's `setErrorHeaders` via direct property
        // access (not iteration), so making it non-enumerable keeps it out of
        // the JSON-serialized body. The paired `onSend` hook below rewrites
        // the `/hx/*` body to empty bytes per the DD-029 `/hx/*` row.
        Object.defineProperty(body, 'headers', {
          value: { 'HX-Trigger': 'rate-limited' },
          enumerable: false,
        });
      }

      return body;
    },
    onExceeded: (request: FastifyRequest, key: string) => {
      // DD-029 point 7 (`docs/planning/database-design.md:1233-1241`): hash
      // the limiter key (first 8 hex of SHA-256) so repeat-offender patterns
      // surface in the log without leaking raw IPs / user-ids / token-ids.
      // Field names are snake_case per DD-029's canonical sample; `limit`
      // and `backend` are derived from this registration block (max=600,
      // timeWindow='1 minute' → "600/1m"; library default store →
      // "fastify-rate-limit").
      const keyHash = createHash('sha256').update(String(key)).digest('hex').slice(0, 8);
      request.log.warn(
        {
          event: 'ratelimit.exceeded',
          endpoint: `${request.method} ${request.url.split('?')[0] ?? ''}`,
          key_hash: keyHash,
          limit: '600/1m',
          backend: 'fastify-rate-limit',
        },
        'Rate limit exceeded',
      );
    },
  });

  // -----------------------------------------------------------------------
  // 4a. /hx/* 429 empty-body rewrite (DD-029 point 4)
  // -----------------------------------------------------------------------
  // The rate-limit `errorResponseBuilder` cannot itself produce a zero-byte
  // body — its return value is JSON-serialized by Fastify's default reply
  // path. For `/hx/*` routes, DD-029 mandates an empty body plus the
  // `HX-Trigger: rate-limited` header (set on the error object by the
  // builder). This `onSend` hook detects the rate-limit 429 on an `/hx/*`
  // route and strips the JSON payload before bytes go out, leaving the
  // header intact for Alpine's toast renderer.
  //
  // The narrow trigger (status 429 AND path-prefix `/hx/`) means this hook
  // is a no-op for every other request, including the JSON 429 path for
  // `/api/v1/*` and other URLs.
  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode !== 429) return payload;
    const rawPath = request.url.split('?')[0] ?? '';
    if (!rawPath.startsWith('/hx/')) return payload;
    // Replace payload with an empty buffer; content-length is recomputed by
    // Fastify when payload changes in `onSend`.
    reply.header('content-length', '0');
    return '';
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
   *
   * COMPOSITION-ROOT INLINE REGISTRATION
   *   This route is registered inline in `buildApp()` rather than extracted
   *   to its own `src/modules/home/` module. That conforms to
   *   `docs/planning/architecture.md §Code Conventions → File organization`
   *   (the "trivial route" clause adjudicated in PR #77, with `/health`
   *   as the canonical example): a single-line handler that does nothing
   *   but render a static template is too small to justify the four-file
   *   module shape (`routes.ts` + `service.ts` + `schemas.ts` + tests).
   *
   *   EXTRACTION THRESHOLD. Extract to `src/modules/home/` when ANY of:
   *     - The handler grows beyond a single `reply.page()` call (i.e. it
   *       starts loading data, branching on auth, or composing partials).
   *     - A Zod body or querystring schema becomes necessary (filters,
   *       pagination, search inputs).
   *     - The route gains route-level config (per-route rate limit, custom
   *       `preHandler`, idempotency-key handling).
   *     - The home page module accretes sibling routes (`GET /about`,
   *       `GET /pricing`) — at that point the directory pays for itself.
   *
   *   Until one of those triggers fires, keeping `GET /` inline keeps the
   *   composition root readable: a reader scanning `buildApp()` top-to-
   *   bottom sees the route alongside the `reply.page()` decorator that
   *   defines its rendering contract, instead of having to chase an import.
   *
   * @see audit `audit-composition-root` finding #10 (option (b))
   * @see docs/planning/architecture.md §Code Conventions → File organization
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
   * Closure-scoped cache for the empty-users redirect (Branch 1).
   *
   * The empty-users check runs `request.em.count(User)` on every authenticated
   * request that isn't on the public-path allow-list. Once the first user
   * exists, that count is monotonically `>0` for the lifetime of this app
   * instance — the only way to remove users is via a DB-level operation
   * that doesn't go through this server (no `DELETE FROM user` route
   * exists in the MVP, and even if one were added it would terminate the
   * "user table is empty" cliff which is a one-way transition by design).
   *
   * Once `usersBootstrapped` flips to `true`, the COUNT query stops firing
   * entirely, eliminating one DB round-trip per authenticated page load /
   * HTMX swap / API call.
   *
   * Scope: this `let` lives in the `buildApp()` closure, so each app
   * instance gets its own cache. Each integration test that calls
   * `buildApp({ db: ':memory:' })` gets a fresh `false` — no reset hook
   * needed; the per-test app-rebuild is the reset.
   *
   * @see audit `audit-composition-root` finding #9
   */
  let usersBootstrapped = false;

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
   * Registered on the `preHandler` lifecycle stage (not `onRequest`) to match
   * `docs/planning/architecture.md §Security` line 437 ("single global
   * `preHandler` hook") and `skills/better-auth-session-and-api-tokens.md`.
   * `preHandler` is the canonical Fastify stage for auth — it runs after
   * routing and body parsing, so any future branch that needs to read
   * `request.body` (e.g. a CSRF-double-submit check) Just Works without a
   * stage migration. The per-request EM-fork hook above is `onRequest`
   * deliberately, because every preHandler / handler downstream reads
   * `request.em` and the fork must already be in place by that point.
   *
   * In this story (INFRA-002), all branches are stubbed — the hook exists
   * so AUTH-001 only has to fill in the body of each branch, never
   * restructure the hook.
   */
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
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
    //   /setup, /api/auth/*, /health.
    // Static assets (/assets/*) are NOT in this list — they're already
    // bypassed unconditionally by Branch 0 above (which returns before this
    // check runs). Listing `/assets/` here too would be dead code; if the
    // prefix ever changes, the two copies would silently drift.
    // Browser clients get a 302 redirect; HTMX clients get HX-Redirect + 200.
    const isExemptFromEmptyCheck =
      rawPath === '/setup' ||
      rawPath.startsWith('/setup/') ||
      rawPath.startsWith('/api/auth/') ||
      rawPath === '/health' ||
      // `/__test__/*` is a reserved namespace used only by `e2e/test-server.ts`
      // (no `src/` route registers under it). E2E test routes already carry
      // `config: { skipAuth: true }`, but Branch 2's skipAuth bypass runs
      // *after* this Branch 1 redirect, so without this exemption an E2E
      // request to /__test__/home gets 302→/setup→404 even though the test
      // server seeds a user at startup. Exempt the namespace so Branch 2's
      // skipAuth contract takes effect as documented.
      rawPath.startsWith('/__test__/');

    if (!isExemptFromEmptyCheck && !usersBootstrapped) {
      // Cache miss — query the DB. Once `usersBootstrapped` flips to `true`,
      // this block is skipped on all subsequent requests for the lifetime
      // of this app instance (see `let usersBootstrapped` above).
      let userCount = 0;
      try {
        userCount = await request.em.count(User);
      } catch {
        // The `user` table may not exist yet if Better Auth's schema migration
        // hasn't been run (e.g. fresh install before `npx auth migrate`).
        // Treat as zero users — redirect to /setup so the wizard can run.
        // Leave `usersBootstrapped` false so we re-query on the next request
        // (the table may be created by then).
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
      // First non-zero count: latch the cache. Future requests bypass the
      // COUNT entirely. The transition `users empty → users present` is
      // one-way for the lifetime of an app instance (no in-process route
      // deletes the last user), so we never need to flip back to `false`.
      usersBootstrapped = true;
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
      //
      // Observability: emit a single Pino structured-log line before the
      // 401 so operators can diagnose a misconfigured CI client that is
      // silently failing ingest. Cited by `architecture.md §Code
      // Conventions → Logging`: "the auth subsystem and ingest routes log
      // decisions (e.g. invalid API key) without logging the token value."
      //
      // The raw `apiToken` value MUST NOT appear in any log field. The
      // brief's finding #6 draft suggested `tokenPrefix: apiToken.slice(0, 8)`
      // — rejected here because `ctrf_*` tokens have a known literal prefix
      // and the first 8 chars leak a partial value. We omit the prefix
      // entirely and correlate via `ip` alone, which is what an operator
      // needs to find the offending CI client. A hashed-prefix variant was
      // considered (parallel to the 429 observability hash) but rejected
      // for S1: it adds correlator ambiguity ("is this a key hash or a
      // user hash?") without enabling cross-request correlation that the
      // IP doesn't already provide. (Decision documented in
      // feature-handoff.md iteration 1.)
      request.log.warn(
        {
          event: 'auth.api_key_invalid',
          ip: request.ip,
        },
        'Invalid API key on x-api-token',
      );
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
