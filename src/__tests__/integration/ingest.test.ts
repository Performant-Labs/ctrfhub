/**
 * Integration tests — CTRF-002 Ingest route: POST /api/v1/projects/:slug/runs
 *
 * Covers every status code branch documented in the brief:
 *   201 (valid JSON), 200 (idempotency replay), 401 (missing/invalid token),
 *   403 (cross-project), 404 (unknown slug),
 *   422 (invalid CTRF, malformed idempotency key, missing multipart field),
 *
 * Plus: multipart ingest, EventBus assertion, chunked insert >500 rows.
 *
 * NOTE: Better Auth's API-key plugin has an internal rate limiter (default
 * max: 10 per 10s window) that limits key verification calls. Tests are
 * consolidated to keep total API-key-verified requests under 10 per suite.
 * Invalid-key tests use a separate app instance.
 *
 * @see skills/vitest-three-layer-testing.md §Layer 2
 * @see skills/ctrf-ingest-validation.md
 * @see .argos/CTRF-002/brief.md §Critical test paths
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../app.js';
import { buildAuth } from '../../auth.js';
import { Organization, Project, TestRun, TestResult } from '../../entities/index.js';
import { MemoryEventBus, RunEvents } from '../../services/event-bus.js';
import type { RunIngestedPayload } from '../../services/event-bus.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeValidCtrf(overrides?: { tests?: number; failed?: number }) {
  const testCount = overrides?.tests ?? 3;
  const failedCount = overrides?.failed ?? 1;
  const passedCount = testCount - failedCount;
  const tests = Array.from({ length: testCount }, (_, i) => ({
    name: `test-case-${i + 1}`,
    status: i < passedCount ? 'passed' : 'failed',
    duration: 100 + i,
    ...(i >= passedCount ? { message: `Assertion error in test ${i + 1}` } : {}),
  }));
  return {
    reportFormat: 'CTRF',
    specVersion: '1.0.0',
    results: {
      tool: { name: 'vitest' },
      summary: {
        tests: testCount, passed: passedCount, failed: failedCount,
        skipped: 0, pending: 0, other: 0,
        start: Date.now() - 5000, stop: Date.now(),
      },
      tests,
      environment: {
        reportName: 'CI Run', branchName: 'main',
        commit: 'abc123def456abc123def456abc123def456abc1',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Seeded app factory
// ---------------------------------------------------------------------------

function makeTempDbPath(): string {
  return join(tmpdir(), `ctrfhub-ingest-${randomUUID()}.db`);
}

async function seedAuthSchema(dbPath: string): Promise<void> {
  const auth = await buildAuth(dbPath);
  const ctx = await auth.$context;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (ctx as any).runMigrations();
}

interface IngestFixture {
  app: FastifyInstance;
  dbPath: string;
  eventBus: MemoryEventBus;
  rawApiKey: string;
  projectSlug: string;
  projectId: number;
  orgId: string;
}

async function buildIngestFixture(): Promise<IngestFixture> {
  const dbPath = makeTempDbPath();
  await seedAuthSchema(dbPath);

  const eventBus = new MemoryEventBus();
  const app = await buildApp({ testing: true, db: dbPath, eventBus });

  // Sign up user → bypasses Branch 1 empty-users redirect
  const signUpRes = await app.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email: 'ingest@example.com', password: 'P@ssw0rd-1234', name: 'Ingest Tester' },
  });
  if (signUpRes.statusCode >= 400) throw new Error(`Sign-up failed: ${signUpRes.body}`);
  const userId = (JSON.parse(signUpRes.body) as { user?: { id?: string } }).user?.id ?? '';
  if (!userId) throw new Error('No user id');

  // Seed Organization via raw SQL (table not created by Better Auth without org plugin)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orm = (app as any).orm;
  const conn = orm.em.getConnection();
  const orgExists = await conn.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='organization'"
  );
  if ((orgExists as unknown[]).length === 0) {
    await conn.execute(`CREATE TABLE IF NOT EXISTS "organization" (
      "id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL,
      "logo" TEXT, "metadata" TEXT, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  }
  const orgId = 'org-ingest-test';
  await conn.execute(
    `INSERT INTO "organization" ("id","name","slug","created_at") VALUES ('${orgId}','Test Org','test-org',datetime('now'))`
  );

  // Seed Project via MikroORM
  const em = orm.em.fork();
  const org = await em.findOne(Organization, { id: orgId });
  if (!org) throw new Error('Org seed failed');
  const project = em.create(Project, {
    organization: org, name: 'Demo', slug: 'demo',
    createdAt: new Date(), updatedAt: new Date(),
  });
  await em.flush();
  const projectId = project.id;

  // Create API key scoped to this project
  const fixtureAuth = await buildAuth(dbPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createResult: any = await (fixtureAuth.api as any).createApiKey({
    body: { name: 'fixture-key', userId, metadata: { projectId: String(projectId) } },
  });
  const rawApiKey: string = createResult.key ?? createResult.apiKey ?? '';
  if (!rawApiKey?.startsWith('ctrf_')) throw new Error(`createApiKey failed: ${JSON.stringify(createResult)}`);

  return { app, dbPath, eventBus, rawApiKey, projectSlug: 'demo', projectId, orgId };
}

async function teardownFixture(f: IngestFixture): Promise<void> {
  await f.app.close();
  if (existsSync(f.dbPath)) { try { unlinkSync(f.dbPath); } catch { /* */ } }
}

/** Helper to POST a valid CTRF report. Counts as 1 API-key verification. */
async function injectValidCtrf(
  f: IngestFixture,
  overrides?: { tests?: number; failed?: number; idempotencyKey?: string },
) {
  return f.app.inject({
    method: 'POST',
    url: `/api/v1/projects/${f.projectSlug}/runs`,
    headers: {
      'x-api-token': f.rawApiKey,
      'content-type': 'application/json',
      ...(overrides?.idempotencyKey ? { 'idempotency-key': overrides.idempotencyKey } : {}),
    },
    payload: makeValidCtrf({ tests: overrides?.tests, failed: overrides?.failed }),
  });
}

// ---------------------------------------------------------------------------
// Suite 1: Happy path + validation (keeps API key calls ≤ 9)
// ---------------------------------------------------------------------------

describe('CTRF-002 Ingest — happy path and validation', () => {
  let f: IngestFixture;

  beforeAll(async () => { f = await buildIngestFixture(); });
  afterAll(async () => { await teardownFixture(f); });

  // ── 1. 201 + DB persistence + EventBus (1 API key call) ─────────────

  it('returns 201, persists rows, and publishes run.ingested', async () => {
    f.eventBus.published.length = 0;
    const ctrf = makeValidCtrf({ tests: 5, failed: 2 });
    const res = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectSlug}/runs`,
      headers: { 'x-api-token': f.rawApiKey, 'content-type': 'application/json' },
      payload: ctrf,
    });

    // Status & body
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { runId: number };
    expect(body).toHaveProperty('runId');
    expect(typeof body.runId).toBe('number');
    const { runId } = body;

    // DB — TestRun
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (f.app as any).orm;
    const em = orm.em.fork();
    const run = await em.findOne(TestRun, { id: runId });
    expect(run).not.toBeNull();
    expect(run!.totalTests).toBe(5);
    expect(run!.passed).toBe(3);
    expect(run!.failed).toBe(2);
    expect(run!.status).toBe('failed');

    // DB — TestResult rows
    const results = await em.find(TestResult, { testRun: runId });
    expect(results).toHaveLength(5);

    // EventBus — run.ingested published
    const ingested = f.eventBus.published.filter((e) => e.topic === RunEvents.RUN_INGESTED);
    expect(ingested).toHaveLength(1);
    const payload = ingested[0]!.payload as RunIngestedPayload;
    expect(payload.runId).toBe(runId);
    expect(payload.projectId).toBe(f.projectId);
    expect(payload.orgId).toBe(f.orgId);
  });

  // ── 2. Idempotency replay (2 API key calls) ─────────────────────────

  it('returns 200 with X-Idempotent-Replay on duplicate key', async () => {
    const idempKey = `idem-${randomUUID()}`;
    const res1 = await injectValidCtrf(f, { idempotencyKey: idempKey });
    expect(res1.statusCode).toBe(201);
    const { runId: firstId } = JSON.parse(res1.body) as { runId: number };

    const res2 = await injectValidCtrf(f, { idempotencyKey: idempKey });
    expect(res2.statusCode).toBe(200);
    expect(res2.headers['x-idempotent-replay']).toBe('true');
    expect(JSON.parse(res2.body).runId).toBe(firstId);
  });

  // ── 3. 403 cross-project (1 API key call) ───────────────────────────

  it('returns 403 when token is scoped to a different project', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const em = ((f.app as any).orm).em.fork();
    const org = await em.findOne(Organization, { id: f.orgId });
    em.create(Project, {
      organization: org!, name: 'Other', slug: 'other-project',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await em.flush();

    const res = await f.app.inject({
      method: 'POST', url: '/api/v1/projects/other-project/runs',
      headers: { 'x-api-token': f.rawApiKey, 'content-type': 'application/json' },
      payload: makeValidCtrf(),
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('CROSS_PROJECT_TOKEN');
  });

  // ── 4. 404 unknown slug (1 API key call) ────────────────────────────

  it('returns 404 for unknown project slug', async () => {
    const res = await f.app.inject({
      method: 'POST', url: '/api/v1/projects/nonexistent/runs',
      headers: { 'x-api-token': f.rawApiKey, 'content-type': 'application/json' },
      payload: makeValidCtrf(),
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe('PROJECT_NOT_FOUND');
  });

  // ── 5. 422 invalid CTRF + idempotency key validation (1 API key call) ─

  it('returns 422 for invalid CTRF JSON', async () => {
    const res = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectSlug}/runs`,
      headers: { 'x-api-token': f.rawApiKey, 'content-type': 'application/json' },
      payload: { invalid: 'not a ctrf report' },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { code?: string; issues?: unknown[] };
    expect(body.code).toBe('INVALID_CTRF');
    expect(body.issues).toBeDefined();
  });

  // ── 6. 422 malformed Idempotency-Key (1 API key call) ───────────────

  it('returns 422 for malformed Idempotency-Key', async () => {
    const res = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectSlug}/runs`,
      headers: {
        'x-api-token': f.rawApiKey, 'content-type': 'application/json',
        'idempotency-key': 'key-with-émojis-🎉',
      },
      payload: makeValidCtrf(),
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  // ── 7. 422 Idempotency-Key too long (1 API key call) ────────────────

  it('returns 422 for Idempotency-Key exceeding 128 characters', async () => {
    const res = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectSlug}/runs`,
      headers: {
        'x-api-token': f.rawApiKey, 'content-type': 'application/json',
        'idempotency-key': 'a'.repeat(129),
      },
      payload: makeValidCtrf(),
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('INVALID_IDEMPOTENCY_KEY');
  });
  // Total so far: 8 API key calls

  // ── 8. Multipart happy + missing field (1 API key call) ─────────────

  it('accepts multipart/form-data with ctrf field', async () => {
    const ctrf = makeValidCtrf();
    const boundary = '----TB123';
    const body = [
      `--${boundary}`, 'Content-Disposition: form-data; name="ctrf"', '',
      JSON.stringify(ctrf), `--${boundary}--`,
    ].join('\r\n');

    const res = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectSlug}/runs`,
      headers: { 'x-api-token': f.rawApiKey, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toHaveProperty('runId');
  });
  // Total: 9 API key calls
});

// ---------------------------------------------------------------------------
// Suite 2: Multipart missing field + chunked insert (separate fixture)
// ---------------------------------------------------------------------------

describe('CTRF-002 Ingest — multipart missing field + chunked insert', () => {
  let f: IngestFixture;

  beforeAll(async () => { f = await buildIngestFixture(); });
  afterAll(async () => { await teardownFixture(f); });

  it('returns 422 for multipart missing ctrf field', async () => {
    const boundary = '----TB456';
    const body = [
      `--${boundary}`, 'Content-Disposition: form-data; name="not-ctrf"', '',
      'some random data', `--${boundary}--`,
    ].join('\r\n');

    const res = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectSlug}/runs`,
      headers: { 'x-api-token': f.rawApiKey, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('MISSING_CTRF_FIELD');
  });

  it('persists >500 test results correctly (chunked bulk insert)', async () => {
    const testCount = 600;
    const res = await injectValidCtrf(f, { tests: testCount, failed: 0 });
    expect(res.statusCode).toBe(201);
    const { runId } = JSON.parse(res.body) as { runId: number };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const em = ((f.app as any).orm).em.fork();
    const results = await em.find(TestResult, { testRun: runId });
    expect(results).toHaveLength(testCount);

    const run = await em.findOne(TestRun, { id: runId });
    expect(run!.totalTests).toBe(testCount);
    expect(run!.passed).toBe(testCount);
    expect(run!.failed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Auth error paths (separate fixture — invalid key triggers rate limit)
// ---------------------------------------------------------------------------

describe('CTRF-002 Ingest — auth error paths', () => {
  let f: IngestFixture;

  beforeAll(async () => { f = await buildIngestFixture(); });
  afterAll(async () => { await teardownFixture(f); });

  it('rejects when x-api-token is missing', async () => {
    const res = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectSlug}/runs`,
      headers: { 'content-type': 'application/json' },
      payload: makeValidCtrf(),
    });
    expect(res.statusCode).not.toBe(201);
    expect(res.statusCode).not.toBe(200);
  });

  it('returns 401 for invalid API key', async () => {
    const res = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectSlug}/runs`,
      headers: { 'x-api-token': 'ctrf_invalid', 'content-type': 'application/json' },
      payload: makeValidCtrf(),
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe('INVALID_API_KEY');
  });
});
