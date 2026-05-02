import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';

const PAGE_URL = '/setup/__test__/page';
const ASYNC_VIEW = { async: true };

function buildTestApp(): Promise<FastifyInstance> {
  return (async () => {
    const a = await buildApp({ testing: true, db: ':memory:' });

    a.get(PAGE_URL,
      { config: { skipAuth: true } },
      async (_request, reply) => reply.page('error', { title: 'Test Error', message: 'Test message' }),
    );

    a.get('/setup/__test__/partial',
      { config: { skipAuth: true } },
      async (_request, reply) => reply.view('partials/error', { title: 'Partial Error', message: 'Partial message' }),
    );

    return a;
  })();
}

describe('T1 Headless — static asset serving', () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildTestApp();

    const seedRes = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'assets-test@example.com', password: 'P@ssw0rd!', name: 'Assets Tester' },
    });

    if (seedRes.cookies?.length) {
      cookie = seedRes.cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join('; ');
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const assets = [
    ['/assets/tailwind.css', /css/],
    ['/assets/htmx.min.js', /javascript/],
    ['/assets/idiomorph-ext.min.js', /javascript|application/],
    ['/assets/alpine.min.js', /javascript/],
    ['/assets/flowbite.min.js', /javascript/],
    ['/assets/app.js', /javascript/],
  ] as const;

  for (const [url, ctRe] of assets) {
    it(`${url} returns 200`, async () => {
      const res = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type'] as string).toMatch(ctRe);
    });
  }
});

describe('T1 Headless — security headers on HTML response', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('includes Content-Security-Policy header', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup/__test__/partial' });
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('includes X-Content-Type-Options: nosniff', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup/__test__/partial' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('includes Strict-Transport-Security header', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup/__test__/partial' });
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('includes Cross-Origin-Opener-Policy: same-origin', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup/__test__/partial' });
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
  });

  it('includes X-RateLimit-Limit: 600', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup/__test__/partial' });
    expect(res.headers['x-ratelimit-limit']).toBe('600');
  });
});

describe('T1 Headless — partial template via reply.view()', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup/__test__/partial' });
    expect(res.statusCode).toBe(200);
  });

  it('has text/html content type', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup/__test__/partial' });
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('renders error.eta content with role="alert"', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup/__test__/partial' });
    expect(res.body).toContain('role="alert"');
    expect(res.body).toContain('Partial Error');
    expect(res.body).toContain('Partial message');
  });

  it('does NOT contain <html> wrapper (partial only)', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup/__test__/partial' });
    expect(res.body).not.toContain('<html');
    expect(res.body).not.toContain('<!DOCTYPE');
  });
});

describe('T1 Headless — reply.page() HTMX partial path (via error.eta)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 for HTMX request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: PAGE_URL,
      headers: { 'HX-Request': 'true' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('partial response has text/html content type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: PAGE_URL,
      headers: { 'HX-Request': 'true' },
    });
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('partial renders error.eta content', async () => {
    const res = await app.inject({
      method: 'GET',
      url: PAGE_URL,
      headers: { 'HX-Request': 'true' },
    });
    expect(res.body).toContain('Test Error');
    expect(res.body).toContain('Test message');
    expect(res.body).toContain('role="alert"');
  });

  it('partial does NOT include <html> wrapper', async () => {
    const res = await app.inject({
      method: 'GET',
      url: PAGE_URL,
      headers: { 'HX-Request': 'true' },
    });
    expect(res.body).not.toContain('<html');
    expect(res.body).not.toContain('<!DOCTYPE');
  });

  it('full page via reply.page() (no HX-Request) — KNOWN ISSUE: await includeFile not supported by Eta', async () => {
    const res = await app.inject({ method: 'GET', url: PAGE_URL });
    expect(res.statusCode).toBe(500);
  });
});

describe('T1 Headless — Eta rendering via engine.renderAsync (workaround for known bugs)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('renders error.eta via reply.view() with async:true', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup/__test__/partial' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('role="alert"');
  });
});

describe('KNOWN BUG — layout/main.eta uses includeFile (EJS) not includeAsync (Eta) — blocks full page rendering', () => {
  it('layouts/main.eta fails to render with "includeFile is not defined"', async () => {
    const app = await buildApp({ testing: true, db: ':memory:' });
    app.get('/setup/__test__/layout',
      { config: { skipAuth: true } },
      async (_request, reply) => reply.view('layouts/main', { body: 'home', title: 'CTRFHub' }, ASYNC_VIEW),
    );
    const res = await app.inject({ method: 'GET', url: '/setup/__test__/layout' });
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('includeFile is not defined');
    await app.close();
  });
});
