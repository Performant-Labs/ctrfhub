/**
 * CTRFHub — Better Auth configuration.
 *
 * Exports the `auth` instance consumed by:
 *   - `src/app.ts` global preHandler (session + API-key validation)
 *   - `src/modules/auth/routes.ts` `/api/auth/*` catch-all
 *
 * Database note: Better Auth manages its own Kysely connection independently
 * from MikroORM. We pass the same underlying database — SQLite via
 * `better-sqlite3` or PostgreSQL via `pg.Pool` — determined by env vars.
 * The two connections share the same file/database but do NOT share
 * transactions; this is intentional (Better Auth is a black-box auth layer).
 *
 * API-key plugin note: the `@better-auth/api-key` plugin does NOT have a
 * `storeRawKey` option. Key hashing is enabled by default (`disableKeyHashing`
 * defaults to `false`), which means raw key values are never persisted.
 * The `ctrf_` prefix and `x-api-token` header are configured below.
 *
 * @see skills/better-auth-session-and-api-tokens.md
 * @see docs/planning/architecture.md §CSRF protection
 * @see docs/planning/database-design.md §4 (Better Auth note)
 */

import { betterAuth } from 'better-auth';
import { apiKey } from '@better-auth/api-key';

// ---------------------------------------------------------------------------
// Fastify type augmentation — extend FastifyRequest with auth user properties
// ---------------------------------------------------------------------------

/**
 * Shape of the user object attached by the session-cookie branch.
 * Mirrors Better Auth's core User model fields.
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}

/**
 * Shape of the object attached by the API-key branch.
 * `referenceId` is the userId that owns the key (Better Auth 1.x renamed `userId` → `referenceId`).
 * `metadata` holds project-scoped data set at key creation time.
 */
export interface ApiKeyUser {
  id: string;
  referenceId: string;
  name?: string | null;
  prefix?: string | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by the session-cookie branch of the global preHandler. */
    user?: SessionUser;
    /** Populated by the API-key (`x-api-token`) branch of the global preHandler. */
    apiKeyUser?: ApiKeyUser;
  }
}

// ---------------------------------------------------------------------------
// Database selector — mirrors the dialect logic in mikro-orm.config.ts
// ---------------------------------------------------------------------------

/**
 * Build the Better Auth `database` config value.
 *
 * - When `DATABASE_URL` is set → PostgreSQL via `pg.Pool`
 * - Otherwise → SQLite via `better-sqlite3` Database
 *
 * The `dbPath` parameter overrides `SQLITE_PATH` and is used by
 * `buildAuth(':memory:')` in integration tests.
 */
async function buildDatabase(dbPath?: string) {
  if (process.env['DATABASE_URL']) {
    // PostgreSQL path
    const { Pool } = await import('pg');
    return new Pool({ connectionString: process.env['DATABASE_URL'] });
  }

  // SQLite path
  const { default: Database } = await import('better-sqlite3');
  const sqlitePath = dbPath ?? process.env['SQLITE_PATH'] ?? ':memory:';
  return new Database(sqlitePath);
}

// ---------------------------------------------------------------------------
// Auth factory
// ---------------------------------------------------------------------------

/**
 * Build a Better Auth instance.
 *
 * In production/dev, call `buildAuth()` with no arguments — the env vars
 * `DATABASE_URL` (PG) or `SQLITE_PATH` (SQLite) determine the dialect.
 *
 * In integration tests, pass `':memory:'` to create an isolated in-memory
 * SQLite database that is seeded/torn-down with the test.
 *
 * @param dbPath - Optional SQLite path override (e.g. `':memory:'` in tests)
 */
export async function buildAuth(dbPath?: string) {
  const database = await buildDatabase(dbPath);

  return betterAuth({
    /**
     * Better Auth secret — must be at least 32 characters.
     * Use `openssl rand -base64 32` to generate a production value.
     */
    secret: process.env['BETTER_AUTH_SECRET'] ?? 'ctrfhub-dev-secret-do-not-use-in-production-32c',

    /**
     * Base URL for Better Auth's internal redirects and cookie domain.
     * Defaults to localhost in development; set `BETTER_AUTH_URL` in production.
     */
    baseURL: process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000',

    /**
     * Better Auth manages its own Kysely connection.
     * The `database` value here is either a `better-sqlite3` Database
     * instance or a `pg.Pool`, determined by `buildDatabase()` above.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    database: database as any,

    /**
     * Email/password authentication — required for the setup wizard (AUTH-002)
     * and normal browser login (AUTH-003).
     */
    emailAndPassword: {
      enabled: true,
    },

    /**
     * Session cookie configuration.
     * Better Auth issues `SameSite=Lax` cookies by default, which is the
     * CSRF-protection mechanism documented in `architecture.md §CSRF protection`.
     * We do NOT add explicit CSRF tokens — this is intentional and documented.
     */
    // session cookie defaults are SameSite=Lax — no override needed

    plugins: [
      /**
       * API-key plugin for CI pipeline authentication.
       *
       * Key design decisions per `better-auth-session-and-api-tokens.md`:
       * - `apiKeyHeaders: 'x-api-token'` — custom header convention from
       *   `product.md §Feature 5 Acceptance criteria`; NOT `Authorization: Bearer`
       * - `defaultPrefix: 'ctrf_'` — identifies tokens as CTRFHub CI tokens
       * - `enableMetadata: true` — allows `metadata.projectId` to be set on
       *   creation so the ingest route (CTRF-002) can scope-check the token
       * - `disableKeyHashing` is NOT set → defaults to `false` (hashing ON)
       *   This is the equivalent of the brief's `storeRawKey: false` requirement:
       *   the raw key value is never persisted, only its hash.
       *
       * Note: There is NO `storeRawKey` option in @better-auth/api-key 1.x.
       * Key hashing is the default and must not be disabled.
       */
      apiKey({
        /** Check `x-api-token` header (not the default `x-api-key`) */
        apiKeyHeaders: 'x-api-token',
        /** All CTRFHub CI tokens carry the `ctrf_` prefix */
        defaultPrefix: 'ctrf_',
        /** Allow `metadata.projectId` at key creation for CTRF-002 scope checks */
        enableMetadata: true,
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Singleton export — used by app.ts and routes.ts
// ---------------------------------------------------------------------------

/**
 * The canonical Better Auth instance for the application.
 *
 * Initialised lazily on first access via `getAuth()`.
 * Integration tests that need an isolated instance should call
 * `buildAuth(':memory:')` directly and pass the result to `buildApp()`.
 */
let _auth: Awaited<ReturnType<typeof buildAuth>> | null = null;

/**
 * Return the singleton auth instance, initialising it on first call.
 *
 * @example
 * ```typescript
 * const auth = await getAuth();
 * const session = await auth.api.getSession({ headers });
 * ```
 */
export async function getAuth(): Promise<Awaited<ReturnType<typeof buildAuth>>> {
  if (!_auth) {
    _auth = await buildAuth();
  }
  return _auth;
}

/**
 * Infer the type of the auth instance for use in type annotations.
 * Avoids capturing the concrete `betterAuth` return type which is very wide.
 */
export type AuthInstance = Awaited<ReturnType<typeof buildAuth>>;
