/**
 * Integration tests — static-asset auth bypass (ctrfhub-docker-build-fix).
 *
 * Layer 2: `fastify.inject()` with SQLite in-memory.
 *
 * Covers the Branch 0 early-return added to the global `onRequest` auth hook
 * in `src/app.ts`: any `/assets/*` request must bypass auth entirely and be
 * served by `@fastify/static` — even with NO session cookie and NO API token.
 *
 * The two properties under test (both required by acceptance criterion 3 of
 * the story brief):
 *   1. `/assets/*` is reachable WITHOUT auth (no /setup or /login redirect).
 *   2. The auth posture for every NON-asset route is unchanged — i.e. Branch 0
 *      did not weaken auth for anything that does not start with `/assets/`.
 *
 * @see src/app.ts §9 — global onRequest auth hook, Branch 0
 * @see .argos/stories/ctrfhub-docker-build-fix/feature-handoff.md
 * @see skills/vitest-three-layer-testing.md §Layer 2
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { buildAuth } from '../../auth.js';

// ---------------------------------------------------------------------------
// Helpers — temp-file SQLite + Better Auth schema seeding.
//
// Branch 1 of the auth hook reads `em.count(User)`. An in-memory DB never has
// the Better Auth `user` table, so to exercise Branches 3/5 (users exist) we
// need a temp-file DB with Better Auth's schema migrated and a user signed up.
// Mirrors the fixture pattern in auth.test.ts.
// ---------------------------------------------------------------------------

async function seedAuthSchema(dbPath: string): Promise<void> {
  const auth = await buildAuth(dbPath);
  const ctx = await auth.$context;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (ctx as any).runMigrations();
}

function makeTempDbPath(): string {
  return join(tmpdir(), `ctrfhub-buildfix-${randomUUID()}.db`);
}

// ---------------------------------------------------------------------------
// The client assets the layout (src/views/layouts/main.eta) references.
// Production serves them from dist/assets/; tests serve them from src/assets/
// (both resolve via `path.join(__dirname, 'assets')`).
//
// VENDORED_JS — the five files written by the `postinstall` hook
// (scripts/copy-vendor-assets.mjs). These are the direct subject of Bug 2
// (vendored client JS landing in the wrong directory) and are reliably
// present after `npm install` runs the postinstall hook. They get the full
// "returns 200" assertion.
//
// /assets/tailwind.css is a *build-output* artifact produced by
// `npm run css:build` (Tailwind CLI), NOT by the postinstall hook, and is
// gitignored. Whether the 200 assertion can run for it depends on whether the
// CSS build has been run in this environment — so it gets a conditional 200
// check, but it ALWAYS gets the bypass-no-redirect assertion (Branch 0 keys
// on the path prefix, independent of whether the file exists on disk).
// ---------------------------------------------------------------------------
const VENDORED_JS = [
  '/assets/htmx.min.js',
  '/assets/idiomorph-ext.min.js',
  '/assets/alpine.min.js',
  '/assets/flowbite.min.js',
  '/assets/app.js',
] as const;

// Every asset path the layout references — used for the bypass-no-redirect
// assertion, which holds regardless of whether the file exists on disk.
const ALL_ASSET_PATHS = ['/assets/tailwind.css', ...VENDORED_JS] as const;

// ---------------------------------------------------------------------------
// Suite A — /assets/* is reachable WITHOUT authentication (Branch 0)
//
// On a fresh DB the users table is empty, so Branch 1 of the auth hook would
// redirect ANY non-exempt request to /setup. Branch 0 must short-circuit
// before Branch 1 ever runs. We send NO cookie and NO x-api-token header.
// ---------------------------------------------------------------------------

describe('static-asset auth bypass — /assets/* reachable without auth (Branch 0)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ testing: true, db: ':memory:' });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── The five postinstall-vendored JS files — full 200 assertion ──────────
  for (const url of VENDORED_JS) {
    it(`${url} returns 200 with no session cookie and no API token`, async () => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
    });
  }

  // ── Bypass-no-redirect — holds for ALL asset paths regardless of file
  //    existence, because Branch 0 keys on the path prefix, not the file ────
  for (const url of ALL_ASSET_PATHS) {
    it(`${url} is NOT redirected to /setup or /login (Branch 0 short-circuits)`, async () => {
      const res = await app.inject({ method: 'GET', url });
      // A 302 here would mean Branch 1 (empty-users → /setup) or Branch 5
      // (unauthenticated → /login) ran instead of Branch 0. Status is either
      // 200 (file present) or 404 (file absent) — never a redirect.
      expect(res.statusCode).not.toBe(302);
      expect(res.headers.location).toBeUndefined();
      expect([200, 404]).toContain(res.statusCode);
    });

    it(`${url} does not emit an HX-Redirect header for HTMX requests`, async () => {
      // HTMX clients fetching an asset must not be told to navigate away.
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { 'HX-Request': 'true' },
      });
      expect(res.headers['hx-redirect']).toBeUndefined();
      expect([200, 404]).toContain(res.statusCode);
    });
  }

  it('serves real file bytes, not an empty redirect body', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/htmx.min.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type'] as string).toMatch(/javascript/);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Suite B — @fastify/static still returns a genuine 404 for missing assets
//
// Branch 0 only skips the auth hook; it must NOT turn /assets/* into an
// auth-free catch-all that masks missing files. A genuinely-absent asset
// must still 404 (and must NOT be redirected to /setup or /login either).
// ---------------------------------------------------------------------------

describe('static-asset auth bypass — missing assets still 404 (not redirected)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ testing: true, db: ':memory:' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /assets/does-not-exist.js returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/does-not-exist.js' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /assets/does-not-exist.js is NOT redirected to /setup', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/does-not-exist.js' });
    expect(res.statusCode).not.toBe(302);
    expect(res.headers.location).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite C — auth posture for NON-asset routes is UNCHANGED
//
// Branch 0 keys strictly on `rawPath.startsWith('/assets/')`. Every route
// that does NOT start with /assets/ must still flow through Branches 1–5
// exactly as before. These assertions are the regression guard: if a future
// edit widens the bypass, one of them fails.
// ---------------------------------------------------------------------------

describe('static-asset auth bypass — non-asset routes still gate as before', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ testing: true, db: ':memory:' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / (empty users) still redirects to /setup — Branch 1 unchanged', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/setup');
  });

  it('GET /nonexistent (empty users) still redirects to /setup — Branch 1 unchanged', async () => {
    const res = await app.inject({ method: 'GET', url: '/nonexistent' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/setup');
  });

  it('GET /dashboard (empty users) still redirects to /setup — Branch 1 unchanged', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/setup');
  });

  it('GET /health remains exempt and returns 200 (skipAuth, unaffected by Branch 0)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('a route whose path merely contains "assets" but does not start with /assets/ still gates', async () => {
    // `/my-assets` and `/assetsx` must NOT match `startsWith('/assets/')`.
    // They are non-exempt → Branch 1 redirects to /setup on an empty DB.
    const res1 = await app.inject({ method: 'GET', url: '/my-assets' });
    expect(res1.statusCode).toBe(302);
    expect(res1.headers.location).toBe('/setup');

    const res2 = await app.inject({ method: 'GET', url: '/assetsx' });
    expect(res2.statusCode).toBe(302);
    expect(res2.headers.location).toBe('/setup');
  });
});

// ---------------------------------------------------------------------------
// Suite D — non-asset routes gate AFTER the app is configured (users exist)
//
// Once the users table is non-empty, Branch 1 no longer fires; an
// unauthenticated non-asset request must fall through to Branch 5 and be
// redirected to /login. This proves Branch 0 did not collapse Branches 2–5
// for non-asset traffic. Meanwhile /assets/* still bypasses everything.
// ---------------------------------------------------------------------------

describe('static-asset auth bypass — Branch 5 still gates non-asset routes when users exist', () => {
  let app: FastifyInstance;
  let dbPath: string;

  beforeAll(async () => {
    // Temp-file DB + Better Auth schema so the `user` table exists and a
    // signed-up user makes Branch 1 (empty-users → /setup) stop firing.
    dbPath = makeTempDbPath();
    await seedAuthSchema(dbPath);
    app = await buildApp({ testing: true, db: dbPath });

    const signUpRes = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: {
        email: 'bypass-test@example.com',
        password: 'P@ssw0rd-test-1234',
        name: 'Bypass Tester',
      },
    });
    if (signUpRes.statusCode >= 400) {
      throw new Error(
        `Sign-up failed in fixture (status ${signUpRes.statusCode}): ${signUpRes.body}`,
      );
    }
  });

  afterAll(async () => {
    await app.close();
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
      } catch {
        // best effort
      }
    }
  });

  it('unauthenticated GET / now redirects to /login — Branch 5 unchanged', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('unauthenticated HTMX GET /dashboard gets HX-Redirect: /login (200) — Branch 5 unchanged', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard',
      headers: { 'HX-Request': 'true' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['hx-redirect']).toBe('/login');
  });

  it('an invalid x-api-token on a non-asset route still returns 401 — Branch 3 unchanged', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard',
      headers: { 'x-api-token': 'ctrf_definitely-not-a-real-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('/assets/* still bypasses auth even after users exist', async () => {
    // No cookie, no token — Branch 0 must still short-circuit.
    const res = await app.inject({ method: 'GET', url: '/assets/htmx.min.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
  });

  it('an invalid x-api-token on an /assets/* route is ignored — asset still served', async () => {
    // Branch 0 returns before Branch 3, so even a bogus token cannot turn an
    // asset request into a 401.
    const res = await app.inject({
      method: 'GET',
      url: '/assets/app.js',
      headers: { 'x-api-token': 'ctrf_definitely-not-a-real-key' },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Suite E — query strings do not break the Branch 0 path match
//
// Branch 0 matches against `request.url.split('?')[0]`. A cache-busting
// query string (`?v=2`) on an asset URL must still bypass auth.
// ---------------------------------------------------------------------------

describe('static-asset auth bypass — query strings on asset URLs', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ testing: true, db: ':memory:' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /assets/htmx.min.js?v=2 still bypasses auth and returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/htmx.min.js?v=2' });
    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
  });
});
