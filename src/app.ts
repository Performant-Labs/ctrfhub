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
 * - GET /health (readiness probe — 503 during boot, 200 when ready)
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
import type { AppOptions } from './types.js';
import type { BootState } from './modules/health/schemas.js';
import { HealthResponseSchema } from './modules/health/schemas.js';
import { buildAuth } from './auth.js';
import { User } from './entities/index.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import ingestPlugin from './modules/ingest/routes.js';
import { MemoryEventBus, RunEvents } from './services/event-bus.js';
import type { RunIngestedPayload, AiStageEventPayload } from './services/event-bus.js';
import { createAiProvider } from './services/ai/index.js';
import { LocalArtifactStorage } from './lib/local-artifact-storage.js';
import {
  categorizeRun,
  correlateRootCauses,
  generateSummary,
  recoverStalePipelineRows,
  startSweeper,
} from './services/ai/pipeline/index.js';

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

      const body: {
        statusCode: number;
        error: string;
        code: string;
        retry_after_s: number;
      } = {
        statusCode: 429,
        error: 'rate_limited',
        code: 'too_many_requests',
        retry_after_s: retryAfterS,
      };

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
      // DD-029 point 7: hash the limiter key (first 8 hex of SHA-256) so
      // repeat-offender patterns surface in the log without leaking raw
      // IPs / user-ids / token-ids.
      const keyHash = createHash('sha256').update(String(key)).digest('hex').slice(0, 8);
      request.log.warn(
        {
          event: 'ratelimit.exceeded',
          keyHash,
          endpoint: `${request.method} ${request.url.split('?')[0] ?? ''}`,
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

  // Register ORM cleanup on shutdown
  app.addHook('onClose', async () => {
    await orm.close();
  });

  // -----------------------------------------------------------------------
  // 8. DI seam cleanup on shutdown (event bus, artifact storage, AI provider)
  // -----------------------------------------------------------------------

  // EventBus — always present. Tests inject via `options.eventBus`;
  // production/dev falls back to an in-process MemoryEventBus.
  const eventBus = options.eventBus ?? new MemoryEventBus();
  app.decorate('eventBus', eventBus);
  app.addHook('onClose', async () => {
    await eventBus.close();
  });

  const artifactStorage = options.artifactStorage ?? (testing ? undefined : new LocalArtifactStorage());
  if (artifactStorage) {
    app.decorate('artifactStorage', artifactStorage);
    app.addHook('onClose', async () => {
      await artifactStorage.close();
    });
  }

  // AiProvider — injected by tests via `options.aiProvider`; in production
  // constructed from env vars when `AI_PROVIDER` is set. Undefined when AI
  // is not configured (features silently disabled — no nagging).
  const aiProvider = options.aiProvider ?? (
    testing || !process.env['AI_PROVIDER']
      ? undefined
      : createAiProvider()
  );
  if (aiProvider) {
    app.decorate('aiProvider', aiProvider);
    app.addHook('onClose', async () => {
      await aiProvider.close();
    });

    // ── AI pipeline boot-time recovery + subscription ───────────────
    // Only wire the pipeline if the eventBus supports the full interface
    // (subscribe + publish). Minimal test doubles that only implement
    // close() are left alone — the pipeline simply doesn't activate.
    if (typeof eventBus.subscribe === 'function' && typeof eventBus.publish === 'function') {
      // Reclaim crashed-worker rows and re-enqueue pending stages before
      // subscribing to events. This ensures work from a previous crash
      // is picked up before new events are processed.
      // @see skills/ai-pipeline-event-bus.md §Boot-time recovery
      try {
        await recoverStalePipelineRows(orm, eventBus);
      } catch (err) {
        app.log.error({ err }, 'AI pipeline boot-time recovery failed — pipeline may miss stale rows');
        // Non-fatal: the pipeline can still process new events even if
        // recovery fails. The stuck-stage sweeper will catch them later.
      }

      // Subscribe to run.ingested in the 'ai' consumer group. Each event
      // triggers the A1 categorization stage which uses its own forked EM
      // (not request.em — this is an EventBus subscriber, not an HTTP handler).
      // @see skills/ai-pipeline-event-bus.md §Event chain
      eventBus.subscribe('ai', RunEvents.RUN_INGESTED, async (rawPayload) => {
        const payload = rawPayload as RunIngestedPayload;
        try {
          await categorizeRun(payload, aiProvider, orm, eventBus);
        } catch (err) {
          app.log.error(
            { err, runId: payload.runId },
            'A1 categorization failed — unhandled error in categorizeRun',
          );
          // Swallowed: EventBus handlers must not propagate errors.
          // The reserve-execute-commit pattern handles retries internally.
        }
      });

      // ── A2: root cause correlation ──────────────────────────────
      // Subscribes to run.ai_categorized. Handles partial:true from
      // upstream terminal failures by treating uncategorized results
      // as 'unknown' category.
      eventBus.subscribe('ai', RunEvents.RUN_AI_CATEGORIZED, async (rawPayload) => {
        const payload = rawPayload as AiStageEventPayload;
        try {
          await correlateRootCauses(payload, aiProvider, orm, eventBus);
        } catch (err) {
          app.log.error(
            { err, runId: payload.runId },
            'A2 correlation failed — unhandled error in correlateRootCauses',
          );
        }
      });

      // ── A3: run narrative summary ───────────────────────────────
      // Subscribes to run.ai_correlated. Handles partial:true by
      // skipping A2 root cause cluster data in the summary input.
      eventBus.subscribe('ai', RunEvents.RUN_AI_CORRELATED, async (rawPayload) => {
        const payload = rawPayload as AiStageEventPayload;
        try {
          await generateSummary(payload, aiProvider, orm, eventBus);
        } catch (err) {
          app.log.error(
            { err, runId: payload.runId },
            'A3 summary generation failed — unhandled error in generateSummary',
          );
        }
      });

      // ── Stuck-stage sweeper ─────────────────────────────────────
      // Runs every 60s to detect rows that are stuck in 'running'
      // state (crash before catch handler). Terminal-fails exhausted
      // rows (attempt >= 3) so downstream stages can proceed.
      const stopSweeper = startSweeper(orm, eventBus);
      app.addHook('onClose', async () => {
        stopSweeper();
      });
    }
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
