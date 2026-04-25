/**
 * Integration tests — AUTH-001 global auth preHandler + /api/auth/* catch-all.
 *
 * Covers all five precedence branches of the global preHandler in `src/app.ts`:
 *
 *   1. Empty-users → /setup redirect (browser + HTMX)
 *   2. skipAuth: true bypass
 *   3. API key (`x-api-token`) validation
 *   4. Session cookie validation
 *   5. Unauthenticated → /login (HTMX vs browser)
 *
 * Plus the `/api/auth/*` catch-all and the security invariant that raw API
 * keys are never persisted (only their hash is stored).
 *
 * Test factory pattern — two layouts:
 *   - Branch-1 / skipAuth tests use `:memory:` (no users seeded; the empty-DB
 *     redirect is the system-under-test).
 *   - Branches 3/4/5 + API-key + raw-key-storage tests use a temp-file SQLite
 *     shared between Better Auth (Kysely) and MikroORM. Better Auth's schema
 *     is created via `getMigrations(...).runMigrations()`, then a user is
 *     signed up so `em.count(User) > 0` and Branch 1 is bypassed.
 *
 * @see skills/better-auth-session-and-api-tokens.md
 * @see skills/vitest-three-layer-testing.md §Layer 2
 * @see skills/page-verification-hierarchy.md §T1 Headless
 * @see .argos/AUTH-001/feature-handoff.md §Test coverage needed
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../app.js';
import { buildAuth } from '../../auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pre-create Better Auth's schema (`user`, `session`, `account`, `verification`,
 * `apikey`) on a SQLite file. Better Auth does not auto-migrate — without this
 * step, signing up returns a 500 because the `user` table doesn't exist.
 */
async function seedAuthSchema(dbPath: string): Promise<void> {
  const auth = await buildAuth(dbPath);
  // Better Auth's auth context exposes `runMigrations()` (see
  // node_modules/better-auth/dist/context/init.mjs). This is the supported
  // public path to creating Better Auth's tables programmatically.
  const ctx = await auth.$context;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (ctx as any).runMigrations();
}

/** Build a unique temp DB path. Tests are responsible for unlinking on close. */
function makeTempDbPath(): string {
  return join(tmpdir(), `ctrfhub-auth-${randomUUID()}.db`);
}

interface SeededFixture {
  app: FastifyInstance;
  dbPath: string;
  /** The session cookie set by sign-up (full Set-Cookie header value). */
  sessionCookie: string;
  /** The Better Auth user id of the seeded user. */
  userId: string;
  /** Raw API key value returned at creation (`ctrf_*`). */
  rawApiKey: string;
}

/**
 * Build an app with Better Auth schema pre-seeded and a single signed-up user
 * + a freshly issued API key. Used by Branches 3/4/5 and the raw-key-storage
 * test.
 */
async function buildSeededApp(): Promise<SeededFixture> {
  const dbPath = makeTempDbPath();
  await seedAuthSchema(dbPath);
  const app = await buildApp({ testing: true, db: dbPath });

  // Sign up a user via Better Auth's catch-all. This both creates the user
  // row in the `user` table and returns a session cookie.
  const signUpRes = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: {
      email: 'tester@example.com',
      password: 'P@ssw0rd-test-1234',
      name: 'Test User',
    },
  });
  if (signUpRes.statusCode >= 400) {
    throw new Error(
      `Sign-up failed in fixture (status ${signUpRes.statusCode}): ${signUpRes.body}`,
    );
  }

  const setCookie = signUpRes.headers['set-cookie'];
  const sessionCookie = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
  if (!sessionCookie) {
    throw new Error('Sign-up did not return a session cookie');
  }

  const signUpBody = JSON.parse(signUpRes.body) as { user?: { id?: string }; id?: string };
  const userId = signUpBody.user?.id ?? signUpBody.id ?? '';
  if (!userId) {
    throw new Error(`Sign-up response had no user id: ${signUpRes.body}`);
  }

  // Create an API key bound to the user. The api-key plugin's server-side
  // `createApiKey` accepts `userId` directly (no session required).
  const fixtureAuth = await buildAuth(dbPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createKeyResult: any = await (fixtureAuth.api as any).createApiKey({
    body: {
      name: 'test-fixture-key',
      userId,
      metadata: { projectId: 'fixture-project' },
    },
  });
  const rawApiKey: string = createKeyResult.key ?? createKeyResult.apiKey ?? '';
  if (!rawApiKey || !rawApiKey.startsWith('ctrf_')) {
    throw new Error(
      `createApiKey did not return a ctrf_-prefixed key: ${JSON.stringify(createKeyResult)}`,
    );
  }

  return { app, dbPath, sessionCookie, userId, rawApiKey };
}

/** Tear down a SeededFixture — closes the app and removes the temp DB file. */
async function teardownSeededApp(fixture: SeededFixture): Promise<void> {
  await fixture.app.close();
  if (existsSync(fixture.dbPath)) {
    try {
      unlinkSync(fixture.dbPath);
    } catch {
      // best effort
    }
  }
}

// ---------------------------------------------------------------------------
// Branch 1 — Empty-users redirect to /setup
// ---------------------------------------------------------------------------

describe('AUTH-001 Branch 1 — empty-users redirect to /setup', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ testing: true, db: ':memory:' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /runs (browser, empty DB) → 302 to /setup', async () => {
    const res = await app.inject({ method: 'GET', url: '/runs' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/setup');
  });

  it('GET /runs with HX-Request: true (empty DB) → 200 + HX-Redirect: /setup', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/runs',
      headers: { 'hx-request': 'true' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['hx-redirect']).toBe('/setup');
  });

  it('GET /health (empty DB) → 200 (exempt from empty-users check)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['hx-redirect']).toBeUndefined();
    expect(res.headers.location).toBeUndefined();
  });

  it('GET /api/auth/get-session (empty DB) → not redirected to /setup (exempt)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/get-session' });
    // /api/auth/* is exempt from the empty-users redirect. The Better Auth
    // handler may return any non-302/setup response (typically 200 with null
    // session, or a 5xx if its tables aren't migrated — both are acceptable
    // here; what matters is we did NOT short-circuit to /setup).
    expect(res.headers.location).not.toBe('/setup');
    expect(res.headers['hx-redirect']).not.toBe('/setup');
  });

  it('GET /assets/missing.css (empty DB) → not redirected to /setup (exempt from Branch 1)', async () => {
    // /assets/* is exempt from the empty-users redirect; with no users seeded
    // and no skipAuth on this fastify-static route, the request falls through
    // to Branch 5 (302 /login) — what matters here is we did NOT loop to /setup.
    const res = await app.inject({ method: 'GET', url: '/assets/missing.css' });
    expect(res.headers.location).not.toBe('/setup');
  });

  it('GET /setup (empty DB) → not redirected back to /setup (exempt from Branch 1)', async () => {
    // /setup is exempt from the empty-users redirect. AUTH-002 will ship the
    // /setup route + skipAuth marker; until then this falls through to
    // Branch 5. The invariant under test is the redirect-loop prevention:
    // /setup must NEVER 302 to /setup.
    const res = await app.inject({ method: 'GET', url: '/setup' });
    expect(res.headers.location).not.toBe('/setup');
  });
});

// ---------------------------------------------------------------------------
// Branch 2 — skipAuth bypass
// ---------------------------------------------------------------------------

describe('AUTH-001 Branch 2 — skipAuth bypass', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ testing: true, db: ':memory:' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('skipAuth route (/health) returns 200 even with no auth headers and empty DB', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('skipAuth route (/api/auth/sign-in/email) is reachable without prior auth', async () => {
    // A /api/auth/* request must reach the Better Auth handler — not 401/302.
    // We POST junk credentials and expect Better Auth to return a 4xx
    // (invalid creds) or similar — but NOT a 302 to /login or /setup.
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'nobody@example.com', password: 'wrong' },
    });
    expect(res.headers.location).not.toBe('/login');
    expect(res.headers.location).not.toBe('/setup');
    // Response was generated by Better Auth, not the auth preHandler.
    // Status will be a Better Auth response (likely 4xx).
    expect([200, 400, 401, 403, 404, 422, 500]).toContain(res.statusCode);
  });
});

// ---------------------------------------------------------------------------
// Branches 3, 4, 5 — auth precedence on a seeded DB
// ---------------------------------------------------------------------------

describe('AUTH-001 Branches 3/4/5 — seeded DB (user exists, Branch 1 skipped)', () => {
  let fixture: SeededFixture;

  beforeAll(async () => {
    fixture = await buildSeededApp();
  });

  afterAll(async () => {
    await teardownSeededApp(fixture);
  });

  // ── Branch 3 — API key (`x-api-token`) ────────────────────────────────

  describe('Branch 3 — API key (x-api-token)', () => {
    it('valid ctrf_* key → request passes preHandler (not 302/401)', async () => {
      const res = await fixture.app.inject({
        method: 'GET',
        url: '/runs',
        headers: { 'x-api-token': fixture.rawApiKey },
      });
      // /runs is not a registered route → 404, but importantly we got past
      // the auth preHandler (no 302 to /login, no 401 from invalid-key branch).
      expect(res.statusCode).toBe(404);
      expect(res.headers.location).not.toBe('/login');
      expect(res.headers.location).not.toBe('/setup');
    });

    it('invalid token in x-api-token → 401 with INVALID_API_KEY code', async () => {
      const res = await fixture.app.inject({
        method: 'GET',
        url: '/runs',
        headers: { 'x-api-token': 'ctrf_definitely-not-real' },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body) as { code?: string };
      expect(body.code).toBe('INVALID_API_KEY');
    });

    it('valid token + HX-Request: true → still passes (does NOT route to Branch 5 HTMX-401)', async () => {
      const res = await fixture.app.inject({
        method: 'GET',
        url: '/runs',
        headers: {
          'x-api-token': fixture.rawApiKey,
          'hx-request': 'true',
        },
      });
      // Should reach routing → 404. Should NOT have HX-Redirect: /login.
      expect(res.statusCode).toBe(404);
      expect(res.headers['hx-redirect']).toBeUndefined();
    });

    it('invalid token does NOT fall through to session/HTMX-401 branches', async () => {
      // Even an HTMX request with an invalid API key short-circuits to 401
      // INVALID_API_KEY — the key branch must not let bad keys leak through
      // to the session-cookie branch (timing attack guard).
      const res = await fixture.app.inject({
        method: 'GET',
        url: '/runs',
        headers: {
          'x-api-token': 'ctrf_invalid',
          'hx-request': 'true',
        },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body) as { code?: string };
      expect(body.code).toBe('INVALID_API_KEY');
      // Critically, no HX-Redirect to /login (which is the Branch 5 behavior).
      expect(res.headers['hx-redirect']).toBeUndefined();
    });
  });

  // ── Branch 4 — Session cookie ─────────────────────────────────────────

  describe('Branch 4 — session cookie', () => {
    it('valid session cookie → request passes preHandler', async () => {
      const res = await fixture.app.inject({
        method: 'GET',
        url: '/runs',
        headers: { cookie: fixture.sessionCookie },
      });
      // Reaches routing → 404. No redirect.
      expect(res.statusCode).toBe(404);
      expect(res.headers.location).not.toBe('/login');
    });

    it('no cookie + no token → falls through to Branch 5 (302 /login)', async () => {
      const res = await fixture.app.inject({ method: 'GET', url: '/runs' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });
  });

  // ── Branch 5 — Unauthenticated ────────────────────────────────────────

  describe('Branch 5 — unauthenticated', () => {
    it('browser (no auth) → 302 to /login', async () => {
      const res = await fixture.app.inject({ method: 'GET', url: '/runs' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('HTMX (no auth) → 200 + HX-Redirect: /login', async () => {
      const res = await fixture.app.inject({
        method: 'GET',
        url: '/runs',
        headers: { 'hx-request': 'true' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['hx-redirect']).toBe('/login');
    });
  });
});

// ---------------------------------------------------------------------------
// /api/auth/* catch-all
// ---------------------------------------------------------------------------

describe('AUTH-001 /api/auth/* catch-all (Better Auth handler)', () => {
  let fixture: SeededFixture;

  beforeAll(async () => {
    fixture = await buildSeededApp();
  });

  afterAll(async () => {
    await teardownSeededApp(fixture);
  });

  it('GET /api/auth/get-session with no cookie → 200 (Better Auth returns null session)', async () => {
    const res = await fixture.app.inject({ method: 'GET', url: '/api/auth/get-session' });
    expect(res.statusCode).toBe(200);
    // Body is null/empty when there's no session — assert it is NOT a redirect.
    expect(res.headers.location).toBeUndefined();
  });

  it('POST /api/auth/sign-in/email with valid credentials → 200 + Set-Cookie', async () => {
    const res = await fixture.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: {
        email: 'tester@example.com',
        password: 'P@ssw0rd-test-1234',
      },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
    // Better Auth's session cookie is named `better-auth.session_token` by default.
    expect(cookieStr).toMatch(/session/i);
  });

  it('POST /api/auth/sign-in/email with bad credentials → 4xx (not 302)', async () => {
    const res = await fixture.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'tester@example.com', password: 'wrong-password' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.headers.location).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SECURITY — raw API key never persisted
// ---------------------------------------------------------------------------

describe('AUTH-001 SECURITY — raw API key never stored (only hash)', () => {
  let fixture: SeededFixture;

  beforeAll(async () => {
    fixture = await buildSeededApp();
  });

  afterAll(async () => {
    await teardownSeededApp(fixture);
  });

  it('apikey table contains a hash, not the raw ctrf_* key value', async () => {
    // Query the apikey table directly via the MikroORM connection, which is
    // backed by the same SQLite file Better Auth wrote the key to.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (fixture.app as any).orm;
    const conn = orm.em.getConnection();
    const rows = (await conn.execute('SELECT key, start FROM apikey')) as Array<{
      key: string;
      start: string | null;
    }>;
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      // The stored `key` column must NOT equal the raw key returned at creation.
      expect(row.key).not.toBe(fixture.rawApiKey);
      // And it must NOT contain the full raw key as a substring.
      expect(row.key.includes(fixture.rawApiKey)).toBe(false);
      // The `start` column may legitimately contain the prefix (e.g. "ctrf_")
      // for display; that is not the secret. Asserting only that `key` is
      // not the plaintext is sufficient for the security invariant.
    }
  });

  it('verifyApiKey accepts the raw key and rejects a tampered variant', async () => {
    // Sanity check that hashing is functional end-to-end: the raw key works,
    // but a near-match (e.g. last char flipped) does not.
    const goodRes = await fixture.app.inject({
      method: 'GET',
      url: '/runs',
      headers: { 'x-api-token': fixture.rawApiKey },
    });
    expect(goodRes.statusCode).toBe(404); // past auth, just no route

    const tampered = fixture.rawApiKey.slice(0, -1) + 'X';
    const badRes = await fixture.app.inject({
      method: 'GET',
      url: '/runs',
      headers: { 'x-api-token': tampered },
    });
    expect(badRes.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Blocker 3 — assert request.apiKeyUser is populated by Branch 3
// ---------------------------------------------------------------------------

describe('AUTH-001 Branch 3 — request.apiKeyUser populated after API key validation', () => {
  let app: ReturnType<typeof buildApp> extends Promise<infer T> ? T : never;
  let dbPath: string;
  let rawApiKey: string;

  beforeAll(async () => {
    // Build a fresh app for this suite — we need to register the whoami route
    // BEFORE any inject() call (Fastify freezes route registration on first
    // inject). We therefore set up the app and register the route before
    // performing any network operations.
    dbPath = makeTempDbPath();
    await seedAuthSchema(dbPath);
    app = await buildApp({ testing: true, db: dbPath });

    // Register the test-only whoami route BEFORE the first inject()
    app.get(
      '/__test__/whoami',
      { config: { skipAuth: false } },
      async (request) => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apiKeyUser: (request as any).apiKeyUser ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user: (request as any).user ?? null,
      }),
    );

    // Now seed a user so Branch 1 (empty-users redirect) is bypassed
    const signUpRes = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: {
        email: 'whoami-tester@example.com',
        password: 'P@ssw0rd-test-1234',
        name: 'Whoami User',
      },
    });
    if (signUpRes.statusCode >= 400) {
      throw new Error(`Sign-up failed (status ${signUpRes.statusCode}): ${signUpRes.body}`);
    }
    const signUpBody = JSON.parse(signUpRes.body) as { user?: { id?: string }; id?: string };
    const userId = signUpBody.user?.id ?? signUpBody.id ?? '';
    if (!userId) throw new Error(`Sign-up response had no user id: ${signUpRes.body}`);

    // Create an API key with a known projectId
    const fixtureAuth = await buildAuth(dbPath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createResult: any = await (fixtureAuth.api as any).createApiKey({
      body: {
        name: 'blocker3-key',
        userId,
        metadata: { projectId: 'blocker3-test-project' },
      },
    });
    rawApiKey = createResult.key ?? createResult.apiKey ?? '';
    if (!rawApiKey || !rawApiKey.startsWith('ctrf_')) {
      throw new Error(`createApiKey did not return ctrf_-prefixed key: ${JSON.stringify(createResult)}`);
    }
  });

  afterAll(async () => {
    await app.close();
    if (existsSync(dbPath)) {
      try { unlinkSync(dbPath); } catch { /* best effort */ }
    }
  });

  it('valid ctrf_* key → request.apiKeyUser populated with id and metadata.projectId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/__test__/whoami',
      headers: { 'x-api-token': rawApiKey },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      apiKeyUser: { id: string; referenceId?: string; metadata?: { projectId?: string } } | null;
      user: unknown;
    };

    // apiKeyUser must be set — not null
    expect(body.apiKeyUser).not.toBeNull();
    // id must be a non-empty string (the key's own DB id)
    expect(typeof body.apiKeyUser!.id).toBe('string');
    expect(body.apiKeyUser!.id.length).toBeGreaterThan(0);
    // metadata.projectId must match what we passed at key creation
    expect(body.apiKeyUser!.metadata?.projectId).toBe('blocker3-test-project');
  });
});
