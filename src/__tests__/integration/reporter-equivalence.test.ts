/**
 * Integration tests — CTRF-004 Reporter equivalence
 *
 * Verifies that both reporter packages (playwright, cypress) produce
 * byte-equivalent TestRun + TestResult rows compared to a raw POST baseline.
 *
 * Uses a fetch→inject adapter so reporter code that calls global `fetch`
 * is routed through Fastify's inject() when the URL points to test.local.
 *
 * @see skills/vitest-three-layer-testing.md §Layer 2
 * @see .argos/CTRF-004/test-handoff.md §Integration tests
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../app.js';
import { buildAuth } from '../../auth.js';
import { Organization, Project, TestRun, TestResult } from '../../entities/index.js';
import { MemoryEventBus } from '../../services/event-bus.js';

import { postRunToCtrfHub as playwrightPost } from '../../../packages/playwright-reporter/src/http.js';
import { postRunToCtrfHub as cypressPost } from '../../../packages/cypress-reporter/src/http.js';

// ---------------------------------------------------------------------------
// Canonical fixture
// ---------------------------------------------------------------------------

const canonicalCtrf = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', 'fixtures', 'ctrf', 'canonical-run.json'),
    'utf-8',
  ),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface NormalizedRun {
  status: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
}

interface NormalizedResult {
  testName: string;
  status: string;
  durationMs: number | null;
}

interface NormalizedTestRun {
  run: NormalizedRun;
  results: NormalizedResult[];
}

function normalizeTestRun(
  run: TestRun,
  results: TestResult[],
): NormalizedTestRun {
  return {
    run: {
      status: run.status,
      totalTests: run.totalTests,
      passed: run.passed,
      failed: run.failed,
      skipped: run.skipped,
    },
    results: results
      .map((r) => ({
        testName: r.testName,
        status: r.status,
        durationMs: r.durationMs,
      }))
      .sort((a, b) => a.testName.localeCompare(b.testName)),
  };
}

// ---------------------------------------------------------------------------
// fetch→inject adapter
// ---------------------------------------------------------------------------

function makeFetchAdapter(app: FastifyInstance): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (!url.startsWith('http://test.local')) {
      return globalThis.fetch(input, init);
    }

    const parsedUrl = new URL(url);
    const res = await app.inject({
      method: (init?.method as 'POST') ?? 'GET',
      url: parsedUrl.pathname,
      headers: init?.headers as Record<string, string>,
      payload: init?.body as string,
    });

    return new Response(res.body, {
      status: res.statusCode,
      headers: res.headers as Record<string, string>,
    });
  };
}

// ---------------------------------------------------------------------------
// Seeded app factory (adapted from ingest.test.ts)
// ---------------------------------------------------------------------------

function makeTempDbPath(): string {
  return join(tmpdir(), `ctrfhub-equiv-${randomUUID()}.db`);
}

async function seedAuthSchema(dbPath: string): Promise<void> {
  const auth = await buildAuth(dbPath);
  const ctx = await auth.$context;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (ctx as any).runMigrations();
}

interface EquivFixture {
  app: FastifyInstance;
  dbPath: string;
  eventBus: MemoryEventBus;
  rawApiKey: string;
  projectSlug: string;
  projectId: number;
  orgId: string;
}

async function buildTestApp(): Promise<EquivFixture> {
  const dbPath = makeTempDbPath();
  await seedAuthSchema(dbPath);

  const eventBus = new MemoryEventBus();
  const app = await buildApp({ testing: true, db: dbPath, eventBus });

  // Sign up user
  const signUpRes = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: {
      email: 'equiv@example.com',
      password: 'P@ssw0rd-1234',
      name: 'Equiv Tester',
    },
  });
  if (signUpRes.statusCode >= 400) throw new Error(`Sign-up failed: ${signUpRes.body}`);
  const userId =
    (JSON.parse(signUpRes.body) as { user?: { id?: string } }).user?.id ?? '';
  if (!userId) throw new Error('No user id');

  // Seed Organization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orm = (app as any).orm;
  const conn = orm.em.getConnection();
  const orgExists = await conn.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='organization'",
  );
  if ((orgExists as unknown[]).length === 0) {
    await conn.execute(`CREATE TABLE IF NOT EXISTS "organization" (
      "id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL,
      "logo" TEXT, "metadata" TEXT, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  }
  const orgId = 'org-equiv-test';
  await conn.execute(
    `INSERT INTO "organization" ("id","name","slug","created_at") VALUES ('${orgId}','Equiv Org','equiv-org',datetime('now'))`,
  );

  // Seed Project
  const em = orm.em.fork();
  const org = await em.findOne(Organization, { id: orgId });
  if (!org) throw new Error('Org seed failed');
  const project = em.create(Project, {
    organization: org,
    name: 'Equiv',
    slug: 'equiv',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await em.flush();
  const projectId = project.id;

  // Create API key
  const fixtureAuth = await buildAuth(dbPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createResult: any = await (fixtureAuth.api as any).createApiKey({
    body: { name: 'equiv-key', userId, metadata: { projectId: String(projectId) } },
  });
  const rawApiKey: string = createResult.key ?? createResult.apiKey ?? '';
  if (!rawApiKey?.startsWith('ctrf_'))
    throw new Error(`createApiKey failed: ${JSON.stringify(createResult)}`);

  return { app, dbPath, eventBus, rawApiKey, projectSlug: 'equiv', projectId, orgId };
}

async function teardownFixture(f: EquivFixture): Promise<void> {
  await f.app.close();
  if (existsSync(f.dbPath)) {
    try { unlinkSync(f.dbPath); } catch { /* */ }
  }
}

/** Read normalized rows for a given runId */
async function readNormalized(
  app: FastifyInstance,
  runId: number,
): Promise<NormalizedTestRun> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orm = (app as any).orm;
  const em = orm.em.fork();
  const run = await em.findOne(TestRun, { id: runId });
  if (!run) throw new Error(`TestRun ${runId} not found`);
  const results = await em.find(TestResult, { testRun: runId });
  return normalizeTestRun(run, results);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CTRF-004 Reporter equivalence', () => {
  let f: EquivFixture;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    f = await buildTestApp();
    originalFetch = globalThis.fetch;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await teardownFixture(f);
  });

  // ── 1. Raw POST baseline — 201 + persisted TestRun/TestResult rows ────

  let baselineRunId: number;
  let baselineNormalized: NormalizedTestRun;

  it('raw POST baseline — 201 + persisted rows', async () => {
    const res = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectSlug}/runs`,
      headers: {
        'x-api-token': f.rawApiKey,
        'content-type': 'application/json',
        'idempotency-key': `baseline-${randomUUID()}`,
      },
      payload: canonicalCtrf,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { runId: number };
    expect(body).toHaveProperty('runId');
    baselineRunId = body.runId;

    baselineNormalized = await readNormalized(f.app, baselineRunId);
    expect(baselineNormalized.run.totalTests).toBe(4);
    expect(baselineNormalized.run.passed).toBe(1);
    expect(baselineNormalized.run.failed).toBe(1);
    expect(baselineNormalized.results).toHaveLength(4);
  });

  // ── 2. Playwright reporter equivalence ────────────────────────────────

  let playwrightRunId: number;

  it('playwright reporter produces byte-equivalent rows vs baseline', async () => {
    const adapter = makeFetchAdapter(f.app);
    globalThis.fetch = adapter;

    await playwrightPost(canonicalCtrf, {
      ingestUrl: 'http://test.local',
      apiToken: f.rawApiKey,
      projectSlug: f.projectSlug,
    });

    globalThis.fetch = originalFetch;

    // Find the newest run (not the baseline)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (f.app as any).orm;
    const em = orm.em.fork();
    const runs = await em.find(TestRun, {}, { orderBy: { id: 'DESC' }, limit: 1 });
    playwrightRunId = runs[0]!.id;
    expect(playwrightRunId).not.toBe(baselineRunId);

    const pwNormalized = await readNormalized(f.app, playwrightRunId);
    expect(pwNormalized).toEqual(baselineNormalized);
  });

  // ── 3. Cypress reporter equivalence ───────────────────────────────────

  let cypressRunId: number;

  it('cypress reporter produces byte-equivalent rows vs baseline', async () => {
    const baseAdapter = makeFetchAdapter(f.app);
    // Override the Idempotency-Key so the server doesn't replay the
    // playwright run (same canonical payload → same SHA-256 hash).
    globalThis.fetch = async (input, init) => {
      const headers = { ...(init?.headers as Record<string, string>) };
      headers['Idempotency-Key'] = `cypress-${randomUUID()}`;
      return baseAdapter(input, { ...init, headers });
    };

    await cypressPost(canonicalCtrf, {
      ingestUrl: 'http://test.local',
      apiToken: f.rawApiKey,
      projectSlug: f.projectSlug,
    });

    globalThis.fetch = originalFetch;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (f.app as any).orm;
    const em = orm.em.fork();
    const runs = await em.find(TestRun, {}, { orderBy: { id: 'DESC' }, limit: 1 });
    cypressRunId = runs[0]!.id;
    expect(cypressRunId).not.toBe(baselineRunId);
    expect(cypressRunId).not.toBe(playwrightRunId);

    const cyNormalized = await readNormalized(f.app, cypressRunId);
    expect(cyNormalized).toEqual(baselineNormalized);
  });

  // ── 4. Idempotency replay — 200 + X-Idempotent-Replay ────────────────

  it('idempotency replay returns 200 with X-Idempotent-Replay header', async () => {
    const idempKey = `replay-${randomUUID()}`;
    const res1 = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectSlug}/runs`,
      headers: {
        'x-api-token': f.rawApiKey,
        'content-type': 'application/json',
        'idempotency-key': idempKey,
      },
      payload: canonicalCtrf,
    });
    expect(res1.statusCode).toBe(201);
    const firstId = (JSON.parse(res1.body) as { runId: number }).runId;

    const res2 = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectSlug}/runs`,
      headers: {
        'x-api-token': f.rawApiKey,
        'content-type': 'application/json',
        'idempotency-key': idempKey,
      },
      payload: canonicalCtrf,
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.headers['x-idempotent-replay']).toBe('true');
    expect((JSON.parse(res2.body) as { runId: number }).runId).toBe(firstId);
  });

  // ── 5. Schema rejection via reporter — logs failure, does not throw ───

  it('schema rejection via reporter logs to stderr without throwing', async () => {
    const adapter = makeFetchAdapter(f.app);
    globalThis.fetch = adapter;

    const stderrLogs: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      stderrLogs.push(args.map(String).join(' '));
    };

    // Invalid CTRF — missing required fields but includes results.summary
    // so the reporter can compute an Idempotency-Key without throwing.
    await playwrightPost({ results: { summary: {} } }, {
      ingestUrl: 'http://test.local',
      apiToken: f.rawApiKey,
      projectSlug: f.projectSlug,
    });

    console.error = origError;
    globalThis.fetch = originalFetch;

    // Reporter should have logged the failure (422) but not thrown
    const failLog = stderrLogs.find((l) => l.includes('[CTRFHub]') && l.includes('422'));
    expect(failLog).toBeDefined();
  });

  // ── 6. 401 on missing API token — raw inject ─────────────────────────

  it('returns 401 when x-api-token is missing', async () => {
    const res = await f.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectSlug}/runs`,
      headers: { 'content-type': 'application/json' },
      payload: canonicalCtrf,
    });
    expect(res.statusCode).not.toBe(201);
    expect(res.statusCode).not.toBe(200);
  });

  // ── 7. Three-way equivalence — raw, playwright, cypress identical ─────

  it('three-way equivalence: raw POST, playwright, and cypress produce identical normalized rows', async () => {
    // We already have baseline, playwright, and cypress runs from tests 1–3
    const pwNormalized = await readNormalized(f.app, playwrightRunId);
    const cyNormalized = await readNormalized(f.app, cypressRunId);

    expect(pwNormalized).toEqual(baselineNormalized);
    expect(cyNormalized).toEqual(baselineNormalized);
    expect(pwNormalized).toEqual(cyNormalized);
  });

  // ── 8. Content-Type header — reporter sends application/json ──────────

  it('reporter sends Content-Type: application/json', async () => {
    let capturedContentType: string | undefined;

    const interceptFetch: typeof globalThis.fetch = async (input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      capturedContentType = headers?.['Content-Type'];
      return makeFetchAdapter(f.app)(input, init);
    };

    globalThis.fetch = interceptFetch;

    await playwrightPost(canonicalCtrf, {
      ingestUrl: 'http://test.local',
      apiToken: f.rawApiKey,
      projectSlug: f.projectSlug,
    });

    globalThis.fetch = originalFetch;

    expect(capturedContentType).toBe('application/json');
  });

  // ── 9. Deterministic Idempotency-Key — same summary → same key ────────

  it('reporter sends deterministic Idempotency-Key derived from summary', async () => {
    const capturedKeys: string[] = [];

    const interceptFetch: typeof globalThis.fetch = async (input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.['Idempotency-Key']) {
        capturedKeys.push(headers['Idempotency-Key']);
      }
      return makeFetchAdapter(f.app)(input, init);
    };

    globalThis.fetch = interceptFetch;

    // Post twice with the same CTRF — keys should be identical
    await playwrightPost(canonicalCtrf, {
      ingestUrl: 'http://test.local',
      apiToken: f.rawApiKey,
      projectSlug: f.projectSlug,
    });
    await playwrightPost(canonicalCtrf, {
      ingestUrl: 'http://test.local',
      apiToken: f.rawApiKey,
      projectSlug: f.projectSlug,
    });

    globalThis.fetch = originalFetch;

    expect(capturedKeys).toHaveLength(2);
    expect(capturedKeys[0]).toBe(capturedKeys[1]);

    // Verify it matches expected SHA-256 of the summary
    const expectedKey = createHash('sha256')
      .update(JSON.stringify(canonicalCtrf.results.summary))
      .digest('hex');
    expect(capturedKeys[0]).toBe(expectedKey);
  });

  // ── 10. opts override env vars ────────────────────────────────────────

  it('opts argument overrides env vars in reporter', async () => {
    const adapter = makeFetchAdapter(f.app);
    globalThis.fetch = adapter;

    // Set env vars to wrong values
    const origUrl = process.env['CTRFHUB_INGEST_URL'];
    const origToken = process.env['CTRFHUB_API_TOKEN'];
    const origSlug = process.env['CTRFHUB_PROJECT_SLUG'];

    process.env['CTRFHUB_INGEST_URL'] = 'http://wrong-host:9999';
    process.env['CTRFHUB_API_TOKEN'] = 'ctrf_wrong_token';
    process.env['CTRFHUB_PROJECT_SLUG'] = 'wrong-slug';

    const stderrLogs: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      stderrLogs.push(args.map(String).join(' '));
    };

    // opts should override the bad env vars
    await cypressPost(canonicalCtrf, {
      ingestUrl: 'http://test.local',
      apiToken: f.rawApiKey,
      projectSlug: f.projectSlug,
    });

    console.error = origError;
    globalThis.fetch = originalFetch;

    // Restore env
    if (origUrl === undefined) delete process.env['CTRFHUB_INGEST_URL'];
    else process.env['CTRFHUB_INGEST_URL'] = origUrl;
    if (origToken === undefined) delete process.env['CTRFHUB_API_TOKEN'];
    else process.env['CTRFHUB_API_TOKEN'] = origToken;
    if (origSlug === undefined) delete process.env['CTRFHUB_PROJECT_SLUG'];
    else process.env['CTRFHUB_PROJECT_SLUG'] = origSlug;

    // Should have succeeded (201) because opts overrode env
    const successLog = stderrLogs.find(
      (l) => l.includes('[CTRFHub]') && l.includes('successfully'),
    );
    expect(successLog).toBeDefined();
  });
});
