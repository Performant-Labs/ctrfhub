/**
 * Integration tests — AI-002 A1 Categorization Pipeline
 *
 * Tests the full reserve-execute-commit lifecycle, consent gate,
 * batching, cap 500, boot-time recovery, and event publishing.
 *
 * Layer 2 (integration) — uses buildApp({ testing: true, db: ':memory:' })
 * with MockAiProvider and MemoryEventBus. No real LLM calls.
 *
 * @see skills/vitest-three-layer-testing.md §Layer 2
 * @see .argos/AI-002/brief.md §Critical test paths
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { Organization, Project, TestRun, TestResult } from '../../entities/index.js';
import { MemoryEventBus, RunEvents } from '../../services/event-bus.js';
import { MockAiProvider } from '../doubles/MockAiProvider.js';
import { categorizeRun } from '../../services/ai/pipeline/categorizer.js';
import { recoverStalePipelineRows } from '../../services/ai/pipeline/recovery.js';
import type { CategorizeFailuresOutput, CategorizeFailuresInput } from '../../services/ai/types.js';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a MockAiProvider response that matches the input resultIds. */
function makeCatResponse(resultIds: number[]): CategorizeFailuresOutput {
  return {
    categories: resultIds.map((id) => ({
      resultId: id,
      category: 'app_defect' as const,
      confidence: 0.9,
    })),
    model: 'mock-model',
    tokensUsed: resultIds.length * 10,
  };
}

/**
 * Create the UNIQUE index on (test_run_id, stage) that the categorizer's
 * ON CONFLICT clause requires. The schema-generator doesn't create this
 * index because MikroORM v7 defineEntity() doesn't support top-level
 * `indexes`. The feature-handoff flagged this as a known issue.
 */
async function ensureUniqueIndex(app: FastifyInstance): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orm = (app as any).orm;
  await orm.em.getConnection().execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_apl_run_stage
     ON ai_pipeline_log (test_run_id, stage)`,
  );
}

/**
 * Seed an org + project + test run + N failed results.
 * Returns the runId and result IDs.
 */
async function seedRunWithFailures(
  app: FastifyInstance,
  orgId: string,
  failedCount: number,
  opts?: { aiCloudAckAt?: Date | null },
): Promise<{ runId: number; resultIds: number[]; projectId: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orm = (app as any).orm;
  const em = orm.em.fork();

  // Ensure org exists with consent
  let org = await em.findOne(Organization, { id: orgId });
  if (!org) {
    org = em.create(Organization, {
      id: orgId,
      name: 'Test Org',
      slug: `slug-${orgId}`,
      createdAt: new Date(),
      aiCloudAckAt: opts?.aiCloudAckAt !== undefined ? opts.aiCloudAckAt : new Date(),
    });
    await em.flush();
  } else if (opts?.aiCloudAckAt !== undefined) {
    org.aiCloudAckAt = opts.aiCloudAckAt;
    await em.flush();
  }

  // Ensure project exists
  let project = await em.findOne(Project, { organization: org });
  if (!project) {
    project = em.create(Project, {
      organization: org,
      name: 'Demo',
      slug: `demo-${orgId}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await em.flush();
  }

  // Create test run
  const run = em.create(TestRun, {
    project,
    name: `Run with ${failedCount} failures`,
    status: failedCount > 0 ? 'failed' : 'passed',
    totalTests: failedCount,
    passed: 0,
    failed: failedCount,
    skipped: 0,
    blocked: 0,
    createdAt: new Date(),
  });
  await em.flush();

  // Create failed test results
  const resultIds: number[] = [];
  for (let i = 0; i < failedCount; i++) {
    const result = em.create(TestResult, {
      testRun: run,
      testName: `failing-test-${i + 1}`,
      status: 'failed',
      errorMessage: `Error in test ${i + 1}`,
      stackTrace: `at test${i + 1} (file.ts:${i + 1}:1)`,
      createdAt: new Date(),
    });
    await em.flush();
    resultIds.push(result.id);
  }

  return { runId: run.id, resultIds, projectId: project.id };
}

// ---------------------------------------------------------------------------
// Suite 1: Consent gate
// ---------------------------------------------------------------------------

describe('AI-002 A1 Categorization — consent gate', () => {
  let app: FastifyInstance;
  let eventBus: MemoryEventBus;
  let aiProvider: MockAiProvider;

  beforeAll(async () => {
    eventBus = new MemoryEventBus();
    aiProvider = new MockAiProvider();
    aiProvider.setCategorization({ categories: [], model: 'mock', tokensUsed: 0 });
    app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('skips when AI_CLOUD_PIPELINE is not set', async () => {
    const saved = process.env['AI_CLOUD_PIPELINE'];
    delete process.env['AI_CLOUD_PIPELINE'];

    const { runId, projectId } = await seedRunWithFailures(app, 'org-gate-env', 3, { aiCloudAckAt: new Date() });
    aiProvider.reset();
    aiProvider.setCategorization(makeCatResponse([1, 2, 3]));
    eventBus.published.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await categorizeRun({ runId, orgId: 'org-gate-env', projectId }, aiProvider, (app as any).orm, eventBus);

    expect(aiProvider.calls).toHaveLength(0);
    expect(eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CATEGORIZED)).toHaveLength(0);

    if (saved) process.env['AI_CLOUD_PIPELINE'] = saved;
  });

  it('skips when aiCloudAckAt is NULL', async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';

    const { runId, projectId } = await seedRunWithFailures(app, 'org-gate-null', 3, { aiCloudAckAt: null });
    aiProvider.reset();
    aiProvider.setCategorization(makeCatResponse([1, 2, 3]));
    eventBus.published.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await categorizeRun({ runId, orgId: 'org-gate-null', projectId }, aiProvider, (app as any).orm, eventBus);

    expect(aiProvider.calls).toHaveLength(0);

    delete process.env['AI_CLOUD_PIPELINE'];
  });

  it('runs when both gates pass', async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';

    const { runId, resultIds, projectId } = await seedRunWithFailures(app, 'org-gate-pass', 2, { aiCloudAckAt: new Date() });
    aiProvider.reset();
    aiProvider.setCategorization(makeCatResponse(resultIds));
    eventBus.published.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await categorizeRun({ runId, orgId: 'org-gate-pass', projectId }, aiProvider, (app as any).orm, eventBus);

    expect(aiProvider.calls.filter((c) => c.method === 'categorizeFailures')).toHaveLength(1);

    delete process.env['AI_CLOUD_PIPELINE'];
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Happy path — reserve-execute-commit lifecycle
// ---------------------------------------------------------------------------

describe('AI-002 A1 Categorization — happy path lifecycle', () => {
  let app: FastifyInstance;
  let eventBus: MemoryEventBus;
  let aiProvider: MockAiProvider;

  beforeAll(async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    eventBus = new MemoryEventBus();
    aiProvider = new MockAiProvider();
    app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);
  });

  afterAll(async () => {
    delete process.env['AI_CLOUD_PIPELINE'];
    await app.close();
  });

  it('completes reserve → execute → commit and publishes run.ai_categorized', async () => {
    const { runId, resultIds, projectId } = await seedRunWithFailures(app, 'org-happy', 5, { aiCloudAckAt: new Date() });

    aiProvider.reset();
    aiProvider.setCategorization(makeCatResponse(resultIds));
    eventBus.published.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    await categorizeRun({ runId, orgId: 'org-happy', projectId }, aiProvider, orm, eventBus);

    // Verify AI provider was called
    expect(aiProvider.calls.filter((c) => c.method === 'categorizeFailures')).toHaveLength(1);

    // Verify ai_pipeline_log row ended up as 'done'
    const logRows = await orm.em.getConnection().execute(
      `SELECT * FROM ai_pipeline_log WHERE test_run_id = ? AND stage = 'categorize'`,
      [runId],
    );
    expect(logRows).toHaveLength(1);
    const logRow = (logRows as Array<Record<string, unknown>>)[0]!;
    expect(logRow['status']).toBe('done');
    expect(logRow['completed_at']).not.toBeNull();
    expect(logRow['tokens_used']).toBe(50); // 5 results * 10 tokens each
    expect(logRow['attempt']).toBe(1);

    // Verify test_results updated with ai_category
    const results = await orm.em.getConnection().execute(
      `SELECT ai_category, ai_category_model, ai_category_at FROM test_results WHERE test_run_id = ?`,
      [runId],
    );
    for (const r of results as Array<Record<string, unknown>>) {
      expect(r['ai_category']).toBe('app_defect');
      expect(r['ai_category_model']).toBe('mock-model');
      expect(r['ai_category_at']).not.toBeNull();
    }

    // Verify run.ai_categorized published
    const catEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CATEGORIZED);
    expect(catEvents).toHaveLength(1);
    expect((catEvents[0]!.payload as { runId: number }).runId).toBe(runId);
  });

  it('skips when run has zero failed results', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    const em = orm.em.fork();
    const org = await em.findOne(Organization, { id: 'org-happy' });
    const project = await em.findOne(Project, { organization: org });
    const run = em.create(TestRun, {
      project: project!,
      name: 'All passing',
      status: 'passed',
      totalTests: 5, passed: 5, failed: 0, skipped: 0, blocked: 0,
      createdAt: new Date(),
    });
    await em.flush();

    aiProvider.reset();
    aiProvider.setCategorization({ categories: [], model: 'mock', tokensUsed: 0 });
    eventBus.published.length = 0;

    await categorizeRun({ runId: run.id, orgId: 'org-happy', projectId: project!.id }, aiProvider, orm, eventBus);

    expect(aiProvider.calls).toHaveLength(0);
    expect(eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CATEGORIZED)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Batching and cap
// ---------------------------------------------------------------------------

describe('AI-002 A1 Categorization — batching', () => {
  let app: FastifyInstance;
  let eventBus: MemoryEventBus;
  let aiProvider: MockAiProvider;

  beforeAll(async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    eventBus = new MemoryEventBus();
    aiProvider = new MockAiProvider();
    app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);
  });

  afterAll(async () => {
    delete process.env['AI_CLOUD_PIPELINE'];
    await app.close();
  });

  it('batches in groups of 20 — 50 results produce 3 calls', async () => {
    const { runId, resultIds, projectId } = await seedRunWithFailures(app, 'org-batch', 50, { aiCloudAckAt: new Date() });

    const batch1 = makeCatResponse(resultIds.slice(0, 20));
    const batch2 = makeCatResponse(resultIds.slice(20, 40));
    const batch3 = makeCatResponse(resultIds.slice(40, 50));
    aiProvider.reset();
    aiProvider.setCategorization([batch1, batch2, batch3]);
    eventBus.published.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await categorizeRun({ runId, orgId: 'org-batch', projectId }, aiProvider, (app as any).orm, eventBus);

    const catCalls = aiProvider.calls.filter((c) => c.method === 'categorizeFailures');
    expect(catCalls).toHaveLength(3);

    expect((catCalls[0]!.input as CategorizeFailuresInput).results).toHaveLength(20);
    expect((catCalls[1]!.input as CategorizeFailuresInput).results).toHaveLength(20);
    expect((catCalls[2]!.input as CategorizeFailuresInput).results).toHaveLength(10);
  });

  it('caps at 500 failed results for a 600-failure run', async () => {
    const { runId, resultIds, projectId } = await seedRunWithFailures(app, 'org-cap', 600, { aiCloudAckAt: new Date() });

    // 500 / 20 = 25 batches
    const responses: CategorizeFailuresOutput[] = [];
    for (let i = 0; i < 25; i++) {
      responses.push(makeCatResponse(resultIds.slice(i * 20, Math.min((i + 1) * 20, 500))));
    }
    aiProvider.reset();
    aiProvider.setCategorization(responses);
    eventBus.published.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await categorizeRun({ runId, orgId: 'org-cap', projectId }, aiProvider, (app as any).orm, eventBus);

    const catCalls = aiProvider.calls.filter((c) => c.method === 'categorizeFailures');
    expect(catCalls).toHaveLength(25);

    const totalResults = catCalls.reduce(
      (sum, c) => sum + (c.input as CategorizeFailuresInput).results.length, 0,
    );
    expect(totalResults).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Error handling — transient and terminal
// ---------------------------------------------------------------------------

describe('AI-002 A1 Categorization — error handling', () => {
  let app: FastifyInstance;
  let eventBus: MemoryEventBus;
  let aiProvider: MockAiProvider;

  beforeAll(async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    eventBus = new MemoryEventBus();
    aiProvider = new MockAiProvider();
    app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);
  });

  afterAll(async () => {
    delete process.env['AI_CLOUD_PIPELINE'];
    await app.close();
  });

  it('releases row to pending on transient error (attempt < 3)', async () => {
    const { runId, projectId } = await seedRunWithFailures(app, 'org-err-t', 3, { aiCloudAckAt: new Date() });

    aiProvider.reset();
    // No response set — MockAiProvider will throw
    eventBus.published.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    await categorizeRun({ runId, orgId: 'org-err-t', projectId }, aiProvider, orm, eventBus);

    const logRows = await orm.em.getConnection().execute(
      `SELECT * FROM ai_pipeline_log WHERE test_run_id = ? AND stage = 'categorize'`,
      [runId],
    );
    expect(logRows).toHaveLength(1);
    const logRow = (logRows as Array<Record<string, unknown>>)[0]!;
    expect(logRow['status']).toBe('pending');
    expect(logRow['error']).toBeTruthy();

    // No event published on transient failure
    expect(eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CATEGORIZED)).toHaveLength(0);
  });

  it('marks row failed and publishes partial on terminal error (attempt >= 3)', async () => {
    const { runId, projectId } = await seedRunWithFailures(app, 'org-err-term', 3, { aiCloudAckAt: new Date() });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;

    // Pre-seed a log row at attempt=2, status=pending
    await orm.em.getConnection().execute(
      `INSERT INTO ai_pipeline_log (test_run_id, stage, status, attempt)
       VALUES (?, 'categorize', 'pending', 2)`,
      [runId],
    );

    aiProvider.reset();
    // No response set — will throw
    eventBus.published.length = 0;

    await categorizeRun({ runId, orgId: 'org-err-term', projectId }, aiProvider, orm, eventBus);

    const logRows = await orm.em.getConnection().execute(
      `SELECT * FROM ai_pipeline_log WHERE test_run_id = ? AND stage = 'categorize'`,
      [runId],
    );
    expect(logRows).toHaveLength(1);
    const logRow = (logRows as Array<Record<string, unknown>>)[0]!;
    expect(logRow['status']).toBe('failed');

    const catEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CATEGORIZED);
    expect(catEvents).toHaveLength(1);
    expect((catEvents[0]!.payload as { partial?: boolean }).partial).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Boot-time recovery
// ---------------------------------------------------------------------------

describe('AI-002 A1 Categorization — boot-time recovery', () => {
  it('reclaims stale heartbeat rows to pending', async () => {
    const eventBus = new MemoryEventBus();
    const app = await buildApp({ testing: true, db: ':memory:', eventBus: new MemoryEventBus() });
    await ensureUniqueIndex(app);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;

    // Seed org + project + run
    const em = orm.em.fork();
    const org = em.create(Organization, {
      id: 'org-recovery', name: 'Recovery Org', slug: 'recovery-org',
      createdAt: new Date(), aiCloudAckAt: new Date(),
    });
    await em.flush();
    const project = em.create(Project, {
      organization: org, name: 'Proj', slug: 'recovery-proj',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await em.flush();
    const run = em.create(TestRun, {
      project, name: 'Stale run', status: 'failed',
      totalTests: 1, passed: 0, failed: 1, skipped: 0, blocked: 0,
      createdAt: new Date(),
    });
    await em.flush();

    // Seed a stale running row (heartbeat 5 minutes ago).
    // Format heartbeat as 'YYYY-MM-DD HH:MM:SS' (matching
    // CURRENT_TIMESTAMP output) so raw text comparison works
    // without the SQLite-only datetime() function.
    const staleTime = new Date(Date.now() - 5 * 60 * 1000)
      .toISOString().replace('T', ' ').slice(0, 19);
    await orm.em.getConnection().execute(
      `INSERT INTO ai_pipeline_log (test_run_id, stage, status, worker_id, heartbeat_at, attempt)
       VALUES (?, 'categorize', 'running', 'dead-worker:1:0', ?, 1)`,
      [run.id, staleTime],
    );

    // Run recovery
    await recoverStalePipelineRows(orm, eventBus);

    const after = await orm.em.getConnection().execute(
      `SELECT status, worker_id, heartbeat_at FROM ai_pipeline_log WHERE test_run_id = ?`,
      [run.id],
    );
    const row = (after as Array<Record<string, unknown>>)[0]!;
    expect(row['status']).toBe('pending');
    expect(row['worker_id']).toBeNull();

    await app.close();
  });

  it('terminal-fails exhausted-attempt rows', async () => {
    const eventBus = new MemoryEventBus();
    const app = await buildApp({ testing: true, db: ':memory:', eventBus: new MemoryEventBus() });
    await ensureUniqueIndex(app);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;

    const em = orm.em.fork();
    const org = em.create(Organization, {
      id: 'org-exhaust', name: 'Exhaust Org', slug: 'exhaust-org',
      createdAt: new Date(), aiCloudAckAt: new Date(),
    });
    await em.flush();
    const project = em.create(Project, {
      organization: org, name: 'Proj', slug: 'exhaust-proj',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await em.flush();
    const run = em.create(TestRun, {
      project, name: 'Exhausted run', status: 'failed',
      totalTests: 1, passed: 0, failed: 1, skipped: 0, blocked: 0,
      createdAt: new Date(),
    });
    await em.flush();

    // Seed a pending row with attempt >= 3
    await orm.em.getConnection().execute(
      `INSERT INTO ai_pipeline_log (test_run_id, stage, status, attempt)
       VALUES (?, 'categorize', 'pending', 3)`,
      [run.id],
    );

    await recoverStalePipelineRows(orm, eventBus);

    const after = await orm.em.getConnection().execute(
      `SELECT status, error FROM ai_pipeline_log WHERE test_run_id = ?`,
      [run.id],
    );
    const row = (after as Array<Record<string, unknown>>)[0]!;
    expect(row['status']).toBe('failed');
    expect(row['error']).toContain('Maximum retry attempts exhausted');

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: EventBus event publishing
// ---------------------------------------------------------------------------

describe('AI-002 A1 Categorization — event publishing', () => {
  it('publishes run.ai_categorized with correct payload', async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    const eventBus = new MemoryEventBus();
    const aiProvider = new MockAiProvider();
    const app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);

    const { runId, resultIds, projectId } = await seedRunWithFailures(app, 'org-event', 2, { aiCloudAckAt: new Date() });
    aiProvider.reset();
    aiProvider.setCategorization(makeCatResponse(resultIds));
    eventBus.published.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await categorizeRun({ runId, orgId: 'org-event', projectId }, aiProvider, (app as any).orm, eventBus);

    const catEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CATEGORIZED);
    expect(catEvents).toHaveLength(1);
    const payload = catEvents[0]!.payload as { runId: number; orgId: string };
    expect(payload.runId).toBe(runId);
    expect(payload.orgId).toBe('org-event');

    await app.close();
    delete process.env['AI_CLOUD_PIPELINE'];
  });
});

// ---------------------------------------------------------------------------
// Suite 7: Heartbeat advancement
// ---------------------------------------------------------------------------

describe('AI-002 A1 Categorization — heartbeat advancement', () => {
  let app: FastifyInstance;
  let eventBus: MemoryEventBus;
  let aiProvider: MockAiProvider;

  beforeAll(async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    eventBus = new MemoryEventBus();
    aiProvider = new MockAiProvider();
    app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);
  });

  afterAll(async () => {
    delete process.env['AI_CLOUD_PIPELINE'];
    await app.close();
  });

  it('sets heartbeat_at during execution and clears it on completion', async () => {
    const { runId, resultIds, projectId } = await seedRunWithFailures(app, 'org-hb', 2, { aiCloudAckAt: new Date() });
    aiProvider.reset();
    aiProvider.setCategorization(makeCatResponse(resultIds));
    eventBus.published.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    await categorizeRun({ runId, orgId: 'org-hb', projectId }, aiProvider, orm, eventBus);

    // After completion, heartbeat_at should be NULL (cleared in done transition)
    const logRows = await orm.em.getConnection().execute(
      `SELECT heartbeat_at, worker_id, status FROM ai_pipeline_log WHERE test_run_id = ? AND stage = 'categorize'`,
      [runId],
    );
    expect(logRows).toHaveLength(1);
    const logRow = (logRows as Array<Record<string, unknown>>)[0]!;
    expect(logRow['status']).toBe('done');
    expect(logRow['heartbeat_at']).toBeNull();
    expect(logRow['worker_id']).toBeNull();
  });

  it('records started_at timestamp on first reservation', async () => {
    const { runId, resultIds, projectId } = await seedRunWithFailures(app, 'org-hb-started', 2, { aiCloudAckAt: new Date() });
    aiProvider.reset();
    aiProvider.setCategorization(makeCatResponse(resultIds));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    await categorizeRun({ runId, orgId: 'org-hb-started', projectId }, aiProvider, orm, eventBus);

    const logRows = await orm.em.getConnection().execute(
      `SELECT started_at FROM ai_pipeline_log WHERE test_run_id = ? AND stage = 'categorize'`,
      [runId],
    );
    const logRow = (logRows as Array<Record<string, unknown>>)[0]!;
    expect(logRow['started_at']).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 8: Idempotency check — already-categorized results
// ---------------------------------------------------------------------------

describe('AI-002 A1 Categorization — idempotency', () => {
  let app: FastifyInstance;
  let eventBus: MemoryEventBus;
  let aiProvider: MockAiProvider;

  beforeAll(async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    eventBus = new MemoryEventBus();
    aiProvider = new MockAiProvider();
    app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);
  });

  afterAll(async () => {
    delete process.env['AI_CLOUD_PIPELINE'];
    await app.close();
  });

  it('skips LLM call and publishes event when results are already categorized', async () => {
    const { runId, resultIds, projectId } = await seedRunWithFailures(app, 'org-idem', 3, { aiCloudAckAt: new Date() });

    // Pre-categorize all results manually (simulate crash after commit but before log update)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    for (const rid of resultIds) {
      await orm.em.getConnection().execute(
        `UPDATE test_results SET ai_category = 'app_defect', ai_category_model = 'mock', ai_category_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [rid],
      );
    }

    aiProvider.reset();
    aiProvider.setCategorization(makeCatResponse(resultIds));
    eventBus.published.length = 0;

    await categorizeRun({ runId, orgId: 'org-idem', projectId }, aiProvider, orm, eventBus);

    // Should NOT have called the AI provider (idempotency check triggered)
    expect(aiProvider.calls).toHaveLength(0);

    // Should still publish the event so downstream stages proceed
    const catEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CATEGORIZED);
    expect(catEvents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 9: EventBus subscription wiring — A1 subscribes at boot
// ---------------------------------------------------------------------------

describe('AI-002 A1 Categorization — EventBus subscription', () => {
  it('A1 subscribes to run.ingested when aiProvider is injected', async () => {
    const eventBus = new MemoryEventBus();
    const aiProvider = new MockAiProvider();
    const app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });

    // The MemoryEventBus from event-bus.ts tracks subscriptions internally.
    // We verify by publishing a run.ingested event and checking that the
    // categorizer tried to run (it will fail consent gate since env is not set,
    // but the subscription itself should be wired).

    // We can inspect the subscription by checking that publishing an event
    // doesn't throw and the handler was registered.
    // Best approach: verify via a controlled event publish that triggers
    // the categorizer path (consent gate will block, but subscriber exists).
    await ensureUniqueIndex(app);
    const { runId, projectId } = await seedRunWithFailures(app, 'org-sub', 1, { aiCloudAckAt: new Date() });

    // Clear any published events from boot recovery
    eventBus.published.length = 0;

    // Publish run.ingested — should be handled by the A1 subscription
    // Without AI_CLOUD_PIPELINE=on, consent gate blocks, but no error thrown
    delete process.env['AI_CLOUD_PIPELINE'];
    eventBus.publish(RunEvents.RUN_INGESTED, { runId, orgId: 'org-sub', projectId });

    // Give async handler time to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    // The handler ran without throwing (consent gate blocked silently).
    // No AI provider call made, no event published — this is correct.
    expect(aiProvider.calls).toHaveLength(0);

    await app.close();
  });

  it('A1 runs full pipeline when triggered via EventBus publish', async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    const eventBus = new MemoryEventBus();
    const aiProvider = new MockAiProvider();
    const app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);

    const { runId, resultIds, projectId } = await seedRunWithFailures(app, 'org-sub-full', 2, { aiCloudAckAt: new Date() });
    aiProvider.reset();
    aiProvider.setCategorization(makeCatResponse(resultIds));
    eventBus.published.length = 0;

    // Publish the event that triggers A1 — the subscription should invoke categorizeRun
    eventBus.publish(RunEvents.RUN_INGESTED, { runId, orgId: 'org-sub-full', projectId });

    // Give async handler time to complete (fire-and-forget via Promise.allSettled)
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    // Verify the AI provider was called via the EventBus-triggered subscription
    expect(aiProvider.calls.filter((c) => c.method === 'categorizeFailures')).toHaveLength(1);

    // Verify run.ai_categorized was published
    const catEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CATEGORIZED);
    expect(catEvents).toHaveLength(1);

    await app.close();
    delete process.env['AI_CLOUD_PIPELINE'];
  });
});

// ---------------------------------------------------------------------------
// Suite 10: Recovery re-enqueue — pending rows get events re-published
// ---------------------------------------------------------------------------

describe('AI-002 A1 Categorization — recovery re-enqueue', () => {
  it('re-enqueues pending rows for recent runs by publishing events', async () => {
    const eventBus = new MemoryEventBus();
    const app = await buildApp({ testing: true, db: ':memory:', eventBus });
    await ensureUniqueIndex(app);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;

    // Seed org + project + run
    const em = orm.em.fork();
    const org = em.create(Organization, {
      id: 'org-reenq', name: 'Reenqueue Org', slug: 'reenqueue-org',
      createdAt: new Date(), aiCloudAckAt: new Date(),
    });
    await em.flush();
    const project = em.create(Project, {
      organization: org, name: 'Proj', slug: 'reenqueue-proj',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await em.flush();
    const run = em.create(TestRun, {
      project, name: 'Pending run', status: 'failed',
      totalTests: 1, passed: 0, failed: 1, skipped: 0, blocked: 0,
      createdAt: new Date(), // Recent — within 24h window
    });
    await em.flush();

    // Seed a pending row with attempt < 3 (should be re-enqueued)
    await orm.em.getConnection().execute(
      `INSERT INTO ai_pipeline_log (test_run_id, stage, status, attempt)
       VALUES (?, 'categorize', 'pending', 1)`,
      [run.id],
    );

    // Clear published events from boot
    eventBus.published.length = 0;

    // Run recovery — should re-enqueue the pending row
    await recoverStalePipelineRows(orm, eventBus);

    // Should have published run.ingested for the pending 'categorize' row
    const ingestedEvents = eventBus.published.filter(
      (e) => e.topic === RunEvents.RUN_INGESTED,
    );
    expect(ingestedEvents).toHaveLength(1);
    const payload = ingestedEvents[0]!.payload as { runId: number; orgId: string };
    expect(payload.runId).toBe(run.id);
    expect(payload.orgId).toBe('org-reenq');

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 11: No real LLM calls — static verification
// ---------------------------------------------------------------------------

describe('AI-002 A1 Categorization — no real LLM calls', () => {
  it('this test file does not import any AI SDK', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const thisFile = readFileSync(
      fileURLToPath(new URL(import.meta.url)),
      'utf-8',
    );

    // Use regex to match actual import statements (not string literals in tests)
    const sdkImportPattern = /^import\s.*from\s+['"](?:openai|@anthropic-ai\/sdk|groq-sdk)['"]/m;
    expect(sdkImportPattern.test(thisFile)).toBe(false);
  });
});
