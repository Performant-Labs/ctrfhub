import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app.js';
import { buildAuth } from '../../../auth.js';

async function seedAuthSchema(dbPath: string): Promise<void> {
  const auth = await buildAuth(dbPath);
  const ctx = await auth.$context;
  await (ctx as any).runMigrations();
}

function makeTempDbPath(): string {
  return join(tmpdir(), `ctrfhub-setup-${randomUUID()}.db`);
}

describe('T1 Empty-DB redirects', () => {
  let app: FastifyInstance;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = makeTempDbPath();
    await seedAuthSchema(dbPath);
    app = await buildApp({ testing: true, db: dbPath });
  });

  afterAll(async () => {
    await app.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it('GET /setup returns 200 with wizard HTML when DB is empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.body).toContain('Create Admin Account');
    expect(res.body).toContain('id="setup-card"');
    expect(res.body).toContain('Setup progress');
  });

  it('GET /setup shows step 1 active in progress indicator', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup' });
    expect(res.body).toContain('border-[--color-brand]');
  });

  it('browser to non-setup route 302 redirects to /setup', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/setup');
  });

  it('HTMX to non-setup route returns HX-Redirect header', async () => {
    const res = await app.inject({
      method: 'GET', url: '/runs',
      headers: { 'hx-request': 'true' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['hx-redirect']).toBe('/setup');
  });
});

describe('T1 Step 1 — Create admin', () => {
  let app: FastifyInstance;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = makeTempDbPath();
    await seedAuthSchema(dbPath);
    app = await buildApp({ testing: true, db: dbPath });
  });

  afterAll(async () => {
    await app.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it('POST /setup/step/1 creates admin and shows step 2', async () => {
    const res = await app.inject({
      method: 'POST', url: '/setup/step/1',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'admin@test.com', password: 'P@ssw0rd1234!', displayName: 'Admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Create Organization');
    expect(res.headers['set-cookie']).toMatch(/better-auth/);
  });

  it('POST /setup/step/1 fails when user already exists', async () => {
    const res = await app.inject({
      method: 'POST', url: '/setup/step/1',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'other@test.com', password: 'P@ssw0rd1234!', displayName: 'Other' },
    });
    expect(res.body).toContain('role="alert"');
    expect(res.body).toMatch(/already exists/);
  });

  it('GET /setup resumes at step 2 after step 1', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Create Organization');
  });
});

describe('T1 Step 2 — Create organization', () => {
  let app: FastifyInstance;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = makeTempDbPath();
    await seedAuthSchema(dbPath);
    app = await buildApp({ testing: true, db: dbPath });
    await app.inject({
      method: 'POST', url: '/setup/step/1',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'admin@test.com', password: 'P@ssw0rd1234!', displayName: 'Admin' },
    });
  });

  afterAll(async () => {
    await app.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it('POST /setup/step/2 creates org and shows step 3', async () => {
    const res = await app.inject({
      method: 'POST', url: '/setup/step/2',
      headers: { 'content-type': 'application/json' },
      payload: { orgName: 'Acme Corp', orgSlug: 'acme-corp' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Create First Project');
  });

  it('GET /setup resumes at step 3 after step 2', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup' });
    expect(res.body).toContain('Create First Project');
  });
});

describe('T1 Step 3 — Create project', () => {
  let app: FastifyInstance;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = makeTempDbPath();
    await seedAuthSchema(dbPath);
    app = await buildApp({ testing: true, db: dbPath });
    await app.inject({
      method: 'POST', url: '/setup/step/1',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'admin@test.com', password: 'P@ssw0rd1234!', displayName: 'Admin' },
    });
    await app.inject({
      method: 'POST', url: '/setup/step/2',
      headers: { 'content-type': 'application/json' },
      payload: { orgName: 'Acme Corp', orgSlug: 'acme-corp' },
    });
  });

  afterAll(async () => {
    await app.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it('POST /setup/step/3 creates project with API token', async () => {
    const res = await app.inject({
      method: 'POST', url: '/setup/step/3',
      headers: { 'content-type': 'application/json' },
      payload: { projectName: 'My Tests', projectSlug: 'my-tests', description: 'desc' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('CI/CD Setup');
    expect(res.body).toMatch(/ctrf_[a-zA-Z0-9]+/);
  });

  it('GET /setup resumes at step 4 after step 3', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup' });
    expect(res.body).toContain('CI/CD Setup');
  });
});

describe('T1 Step 4 — Complete setup + 410', () => {
  let app: FastifyInstance;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = makeTempDbPath();
    await seedAuthSchema(dbPath);
    app = await buildApp({ testing: true, db: dbPath });
    await app.inject({
      method: 'POST', url: '/setup/step/1',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'admin@test.com', password: 'P@ssw0rd1234!', displayName: 'Admin' },
    });
    await app.inject({
      method: 'POST', url: '/setup/step/2',
      headers: { 'content-type': 'application/json' },
      payload: { orgName: 'Acme Corp', orgSlug: 'acme-corp' },
    });
    await app.inject({
      method: 'POST', url: '/setup/step/3',
      headers: { 'content-type': 'application/json' },
      payload: { projectName: 'My Tests', projectSlug: 'my-tests', description: '' },
    });
  });

  afterAll(async () => {
    await app.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it('POST /setup/step/4 sends HX-Redirect to /', async () => {
    const res = await app.inject({
      method: 'POST', url: '/setup/step/4',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['hx-redirect']).toBe('/');
  });

  it('GET /setup returns 410 after completion', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup' });
    expect(res.statusCode).toBe(410);
    expect(res.body).toContain('no longer available');
  });
});

describe('T1 Env-var seed path', () => {
  let dbPath: string;
  const origEnv: Record<string, string | undefined> = { ...process.env };

  afterEach(async () => {
    try { unlinkSync(dbPath); } catch {}
    for (const k of Object.keys(origEnv)) process.env[k] = origEnv[k];
    for (const k of Object.keys(process.env))
      if (!(k in origEnv)) delete process.env[k];
  });

  it('buildApp seeds user+org from env vars, /setup → 410', async () => {
    dbPath = makeTempDbPath();
    await seedAuthSchema(dbPath);
    process.env['CTRFHUB_INITIAL_ADMIN_EMAIL'] = 'bootstrap@test.com';
    process.env['CTRFHUB_INITIAL_ADMIN_PASSWORD'] = 'B00tstr@p!#P4ss';
    process.env['CTRFHUB_INITIAL_ORG_NAME'] = 'BootstrapOrg';
    const app = await buildApp({ testing: true, db: dbPath });
    const res = await app.inject({ method: 'GET', url: '/setup' });
    expect(res.statusCode).toBe(410);
    expect(res.body).toContain('no longer available');
    await app.close();
  });
});
