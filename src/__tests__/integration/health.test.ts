/**
 * Integration tests — buildApp() factory + GET /health.
 *
 * Layer 2: `fastify.inject()` with SQLite in-memory.
 * Tests the full request pipeline including middleware, security headers,
 * rate-limit headers, and the health readiness probe.
 *
 * @see skills/vitest-three-layer-testing.md §Layer 2
 * @see src/app.ts — buildApp()
 */

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';

// ---------------------------------------------------------------------------
// Test suite — buildApp() smoke test
// ---------------------------------------------------------------------------

describe('buildApp({ testing: true, db: ":memory:" })', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ testing: true, db: ':memory:' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a Fastify instance', () => {
    expect(app).toBeDefined();
    expect(typeof app.inject).toBe('function');
  });

  it('decorates the app with getBootState', () => {
    expect(typeof app.getBootState).toBe('function');
  });

  it('decorates the app with setBootState', () => {
    expect(typeof app.setBootState).toBe('function');
  });

  it('boot state is "ready" after buildApp resolves', () => {
    expect(app.getBootState()).toBe('ready');
  });

  it('decorates the app with orm', () => {
    expect(app.orm).toBeDefined();
    expect(typeof app.orm.close).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Test suite — GET /health
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ testing: true, db: ':memory:' });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it('returns 200 when boot state is "ready"', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('returns the correct JSON response shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(res.body) as Record<string, unknown>;

    expect(body).toEqual({
      status: 'ok',
      bootState: 'ready',
      dbReady: true,
    });
  });

  it('returns application/json content type', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['content-type']).toContain('application/json');
  });

  // ── skipAuth bypass ─────────────────────────────────────────────────────

  it('does NOT require authentication (skipAuth: true)', async () => {
    // No auth headers, no session cookie — should still get 200
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  // ── Security headers ───────────────────────────────────────────────────

  describe('security headers', () => {
    it('includes Content-Security-Policy', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(typeof csp).toBe('string');
    });

    it('CSP contains required directives from architecture.md', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      const csp = res.headers['content-security-policy'] as string;

      // default-src 'self'
      expect(csp).toContain("default-src 'self'");

      // script-src 'self' 'unsafe-inline'
      expect(csp).toContain("script-src 'self' 'unsafe-inline'");

      // style-src 'self' 'unsafe-inline'
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");

      // frame-src with all required origins
      expect(csp).toContain('frame-src');
      expect(csp).toContain("'self'");
      expect(csp).toContain('trace.playwright.dev');
      expect(csp).toContain('loom.com');
      expect(csp).toContain('www.loom.com');
      expect(csp).toContain('youtube.com');
      expect(csp).toContain('www.youtube.com');
      expect(csp).toContain('youtube-nocookie.com');
      expect(csp).toContain('vimeo.com');
      expect(csp).toContain('player.vimeo.com');

      // img-src 'self' data:
      expect(csp).toContain("img-src 'self' data:");

      // media-src 'self'
      expect(csp).toContain("media-src 'self'");

      // connect-src 'self'
      expect(csp).toContain("connect-src 'self'");
    });

    it('includes Cross-Origin-Opener-Policy: same-origin (DD-028 I7)', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    });

    it('includes Strict-Transport-Security (HSTS)', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      const hsts = res.headers['strict-transport-security'];
      expect(hsts).toBeDefined();
      expect(typeof hsts).toBe('string');
      // Should contain max-age directive
      expect(hsts as string).toContain('max-age=');
    });

    it('includes X-Content-Type-Options: nosniff', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('includes X-DNS-Prefetch-Control header', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['x-dns-prefetch-control']).toBeDefined();
    });

    it('includes X-Download-Options header', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['x-download-options']).toBeDefined();
    });
  });

  // ── Rate-limit headers ─────────────────────────────────────────────────

  describe('rate-limit headers', () => {
    it('includes X-RateLimit-Limit header', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
    });

    it('rate limit is set to 600', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['x-ratelimit-limit']).toBe('600');
    });

    it('includes X-RateLimit-Remaining header', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Test suite — GET /health 503 readiness paths
//
// INFRA-002 critical test path (from .argos/INFRA-002/brief.md):
//   "/health integration test toggles bootState and asserts 503 → 200 transition."
//
// The 503 response body shape during boot/migration is per src/app.ts L380-385:
//   { status: bootState, bootState, dbReady: false }
// ---------------------------------------------------------------------------

describe('GET /health — 503 readiness paths', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ testing: true, db: ':memory:' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 503 when bootState is "booting"', async () => {
    app.setBootState('booting');
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
  });

  it('returns correct body shape when bootState is "booting"', async () => {
    app.setBootState('booting');
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(JSON.parse(res.body)).toEqual({
      status: 'booting',
      bootState: 'booting',
      dbReady: false,
    });
  });

  it('returns 503 when bootState is "migrating"', async () => {
    app.setBootState('migrating');
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
  });

  it('returns correct body shape when bootState is "migrating"', async () => {
    app.setBootState('migrating');
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(JSON.parse(res.body)).toEqual({
      status: 'migrating',
      bootState: 'migrating',
      dbReady: false,
    });
  });

  it('does not perform the SELECT 1 DB check while bootState !== "ready"', async () => {
    // Per src/app.ts L379-386 the booting/migrating branch returns immediately
    // without touching the DB. Verifying via dbReady: false in the body —
    // a SELECT 1 succeeded path would have set dbReady: true.
    app.setBootState('booting');
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(JSON.parse(res.body)).toMatchObject({ dbReady: false });
  });

  it('transitions 503 → 200 as bootState moves booting → migrating → ready', async () => {
    app.setBootState('booting');
    const r1 = await app.inject({ method: 'GET', url: '/health' });
    expect(r1.statusCode).toBe(503);
    expect(JSON.parse(r1.body)).toMatchObject({ bootState: 'booting' });

    app.setBootState('migrating');
    const r2 = await app.inject({ method: 'GET', url: '/health' });
    expect(r2.statusCode).toBe(503);
    expect(JSON.parse(r2.body)).toMatchObject({ bootState: 'migrating' });

    app.setBootState('ready');
    const r3 = await app.inject({ method: 'GET', url: '/health' });
    expect(r3.statusCode).toBe(200);
    expect(JSON.parse(r3.body)).toMatchObject({
      status: 'ok',
      bootState: 'ready',
      dbReady: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Test suite — 404 for unknown routes
// ---------------------------------------------------------------------------

describe('unknown routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ testing: true, db: ':memory:' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('redirects to /setup for an unregistered route when users table is empty (AUTH-001 Branch 1)', async () => {
    // The empty-users redirect (Branch 1 of the global preHandler) fires
    // before routing for any non-exempt path, so we never reach a 404.
    // This is the correct behavior per `better-auth-session-and-api-tokens.md`.
    const res = await app.inject({ method: 'GET', url: '/nonexistent' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/setup');
  });
});

// ---------------------------------------------------------------------------
// Test suite — Shutdown lifecycle
// ---------------------------------------------------------------------------

describe('shutdown lifecycle', () => {
  it('app.close() completes without error', async () => {
    const app = await buildApp({ testing: true, db: ':memory:' });
    // Should not throw
    await expect(app.close()).resolves.toBeUndefined();
  });

  it('DI seam close() methods are called during shutdown', async () => {
    // Track close calls with minimal DI doubles
    let eventBusClosed = false;
    let artifactStorageClosed = false;
    let aiProviderClosed = false;

    const app = await buildApp({
      testing: true,
      db: ':memory:',
      eventBus: {
        close: async () => { eventBusClosed = true; },
      },
      artifactStorage: {
        close: async () => { artifactStorageClosed = true; },
      },
      aiProvider: {
        close: async () => { aiProviderClosed = true; },
      },
    });

    await app.close();

    expect(eventBusClosed).toBe(true);
    expect(artifactStorageClosed).toBe(true);
    expect(aiProviderClosed).toBe(true);
  });

  it('ORM is closed during shutdown (decorated orm.close())', async () => {
    const app = await buildApp({ testing: true, db: ':memory:' });
    const orm = app.orm;
    expect(orm).toBeDefined();

    await app.close();

    // After close, ORM connection should be closed.
    // MikroORM v7 isConnected() returns a Promise.
    const connected = await orm.isConnected();
    expect(connected).toBe(false);
  });
});
